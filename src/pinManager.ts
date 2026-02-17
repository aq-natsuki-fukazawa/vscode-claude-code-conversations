import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PIN_FILE = path.join(
  os.homedir(),
  ".claude",
  "conversation-pins.json"
);

interface PinData {
  pinnedSessionIds: string[];
}

function readPinData(): PinData {
  try {
    if (fs.existsSync(PIN_FILE)) {
      const raw = fs.readFileSync(PIN_FILE, "utf8");
      return JSON.parse(raw);
    }
  } catch {
    // corrupted file, reset
  }
  return { pinnedSessionIds: [] };
}

function writePinData(data: PinData): void {
  const dir = path.dirname(PIN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PIN_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function getPinnedSessionIds(): Set<string> {
  return new Set(readPinData().pinnedSessionIds);
}

export function pinSession(sessionId: string): void {
  const data = readPinData();
  if (!data.pinnedSessionIds.includes(sessionId)) {
    data.pinnedSessionIds.push(sessionId);
    writePinData(data);
  }
}

export function unpinSession(sessionId: string): void {
  const data = readPinData();
  data.pinnedSessionIds = data.pinnedSessionIds.filter((id) => id !== sessionId);
  writePinData(data);
}

export function isPinned(sessionId: string): boolean {
  return getPinnedSessionIds().has(sessionId);
}
