import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { ConversationMeta, JnsonlMessage, ContentBlock } from "./types";

const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");
const MAX_TITLE_LENGTH = 60;

export function decodeProjectDir(dirName: string): string {
  // "-Users-natsuki-fukazawa-aix-Foo" → "/Users/natsuki.fukazawa/aix/Foo"
  // Heuristic: leading dash = path separator, internal dashes may be literal
  // Best effort: replace leading dash and subsequent dashes that follow known patterns
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

export function getProjectDisplayName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  // Return last 2 path segments for readability
  return parts.slice(-2).join("/");
}

function extractTitle(content: string | ContentBlock[]): string | null {
  if (typeof content === "string") {
    if (content.startsWith("<")) return null;
    return content.slice(0, MAX_TITLE_LENGTH);
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text" && block.text && !block.text.startsWith("<")) {
        return block.text.slice(0, MAX_TITLE_LENGTH);
      }
    }
  }
  return null;
}

async function parseConversationFile(
  filePath: string,
  projectDir: string,
  projectPath: string
): Promise<ConversationMeta | null> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let title: string | null = null;
    let sessionId: string | null = null;
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let gitBranch: string | undefined;
    let model: string | undefined;
    let messageCount = 0;
    let lineCount = 0;
    const MAX_LINES = 500; // Read enough lines to get metadata but don't scan entire file

    rl.on("line", (line) => {
      lineCount++;
      if (lineCount > MAX_LINES && title) {
        rl.close();
        stream.destroy();
        return;
      }

      try {
        const obj: JnsonlMessage = JSON.parse(line);

        if (obj.type === "user" || obj.type === "assistant") {
          messageCount++;

          if (!sessionId && obj.sessionId) {
            sessionId = obj.sessionId;
          }
          if (!firstTimestamp && obj.timestamp) {
            firstTimestamp = obj.timestamp;
          }
          if (obj.timestamp) {
            lastTimestamp = obj.timestamp;
          }
          if (!gitBranch && obj.gitBranch) {
            gitBranch = obj.gitBranch;
          }
        }

        if (
          obj.type === "user" &&
          !obj.isMeta &&
          !obj.isSidechain &&
          !title &&
          obj.message?.content
        ) {
          title = extractTitle(obj.message.content);
        }

        if (obj.type === "assistant" && !model && obj.message?.model) {
          model = obj.message.model;
        }
      } catch {
        // skip non-JSON lines
      }
    });

    rl.on("close", () => {
      if (!title || !sessionId) {
        resolve(null);
        return;
      }

      resolve({
        sessionId,
        title,
        timestamp: new Date(lastTimestamp || firstTimestamp || Date.now()),
        filePath,
        messageCount,
        model,
        gitBranch,
        projectPath,
        projectDir,
        isPinned: false,
        isWaiting: false,
        isToolUseWaiting: false,
      });
    });

    rl.on("error", () => resolve(null));
  });
}

interface TailMetadata {
  isWaiting: boolean;        // last message is user → waiting for Claude's response
  isToolUseWaiting: boolean; // last assistant message has tool_use → waiting for permission
  customTitle?: string;      // custom title set via /rename command
}

/**
 * Track file sizes between polls to detect active conversations.
 * Key: filePath, Value: { size, lastChangedAt }
 */
const fileActivity = new Map<string, { size: number; lastChangedAt: number }>();

interface FileActivityResult {
  /** Whether the file is considered active (changed recently or within stale window) */
  active: boolean;
  /** Whether the file size changed since the last poll (i.e. still being written to) */
  sizeChanged: boolean;
}

/**
 * Determine if a file is actively being written to.
 * - If file size changed since last check → active + sizeChanged
 * - If file size unchanged but last change was recent (< STALE_MS) → active only
 * - Otherwise → inactive (abandoned)
 */
const STALE_MS = 10 * 60 * 1000; // 10 minutes with no file size change → inactive

