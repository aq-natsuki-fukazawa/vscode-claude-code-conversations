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

interface WaitingState {
  isWaiting: boolean;        // last message is user → waiting for Claude's response
  isToolUseWaiting: boolean; // last assistant message has tool_use → waiting for permission
}

/**
 * Track file sizes between polls to detect active conversations.
 * Key: filePath, Value: { size, lastChangedAt }
 */
const fileActivity = new Map<string, { size: number; lastChangedAt: number }>();

/**
 * Determine if a file is actively being written to.
 * - If file size changed since last check → active
 * - If file size unchanged but last change was recent (< STALE_MS) → still active
 * - Otherwise → inactive (abandoned)
 */
const STALE_MS = 10 * 60 * 1000; // 10 minutes with no file size change → inactive

function isFileActive(filePath: string, currentSize: number): boolean {
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
    return isRecent;
  }

  if (prev.size !== currentSize) {
    // Size changed → active
    fileActivity.set(filePath, { size: currentSize, lastChangedAt: now });
    return true;
  }

  // Size unchanged — still active if last change was recent
  return (now - prev.lastChangedAt) < STALE_MS;
}

/**
 * Read last N bytes of a file to detect waiting states.
 * - isWaiting: last real message is from the user (waiting for response)
 * - isToolUseWaiting: last assistant message has tool_use blocks without subsequent tool_result
 *
 * Uses file-size-change tracking to distinguish active vs abandoned conversations.
 */
function detectWaitingState(filePath: string): WaitingState {
  const result: WaitingState = { isWaiting: false, isToolUseWaiting: false };
  try {
    const stat = fs.statSync(filePath);

    // Check if the file is actively being written to
    if (!isFileActive(filePath, stat.size)) {
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

    // Walk backwards to find last user or assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "assistant" && !obj.isSidechain) {
          // Check if assistant message contains tool_use blocks
          const content = obj.message?.content;
          if (Array.isArray(content)) {
            const hasToolUse = content.some(
              (block: ContentBlock) => block.type === "tool_use"
            );
            if (hasToolUse) {
              result.isToolUseWaiting = true;
            }
          }
          return result;
        }
        if (obj.type === "user" && !obj.isMeta && !obj.isSidechain) {
          result.isWaiting = true;
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

      const waitingState = detectWaitingState(filePath);

      resolve({
        sessionId,
        title,
        timestamp: stat.mtime,
        filePath,
        messageCount: estimatedMessages,
        model,
        gitBranch,
        projectPath,
        projectDir,
        isPinned: false,
        isWaiting: waitingState.isWaiting,
        isToolUseWaiting: waitingState.isToolUseWaiting,
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
