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

export interface TailMetadata {
  isWaiting: boolean;        // last message is user → waiting for Claude's response
  isToolUseWaiting: boolean; // last assistant message has tool_use → waiting for permission
  customTitle?: string;      // custom title set via /rename command
  lastTimestamp?: string;    // timestamp of the last user/assistant message (for stale detection)
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
 * Tools that may require user permission before execution.
 */
export const PERMISSION_TOOLS = new Set([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
  "AskUserQuestion",
  "ExitPlanMode",
]);

/**
 * Stateless waiting-state detection based purely on message state.
 *
 * Walks backwards through the tail of the JSONL file and determines:
 *   - isWaiting: conversation is actively processing (loading spinner)
 *   - isToolUseWaiting: waiting for user permission (warning icon)
 *
 * Interrupted/abandoned conversations are detected by their explicit
 * records (summary, "[Request interrupted by user", synthetic model).
 * No external file-activity tracking needed.
 */
export function readTailMetadata(filePath: string): TailMetadata {
  const result: TailMetadata = { isWaiting: false, isToolUseWaiting: false };
  try {
    const stat = fs.statSync(filePath);

    // Read last 16KB to find the last messages
    const readSize = Math.min(stat.size, 16384);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const tail = buf.toString("utf8");
    const lines = tail.split("\n").filter((l) => l.trim());

    let toolResultSeen = false;
    let textResponseSeen = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        continue;
      }

      const type = obj.type as string;

      // summary record → conversation was interrupted and wrapped up
      if (type === "summary") {
        return result;
      }

      // Skip non-conversation records
      if (type !== "user" && type !== "assistant") {
        continue;
      }

      const msg = obj as unknown as JnsonlMessage;
      if (msg.isSidechain) {
        continue;
      }
      // Synthetic messages are written after interrupt
      if (type === "assistant" && msg.message?.model === "<synthetic>") {
        continue;
      }

      // Record the latest timestamp from user/assistant messages
      if (!result.lastTimestamp && msg.timestamp) {
        result.lastTimestamp = msg.timestamp as string;
      }

      // --- User message ---
      if (type === "user") {
        const content = msg.message?.content;

        // Interrupt message → conversation stopped
        if (Array.isArray(content)) {
          const text = (content[0] as ContentBlock)?.text ?? "";
          if (text.startsWith("[Request interrupted by user")) {
            return result;
          }
        }

        // tool_result → not a real user turn, skip
        if (Array.isArray(content) && content.some(
          (block: ContentBlock) => block.type === "tool_result"
        )) {
          toolResultSeen = true;
          continue;
        }

        if (msg.isMeta) {
          continue;
        }

        // System-generated messages (task-notification, etc.) → not real user input
        if (typeof content === "string" && content.startsWith("<")) {
          continue;
        }

        // Real user message → Claude should be responding
        result.isWaiting = true;
        return result;
      }

      // --- Assistant message ---
      const stopReason = msg.message?.stop_reason;
      const content = msg.message?.content;

      if (stopReason === "end_turn" || stopReason === "stop_sequence" || stopReason === "refusal") {
        return result;
      }

      // Detect intermediate streaming placeholder written mid-stream.
      // Claude Code writes partial messages during streaming with very low
      // output_tokens counts (typically 0 or 1). These are intermediate writes
      // UNLESS they contain substantial text with no tool_use blocks, which
      // indicates the final response was written but end_turn was never recorded.
      const outputTokens = msg.message?.usage?.output_tokens;
      if (typeof outputTokens === 'number') {
        const textLength = Array.isArray(content)
          ? content.reduce((sum: number, block: ContentBlock) =>
              sum + (block.type === 'text' && block.text ? block.text.length : 0), 0)
          : 0;
        const hasToolUse = Array.isArray(content)
          && content.some((block: ContentBlock) => block.type === "tool_use" && block.name !== undefined);

        if (outputTokens <= 1) {
          // If there's meaningful text (>100 chars) and no tool_use, treat as abandoned
          // (final response where end_turn was never written). Short text may be
          // a genuine intermediate write during active streaming.
          if (textLength > 100 && !hasToolUse) {
            return result;
          }
          // Track that we saw a text-only response (even if short),
          // but only if no tool_result has been seen yet. A text placeholder
          // followed by more tool activity means the session is still active.
          if (textLength > 0 && !hasToolUse && !toolResultSeen) {
            textResponseSeen = true;
          }
          // Otherwise it's a true intermediate placeholder — skip.
          continue;
        }
        // output_tokens >= 2 but disproportionately low vs text length → abandoned
        if (textLength > 10 && outputTokens < textLength / 20) {
          return result;
        }
      }

      // Check for tool_use blocks
      if (Array.isArray(content)) {
        const toolUseBlock = content.find(
          (block: ContentBlock) => block.type === "tool_use" && block.name !== undefined
        );

        if (toolUseBlock && !toolResultSeen) {
          if (PERMISSION_TOOLS.has(toolUseBlock.name!)) {
            const ts = msg.timestamp;
            const age = ts ? Date.now() - new Date(ts).getTime() : Infinity;
            result.isToolUseWaiting = age > 3000;
            result.isWaiting = !result.isToolUseWaiting;
          } else {
            result.isWaiting = true;
          }
          return result;
        }

        if (toolUseBlock && toolResultSeen) {
          // If a text-only response was seen after this tool chain,
          // the assistant already moved past tool execution and started
          // generating a text response. Don't report as waiting.
          if (textResponseSeen) {
            return result;
          }
          result.isWaiting = true;
          return result;
        }
      }

      // stop_reason is null/undefined, no tool_use → actively streaming
      result.isWaiting = true;
      return result;
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

      // Suppress waiting indicators for stale sessions (no messages in 10 min)
      const lastMsgTime = tailMeta.lastTimestamp
        ? new Date(tailMeta.lastTimestamp).getTime()
        : stat.mtime.getTime();
      const msgAge = Date.now() - lastMsgTime;
      const isStale = msgAge > 10 * 60 * 1000;

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
        isWaiting: isStale ? false : tailMeta.isWaiting,
        isToolUseWaiting: isStale ? false : tailMeta.isToolUseWaiting,
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