function checkFileActivity(filePath: string, currentSize: number): FileActivityResult {
  const now = Date.now();
  const prev = fileActivity.get(filePath);

  if (!prev) {
    // First check — use file mtime to decide initial activity
    const stat = fs.statSync(filePath);
    const age = now - stat.mtimeMs;
    const isRecent = age < STALE_MS;
    fileActivity.set(filePath, {
      size: currentSize,
      lastChangedAt: isRecent ? now : now - STALE_MS,
    });
    // On first check, assume size just changed if the file is recent
    return { active: isRecent, sizeChanged: isRecent };
  }

  if (prev.size !== currentSize) {
    // Size changed → active
    fileActivity.set(filePath, { size: currentSize, lastChangedAt: now });
    return { active: true, sizeChanged: true };
  }

  // Size unchanged — still active if last change was recent
  const active = (now - prev.lastChangedAt) < STALE_MS;
  return { active, sizeChanged: false };
}

/**
 * Scan entire file for the last custom-title record.
 * Uses string matching to avoid parsing every JSON line.
 */
function findCustomTitle(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    let lastTitle: string | undefined;
    let idx = 0;
    while (true) {
      idx = content.indexOf('"custom-title"', idx);
      if (idx === -1) { break; }
      // Find the line boundaries
      const lineStart = content.lastIndexOf("\n", idx) + 1;
      let lineEnd = content.indexOf("\n", idx);
      if (lineEnd === -1) { lineEnd = content.length; }
      try {
        const obj = JSON.parse(content.slice(lineStart, lineEnd));
        if (obj.type === "custom-title" && obj.customTitle) {
          lastTitle = obj.customTitle;
        }
      } catch {
        // skip
      }
      idx = lineEnd;
    }
    return lastTitle;
  } catch {
    return undefined;
  }
}

/**
 * Read last N bytes of a file to detect waiting states.
 * - isWaiting: last real message is from the user (waiting for response)
 * - isToolUseWaiting: last assistant message has tool_use blocks without subsequent tool_result
 *
 * Uses file-size-change tracking to distinguish active vs abandoned conversations.
 */
/**
 * Tools that may require user permission before execution.
 * When the last assistant message has one of these tool_use blocks without
 * a subsequent tool_result, show the "permission waiting" (warning) icon.
 * Auto-approved tools (Read, Grep, etc.) complete instantly so they rarely
 * appear without a tool_result during polling.
 */
const PERMISSION_TOOLS = new Set([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
  "AskUserQuestion",
]);

function readTailMetadata(filePath: string): TailMetadata {
  const result: TailMetadata = { isWaiting: false, isToolUseWaiting: false };
  try {
    const stat = fs.statSync(filePath);

    // Only compute waiting state for active files
    const activity = checkFileActivity(filePath, stat.size);
    if (!activity.active) {
      return result;
    }

    // Read last 16KB to find the last messages (tool_use content can be large)
    const readSize = Math.min(stat.size, 16384);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const tail = buf.toString("utf8");
    const lines = tail.split("\n").filter((l) => l.trim());

    // Walk backwards to find the effective last message.
    // We need to determine:
    //   1. Is the conversation actively processing? (assistant is last → isWaiting)
    //   2. Is it waiting for user permission? (assistant tool_use with permission tool → isToolUseWaiting)
    //   3. Has the turn completed? (assistant with stop_reason="end_turn" → no waiting)
    let interrupted = false;
    let toolResultSeen = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj: JnsonlMessage = JSON.parse(lines[i]);

        // Skip non-conversation records
        if (obj.type === "custom-title" || obj.type === "file-history-snapshot") {
          continue;
        }
        // Skip sub-agent progress records
        if ((obj as { type: string }).type === "progress") {
          continue;
        }
        // summary / system / pr-link indicate a completed turn — no waiting
        if ((obj as { type: string }).type === "summary" ||
            (obj as { type: string }).type === "system" ||
            (obj as { type: string }).type === "pr-link") {
          return result;
        }

        // queue-operation marks a turn boundary — anything before it is a previous turn
        if (obj.type === "queue-operation") {
          return result;
        }

        // Skip synthetic assistant messages (written after interrupt)
        if (obj.type === "assistant" && obj.message?.model === "<synthetic>") {
          continue;
        }

        // --- User message handling ---
        if (obj.type === "user" && !obj.isSidechain) {
          const content = obj.message?.content;

          // Detect user interrupt messages
          if (typeof (obj as { toolUseResult?: unknown }).toolUseResult === "string" &&
              ((obj as { toolUseResult: string }).toolUseResult).includes("rejected")) {
            interrupted = true;
            continue;
          }
          if (Array.isArray(content)) {
            const text = (content[0] as ContentBlock)?.text ?? "";
            if (text.startsWith("[Request interrupted by user")) {
              interrupted = true;
              continue;
            }
          }

          // Local command / system-generated messages mean the previous turn completed
          if (typeof content === "string" && (
            content.startsWith("<local-command-") ||
            content.startsWith("<command-name>") ||
            content.startsWith("<bash-input>") ||
            content.startsWith("<bash-stdout>") ||
            content.startsWith("<task-notification>") ||
            content.startsWith("Unknown skill:")
          )) {
            return result; // turn is done — no waiting
          }

          // Skip tool_result user messages (these are tool responses, not new user questions)
          if (Array.isArray(content) && content.some(
            (block: ContentBlock) => block.type === "tool_result"
          )) {
            toolResultSeen = true;
            continue;
          }

          // Skip isMeta messages
          if (obj.isMeta) {
            continue;
          }

          // Real user message — Claude should be responding
          if (!interrupted) {
            result.isWaiting = true;
          }
          return result;
        }

        // --- Assistant message handling ---
        if (obj.type === "assistant" && !obj.isSidechain) {
          if (interrupted) {
            return result;
          }

          const stopReason = obj.message?.stop_reason;

          // Turn completed — no waiting state
          if (stopReason === "end_turn" || stopReason === "stop_sequence" || stopReason === "refusal") {
            return result;
          }

          // Check content blocks for tool_use
          const content = obj.message?.content;
          if (Array.isArray(content)) {
            const toolUseBlock = content.find(
              (block: ContentBlock) => block.type === "tool_use" && block.name !== undefined
            );

            if (toolUseBlock && !toolResultSeen) {
              // Has tool_use without a tool_result yet
              if (PERMISSION_TOOLS.has(toolUseBlock.name!)) {
                // Show warning only if enough time has passed (auto-approved tools
                // get their tool_result almost instantly, so a brief grace period
                // avoids flashing the warning icon for auto-approved executions)
                const ts = (obj as { timestamp?: string }).timestamp;
                const age = ts ? Date.now() - new Date(ts).getTime() : Infinity;
                if (age > 3000) {
                  result.isToolUseWaiting = true;
                } else {
                  result.isWaiting = true;
                }
              } else {
                // Auto-executed tool (Read, Grep, Glob, Task, etc.) — still processing
                result.isWaiting = true;
              }
              return result;
            }

            if (toolUseBlock && toolResultSeen) {
              // tool_use already has a tool_result — Claude should be generating next response
              result.isWaiting = true;
              return result;
            }
          }

          // Assistant message with stop_reason=null and no tool_use.
          // Claude Code writes content blocks incrementally, so the final block
          // often has stop_reason=null even when the turn is complete.
          // Use file size change between polls to distinguish:
          //   - Size changed since last poll → still streaming → loading
          //   - Size unchanged → streaming finished → no waiting
          if (stopReason === null || stopReason === undefined) {
            if (activity.sizeChanged) {
              result.isWaiting = true;
            }
          }
          return result;
        }
      } catch {
        // skip non-JSON
      }
    }
  } catch {
    // ignore
  }
  return result;
}

/**
 * Fast metadata extraction - reads file stats + first few lines + tail
 */
async function parseConversationFileFast(
  filePath: string,
  projectDir: string,
  projectPath: string
): Promise<ConversationMeta | null> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let title: string | null = null;
    let sessionId: string | null = null;
    let gitBranch: string | undefined;
    let model: string | undefined;
    let lineCount = 0;

    rl.on("line", (line) => {
      lineCount++;
      // Read only first 30 lines for fast parsing
      if (lineCount > 30) {
        rl.close();
        stream.destroy();
        return;
      }

      try {
        const obj: JnsonlMessage = JSON.parse(line);

        if (!sessionId && obj.sessionId) {
          sessionId = obj.sessionId;
        }
        if (!gitBranch && obj.gitBranch) {
          gitBranch = obj.gitBranch;
        }

        if (
          obj.type === "user" &&
          !obj.isMeta &&
          !obj.isSidechain &&
          !title &&
          obj.message?.content
        ) {
          title = extractTitle(obj.message.content);
        }

        if (obj.type === "assistant" && !model && obj.message?.model) {
          model = obj.message.model;
        }
      } catch {
        // skip
      }
    });

    rl.on("close", () => {
      if (!title || !sessionId) {
        resolve(null);
        return;
      }

      // Use file mtime for timestamp (fast, no need to scan entire file)
      const stat = fs.statSync(filePath);

      // Estimate message count from file size (rough: ~2KB per message pair)
      const estimatedMessages = Math.max(
        1,
        Math.round(stat.size / 2048)
      );

      const tailMeta = readTailMetadata(filePath);
      const customTitle = findCustomTitle(filePath);

      resolve({
        sessionId,
        title: customTitle || title,
        timestamp: stat.mtime,
        filePath,
        messageCount: estimatedMessages,
        model,
        gitBranch,
        projectPath,
        projectDir,
        isPinned: false,
        isWaiting: tailMeta.isWaiting,
        isToolUseWaiting: tailMeta.isToolUseWaiting,
      });
    });

    rl.on("error", () => resolve(null));
  });
}

export async function loadAllConversations(): Promise<ConversationMeta[]> {
  if (!fs.existsSync(CLAUDE_DIR)) {
    return [];
  }

  const projectDirs = fs
    .readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const allConversations: ConversationMeta[] = [];

  for (const dir of projectDirs) {
    const projectDir = dir.name;
    const projectPath = decodeProjectDir(projectDir);
    const dirPath = path.join(CLAUDE_DIR, projectDir);

    // Skip if directory doesn't actually exist (broken symlink, race condition, etc.)
    if (!fs.existsSync(dirPath)) {
      continue;
    }

    let jsonlFiles: string[];
    try {
      jsonlFiles = fs
        .readdirSync(dirPath)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => path.join(dirPath, f));
    } catch {
      continue;
    }

    const results = await Promise.all(
      jsonlFiles.map((f) => parseConversationFileFast(f, projectDir, projectPath))
    );

    for (const meta of results) {
      if (meta) {
        allConversations.push(meta);
      }
    }
  }

  // Sort by timestamp descending (newest first)
  allConversations.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return allConversations;
}

export async function loadConversationsForProject(
  projectDir: string
): Promise<ConversationMeta[]> {
  const dirPath = path.join(CLAUDE_DIR, projectDir);
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const projectPath = decodeProjectDir(projectDir);

  let jsonlFiles: string[];
  try {
    jsonlFiles = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dirPath, f));
  } catch {
    return [];
  }

  const results = await Promise.all(
    jsonlFiles.map((f) => parseConversationFileFast(f, projectDir, projectPath))
  );

  const conversations = results.filter(
    (m): m is ConversationMeta => m !== null
  );

  conversations.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return conversations;
}

export function getClaudeProjectsDir(): string {
  return CLAUDE_DIR;
}
