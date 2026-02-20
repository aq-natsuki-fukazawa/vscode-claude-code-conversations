import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readTailMetadata } from "./conversationParser";

// --- helpers ---

const tmpFiles: string[] = [];

function createTempJsonl(lines: unknown[]): string {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const filePath = path.join(
    os.tmpdir(),
    `readTailMetadata-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
  );
  fs.writeFileSync(filePath, content, "utf8");
  tmpFiles.push(filePath);
  return filePath;
}

function createTempRaw(content: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `readTailMetadata-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
  );
  fs.writeFileSync(filePath, content, "utf8");
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
  tmpFiles.length = 0;
  vi.restoreAllMocks();
});

// --- message builders ---

function userMsg(
  content: string | unknown[],
  opts: { isMeta?: boolean; isSidechain?: boolean; timestamp?: string } = {}
) {
  return {
    type: "user",
    sessionId: "sess-1",
    timestamp: opts.timestamp ?? "2026-02-19T00:00:00Z",
    ...(opts.isMeta ? { isMeta: true } : {}),
    ...(opts.isSidechain ? { isSidechain: true } : {}),
    message: { role: "user", content },
  };
}

function assistantMsg(
  content: string | unknown[],
  opts: {
    stop_reason?: string | null;
    model?: string;
    isSidechain?: boolean;
    timestamp?: string;
    usage?: { output_tokens?: number };
  } = {}
) {
  return {
    type: "assistant",
    sessionId: "sess-1",
    timestamp: opts.timestamp ?? "2026-02-19T00:00:00Z",
    ...(opts.isSidechain ? { isSidechain: true } : {}),
    message: {
      role: "assistant",
      content,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.stop_reason !== undefined ? { stop_reason: opts.stop_reason } : {}),
      ...(opts.usage ? { usage: opts.usage } : {}),
    },
  };
}

function toolUseBlock(name: string) {
  return { type: "tool_use", name };
}

function toolUseBlockNoName() {
  return { type: "tool_use" };
}

function textBlock(text: string) {
  return { type: "text", text };
}

function toolResultBlock(content: string = "ok") {
  return { type: "tool_result", content };
}

function interruptBlock(text: string = "[Request interrupted by user at 2026-02-19T00:00:00Z") {
  return { type: "text", text };
}

function summaryRecord() {
  return { type: "summary", summary: "conversation summary" };
}

function nonConversationRecord(type: string) {
  return { type };
}

// ============================================================
// Group 0: エラー/空ファイル
// ============================================================
describe("Group 0: Error / Empty file", () => {
  it("T0.1 - file does not exist", () => {
    const result = readTailMetadata("/tmp/nonexistent-file-abc123.jsonl");
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T0.2 - empty file (0 bytes)", () => {
    const f = createTempRaw("");
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T0.3 - whitespace-only lines", () => {
    const f = createTempRaw("\n\n   \n  \n");
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T0.4 - non-JSON lines only", () => {
    const f = createTempRaw("not json\nstill not json\n");
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 1: summary レコード
// ============================================================
describe("Group 1: Summary record", () => {
  it("T1.1 - last line is summary", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      assistantMsg("hi", { stop_reason: "end_turn" }),
      userMsg("bye"),
      summaryRecord(),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T1.2 - summary followed by non-conversation records", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      summaryRecord(),
      nonConversationRecord("custom-title"),
      nonConversationRecord("file-history-snapshot"),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 2: 非会話レコードのみ
// ============================================================
describe("Group 2: Non-conversation records only", () => {
  it("T2.1 - file-history-snapshot only", () => {
    const f = createTempJsonl([
      nonConversationRecord("file-history-snapshot"),
      nonConversationRecord("file-history-snapshot"),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T2.2 - mixed non-conversation records", () => {
    const f = createTempJsonl([
      nonConversationRecord("custom-title"),
      nonConversationRecord("queue-operation"),
      nonConversationRecord("file-history-snapshot"),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 3: sidechain メッセージ
// ============================================================
describe("Group 3: Sidechain messages", () => {
  it("T3.1 - sidechain user only", () => {
    const f = createTempJsonl([
      userMsg("hello", { isSidechain: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T3.2 - sidechain assistant only", () => {
    const f = createTempJsonl([
      assistantMsg("hi", { isSidechain: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T3.3 - sidechain then real user", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      assistantMsg("hi", { stop_reason: "end_turn", isSidechain: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 4: synthetic assistant
// ============================================================
describe("Group 4: Synthetic assistant messages", () => {
  it("T4.1 - synthetic assistant only", () => {
    const f = createTempJsonl([
      assistantMsg("interrupted", { model: "<synthetic>" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T4.2 - synthetic assistant then real user (walking backward)", () => {
    const f = createTempJsonl([
      userMsg("fix this"),
      assistantMsg("interrupted", { model: "<synthetic>" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T4.3 - synthetic assistant then assistant(end_turn) (walking backward)", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      assistantMsg("interrupted", { model: "<synthetic>" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 5: ユーザー中断メッセージ
// ============================================================
describe("Group 5: User interrupt messages", () => {
  it("T5.1 - interrupt message (array content)", () => {
    const f = createTempJsonl([
      userMsg([interruptBlock()]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T5.2 - interrupt with additional content blocks", () => {
    const f = createTempJsonl([
      userMsg([interruptBlock(), textBlock("other stuff")]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T5.3 - string content with interrupt text (NOT detected as interrupt)", () => {
    const f = createTempJsonl([
      userMsg("[Request interrupted by user"),
    ]);
    const result = readTailMetadata(f);
    // String content is NOT checked for interrupt pattern - only array content is
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 6: tool_result ユーザーメッセージ
// ============================================================
describe("Group 6: tool_result user messages", () => {
  it("T6.1 - tool_result only (no preceding assistant)", () => {
    const f = createTempJsonl([
      userMsg([toolResultBlock("ok")]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T6.2 - tool_result then assistant(tool_use:Bash) → toolResultSeen", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], { stop_reason: null, timestamp: "2020-01-01T00:00:00Z" }),
      userMsg([toolResultBlock("ok")]),
    ]);
    const result = readTailMetadata(f);
    // toolResultSeen path: always isWaiting=true regardless of permission tool
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T6.3 - tool_result then assistant(tool_use:Read) → toolResultSeen", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Read")], { stop_reason: null }),
      userMsg([toolResultBlock("file content")]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T6.5 - interrupt + tool_result mixed (interrupt in first block)", () => {
    const f = createTempJsonl([
      userMsg([interruptBlock(), toolResultBlock("ok")]),
    ]);
    const result = readTailMetadata(f);
    // Interrupt check fires first (content[0].text starts with interrupt pattern)
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 7: isMeta ユーザーメッセージ
// ============================================================
describe("Group 7: isMeta user messages", () => {
  it("T7.1 - isMeta only", () => {
    const f = createTempJsonl([
      userMsg("system info", { isMeta: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T7.2 - isMeta then real user", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      userMsg("system info", { isMeta: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T7.3 - isMeta then assistant(end_turn)", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      userMsg("system info", { isMeta: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 8: 通常ユーザーメッセージ（待機中）
// ============================================================
describe("Group 8: Real user message (waiting)", () => {
  it("T8.1 - string content user message", () => {
    const f = createTempJsonl([
      userMsg("Please fix the bug"),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T8.2 - array content user message", () => {
    const f = createTempJsonl([
      userMsg([textBlock("hello")]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T8.3 - user message after non-conversation records", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      nonConversationRecord("file-history-snapshot"),
      nonConversationRecord("custom-title"),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 9: assistant 完了状態
// ============================================================
describe("Group 9: Assistant completed states", () => {
  it("T9.1 - stop_reason: end_turn", () => {
    const f = createTempJsonl([
      assistantMsg("Done!", { stop_reason: "end_turn" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T9.2 - stop_reason: stop_sequence", () => {
    const f = createTempJsonl([
      assistantMsg("Done!", { stop_reason: "stop_sequence" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T9.3 - stop_reason: refusal", () => {
    const f = createTempJsonl([
      assistantMsg("I can't do that.", { stop_reason: "refusal" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 10: assistant + permission tool (toolResultSeen なし)
// ============================================================
describe("Group 10: Assistant with permission tool (no toolResultSeen)", () => {
  it("T10.1 - Bash, old timestamp (>3s) → isToolUseWaiting", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z", // very old
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T10.2 - Bash, fresh timestamp (<3s) → isWaiting", () => {
    const now = new Date(Date.now() - 1000).toISOString(); // 1 second ago
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        timestamp: now,
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T10.3 - Edit, no timestamp → age=Infinity → isToolUseWaiting", () => {
    const f = createTempJsonl([
      {
        type: "assistant",
        sessionId: "sess-1",
        // no timestamp field
        message: {
          role: "assistant",
          content: [toolUseBlock("Edit")],
          stop_reason: null,
        },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T10.4 - ExitPlanMode, exactly 3000ms → age <= 3000 → isWaiting (boundary)", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-19T12:00:03.000Z").getTime());
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("ExitPlanMode")], {
        stop_reason: null,
        timestamp: "2026-02-19T12:00:00.000Z", // exactly 3000ms before mocked now
      }),
    ]);
    const result = readTailMetadata(f);
    // 3000 > 3000 is false, so isToolUseWaiting = false, isWaiting = true
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T10.5 - AskUserQuestion, 3001ms → isToolUseWaiting", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-02-19T12:00:03.001Z").getTime());
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("AskUserQuestion")], {
        stop_reason: null,
        timestamp: "2026-02-19T12:00:00.000Z", // 3001ms before mocked now
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T10.6 - Write, old timestamp", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Write")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T10.7 - NotebookEdit, old timestamp", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("NotebookEdit")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });
});

// ============================================================
// Group 11: assistant + non-permission tool (toolResultSeen なし)
// ============================================================
describe("Group 11: Assistant with non-permission tool (no toolResultSeen)", () => {
  it("T11.1 - Read → isWaiting", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Read")], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T11.2 - Grep → isWaiting", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Grep")], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T11.3 - unknown tool name → isWaiting", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("MyCustomTool")], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 12: assistant + tool_use (toolResultSeen あり)
// ============================================================
describe("Group 12: Assistant with tool_use + toolResultSeen", () => {
  it("T12.1 - permission tool (Bash) + toolResultSeen → isWaiting", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z", // old, but toolResultSeen path doesn't check permission
      }),
      userMsg([toolResultBlock("command output")]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T12.2 - non-permission tool (Read) + toolResultSeen → isWaiting", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Read")], { stop_reason: null }),
      userMsg([toolResultBlock("file content")]),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 13: assistant ストリーミング中 (tool_use なし)
// ============================================================
describe("Group 13: Assistant streaming (no tool_use)", () => {
  it("T13.1 - stop_reason: null, string content", () => {
    const f = createTempJsonl([
      assistantMsg("I'm thinking...", { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.2 - stop_reason: undefined (missing field)", () => {
    const f = createTempJsonl([
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:00:00Z",
        message: {
          role: "assistant",
          content: "streaming...",
          // no stop_reason field
        },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.3 - no message field at all", () => {
    const f = createTempJsonl([
      { type: "assistant", sessionId: "sess-1" },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.4 - array content but no tool_use blocks", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("thinking...")], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.5 - tool_use block but name is undefined", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlockNoName()], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    // tool_use with no name is not found by .find() condition (block.name !== undefined)
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.6 - stop_reason: max_tokens (not a terminal stop reason)", () => {
    const f = createTempJsonl([
      assistantMsg("truncated", { stop_reason: "max_tokens" }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.7 - empty array content, stop_reason null", () => {
    const f = createTempJsonl([
      assistantMsg([], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.8 - output_tokens=1 + 短いテキスト(tool_useなし) → 中間プレースホルダーとしてスキップ", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("これは十分に長いテキストコンテンツです。ストリーミングが中断されました。")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // Text ≤200 chars → still treated as intermediate placeholder, skipped
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13.8b - output_tokens=1 + 長いテキスト(>200文字, tool_useなし) → 中断と判定（待機しない）", () => {
    const longText = "以下のように使われています：\n\n" +
      "**husky** — Git hookを自動設定するツール\n" +
      "- package.jsonのdevDependenciesに含まれている\n" +
      "- .huskyディレクトリにpre-commitフックが設定されている\n" +
      "- commitlintと組み合わせてconventional commits形式を強制している\n\n" +
      "**release-please** — リリース自動化ツール\n" +
      "- conventional commitsを読み取ってsemverバンプとCHANGELOGを自動生成する";
    const f = createTempJsonl([
      assistantMsg([textBlock(longText)], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // Long text (>200 chars) with no tool_use → treated as abandoned final response
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13.9 - 中間プレースホルダー: output_tokens=1 + テキスト短い → スキップ（待機しない）", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("short")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // Placeholder with short text is skipped; no other messages → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13.10 - 正常ストリーミング: output_tokens=100 + テキストあり → 待機中", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("これは十分に長いテキストコンテンツです。正常にストリーミング中。")], {
        stop_reason: null,
        usage: { output_tokens: 100 },
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.11 - usageなし → 既存動作に変更なし (isWaiting: true)", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("テキストコンテンツがありますがusageがありません")], {
        stop_reason: null,
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13.12 - output_tokens=0 + テキストあり → 中間プレースホルダーとしてスキップ", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("テキストがあるのにoutput_tokensが0は中間書き込み")], {
        stop_reason: null,
        usage: { output_tokens: 0 },
      }),
    ]);
    const result = readTailMetadata(f);
    // Placeholder skipped; no other messages → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13.13 - output_tokens=1 + string content → 中間プレースホルダーとしてスキップ", () => {
    const f = createTempJsonl([
      assistantMsg("これは文字列コンテンツです。長いですが配列ではありません。", {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // string content → textLength is 0 → placeholder skipped → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13.14 - output_tokens=2 + 長いテキスト → 中断と判定（比率ベース）", () => {
    const longText = "これは十分に長いテキストコンテンツです。output_tokensが2しかないのに700文字以上のテキストがある場合、中間書き込みが残った状態です。" +
      "実際にはストリーミングが完了しているにもかかわらず、最終的なstop_reasonが書き込まれなかったケースを検出します。";
    const f = createTempJsonl([
      assistantMsg([textBlock(longText)], {
        stop_reason: null,
        usage: { output_tokens: 2 },
      }),
    ]);
    const result = readTailMetadata(f);
    // textLength > 10 && output_tokens (2) < textLength / 20 → abandoned
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13.15 - output_tokens がテキスト量に見合う → 正常ストリーミング", () => {
    // 40文字のテキスト, output_tokens=10 → 10 < 40/20 (=2) は false → 正常
    const f = createTempJsonl([
      assistantMsg([textBlock("これは40文字程度のテキストコンテンツです。正常にストリーミング中。")], {
        stop_reason: null,
        usage: { output_tokens: 10 },
      }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 13b: 中間プレースホルダー + tool_use（ストリーミング中書き込み）
// ============================================================
describe("Group 13b: Intermediate placeholder with tool_use", () => {
  it("T13b.1 - output_tokens=1 + tool_use → プレースホルダーはスキップされる", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    // Placeholder skipped, no other messages → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13b.2 - プレースホルダー(tool_use)の前に実ユーザーメッセージ → 待機中", () => {
    const f = createTempJsonl([
      userMsg("fix this bug"),
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    // Placeholder skipped, real user message found → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13b.3 - プレースホルダー(tool_use)の前にassistant(end_turn) → 待機しない", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      assistantMsg([toolUseBlock("Edit")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    // Placeholder skipped, end_turn found → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13b.4 - 複数プレースホルダー → すべてスキップされる", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      assistantMsg([textBlock("thinking...")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // Both placeholders skipped, end_turn found → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13b.5 - output_tokens=2 + tool_use → 通常のtool_use検出", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 2 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    // output_tokens > 1 → not a placeholder → normal tool_use detection
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T13b.6 - output_tokens=1 + tool_use + 長いテキスト → プレースホルダーとしてスキップ", () => {
    const f = createTempJsonl([
      assistantMsg(
        [textBlock("これは十分に長いテキストです。ストリーミング中に中断されました。"), toolUseBlock("Bash")],
        {
          stop_reason: null,
          usage: { output_tokens: 1 },
          timestamp: "2020-01-01T00:00:00Z",
        }
      ),
    ]);
    const result = readTailMetadata(f);
    // Placeholder skipped; no other messages → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13b.7 - 長いセッション: 中間テキスト(output_tokens=1)の前にtool_use → 正しくtool_waiting検出", () => {
    // Real-world pattern from long sessions: text placeholder + tool_use placeholder + tool_result
    // Walking backwards: tool_result → toolResultSeen, tool_use placeholder → skip,
    // text placeholder → skip, real tool_use → tool_waiting
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 19 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
      userMsg([toolResultBlock("command output")]),
      assistantMsg([textBlock("ダメです。正常区間でも大量にevent=trueが出ています。threshold=0.55は低すぎです。")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
      userMsg([toolResultBlock("more output")]),
    ]);
    const result = readTailMetadata(f);
    // tool_result → toolResultSeen, tool_use placeholder → skip, text placeholder → skip,
    // tool_result → toolResultSeen (already), tool_use(Bash, out_tok=19) + toolResultSeen → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T13b.7b - 短いテキスト(output_tokens=1) + file-history-snapshot後のtool_chain → 待機しない", () => {
    // Real-world pattern: session completed with a short text response (output_tokens=1),
    // followed by file-history-snapshots. Without the fix, the backward walk skips the
    // placeholder and falls through to an older tool_use+toolResultSeen pair.
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        usage: { output_tokens: 19 },
        timestamp: "2020-01-01T00:00:00Z",
      }),
      userMsg([toolResultBlock("command output")]),
      assistantMsg([textBlock("コミットしました: `280d12e`")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
      nonConversationRecord("file-history-snapshot"),
      nonConversationRecord("file-history-snapshot"),
    ]);
    const result = readTailMetadata(f);
    // text placeholder (no toolResultSeen yet) → textResponseSeen=true
    // tool_result → toolResultSeen, but textResponseSeen prevents isWaiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T13b.8 - 中間テキスト(output_tokens=1)の前にユーザーメッセージ → 待機中", () => {
    const f = createTempJsonl([
      userMsg("これを修正して"),
      assistantMsg([textBlock("了解です。まず確認します。")], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // Placeholder skipped, real user message found → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 14: 複数 tool_use ブロック
// ============================================================
describe("Group 14: Multiple tool_use blocks", () => {
  it("T14.1 - text + tool_use(Bash), old timestamp", () => {
    const f = createTempJsonl([
      assistantMsg([textBlock("Let me run that"), toolUseBlock("Bash")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    // .find() gets Bash (the first tool_use with name), it's a permission tool, old → isToolUseWaiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T14.2 - [Read, Bash] → find() returns first (Read, non-permission)", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Read"), toolUseBlock("Bash")], {
        stop_reason: null,
      }),
    ]);
    const result = readTailMetadata(f);
    // .find() returns Read first, which is NOT a permission tool → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T14.3 - [Bash, Read] → find() returns first (Bash, permission), old", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash"), toolUseBlock("Read")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z",
      }),
    ]);
    const result = readTailMetadata(f);
    // .find() returns Bash first, permission tool, old → isToolUseWaiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: true });
  });

  it("T14.4 - tool_use with empty string name → not in PERMISSION_TOOLS", () => {
    const f = createTempJsonl([
      assistantMsg([{ type: "tool_use", name: "" }], { stop_reason: null }),
    ]);
    const result = readTailMetadata(f);
    // name "" !== undefined, so toolUseBlock is found. PERMISSION_TOOLS.has("") is false
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 15: 複合シナリオ
// ============================================================
describe("Group 15: Complex multi-message scenarios", () => {
  it("T15.1 - sidechain user → assistant(end_turn)", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      userMsg("sidechain", { isSidechain: true }),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T15.2 - isMeta → tool_result → assistant(tool_use:Bash, old)", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], {
        stop_reason: null,
        timestamp: "2020-01-01T00:00:00Z",
      }),
      userMsg([toolResultBlock("ok")]),
      userMsg("meta info", { isMeta: true }),
    ]);
    const result = readTailMetadata(f);
    // Walking backward: isMeta skipped, tool_result sets toolResultSeen,
    // assistant with tool_use + toolResultSeen → isWaiting (line 290)
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T15.3 - synthetic → interrupt → assistant(tool_use)", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Bash")], { stop_reason: null }),
      userMsg([interruptBlock()]),
      assistantMsg("interrupted", { model: "<synthetic>" }),
    ]);
    const result = readTailMetadata(f);
    // Walking backward: synthetic skipped, interrupt user → returns default
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T15.4 - non-conversation records interleaved between tool_result and assistant", () => {
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Read")], { stop_reason: null }),
      nonConversationRecord("file-history-snapshot"),
      userMsg([toolResultBlock("data")]),
    ]);
    const result = readTailMetadata(f);
    // tool_result sets toolResultSeen, file-history-snapshot skipped, assistant + toolResultSeen
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T15.5 - real user behind sidechain + synthetic + non-conversation", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      assistantMsg("side", { isSidechain: true }),
      assistantMsg("syn", { model: "<synthetic>" }),
      nonConversationRecord("custom-title"),
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T15.6 - summary between waiting-state messages cancels waiting", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      summaryRecord(),
      userMsg("new message"),
    ]);
    const result = readTailMetadata(f);
    // Walking backward: "new message" → isWaiting true (returns immediately on first real user)
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T15.7 - assistant(end_turn) as most recent effective message", () => {
    const f = createTempJsonl([
      assistantMsg("streaming...", { stop_reason: null }),
      userMsg("more info"),
      assistantMsg("done", { stop_reason: "end_turn" }),
      nonConversationRecord("file-history-snapshot"),
    ]);
    const result = readTailMetadata(f);
    // Walking backward: non-conversation skipped, assistant(end_turn) → returns default
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T15.8 - output_tokens=1の最終応答 + file-history-snapshot + tool_result/tool_use → 待機しない", () => {
    // Regression: real-world pattern where final response has output_tokens=1
    // and stop_reason=null, followed by file-history-snapshot records.
    // Without the fix, the code skips the final response and falls through to
    // an older tool_use+toolResultSeen pair, incorrectly showing loading state.
    const longResponse = "以下のように使われています：\n\n" +
      "**husky** — Git hookを自動設定するツール\n" +
      "- package.jsonのdevDependenciesに含まれている\n" +
      "- .huskyディレクトリにpre-commitフックが設定されている\n" +
      "- commitlintと組み合わせてconventional commits形式を強制している\n\n" +
      "**release-please** — リリース自動化ツール\n" +
      "- conventional commitsを読み取ってsemverバンプとCHANGELOGを自動生成する";
    const f = createTempJsonl([
      assistantMsg([toolUseBlock("Read")], {
        stop_reason: null,
        usage: { output_tokens: 25 },
      }),
      userMsg([toolResultBlock("file content")]),
      assistantMsg([toolUseBlock("Read")], {
        stop_reason: null,
        usage: { output_tokens: 25 },
      }),
      userMsg([toolResultBlock("more content")]),
      assistantMsg([textBlock(longResponse)], {
        stop_reason: null,
        usage: { output_tokens: 1 },
        timestamp: "2026-02-19T07:57:01.668Z",
      }),
      nonConversationRecord("file-history-snapshot"),
      nonConversationRecord("file-history-snapshot"),
      nonConversationRecord("file-history-snapshot"),
      nonConversationRecord("file-history-snapshot"),
    ]);
    const result = readTailMetadata(f);
    // file-history-snapshots skipped, final assistant has long text + no tool_use
    // → treated as abandoned (completed) response, not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 16: content の形状エッジケース
// ============================================================
describe("Group 16: Content shape edge cases", () => {
  it("T16.1 - user message with content: null", () => {
    const f = createTempJsonl([
      {
        type: "user",
        sessionId: "sess-1",
        message: { role: "user", content: null },
      },
    ]);
    const result = readTailMetadata(f);
    // null is not an array, falls through to isMeta check (false), → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T16.2 - user message with no content field", () => {
    const f = createTempJsonl([
      {
        type: "user",
        sessionId: "sess-1",
        message: { role: "user" },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T16.3 - user message with no message field", () => {
    const f = createTempJsonl([
      { type: "user", sessionId: "sess-1" },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T16.4 - user message with empty array content", () => {
    const f = createTempJsonl([
      userMsg([]),
    ]);
    const result = readTailMetadata(f);
    // content[0] is undefined, text is "", not interrupt. [].some() is false. Not isMeta. → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T16.5 - assistant with stop_reason 'tool_use' but no tool_use blocks in content", () => {
    const f = createTempJsonl([
      assistantMsg("text only", { stop_reason: "tool_use" }),
    ]);
    const result = readTailMetadata(f);
    // "tool_use" is not end_turn/stop_sequence/refusal. Content is string. Falls to isWaiting.
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T16.6 - user with array content, first block has no text (e.g. image)", () => {
    const f = createTempJsonl([
      userMsg([{ type: "image" }]),
    ]);
    const result = readTailMetadata(f);
    // content[0].text is undefined → text = "". Not interrupt. No tool_result. Not isMeta. → isWaiting
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 17: customTitle は readTailMetadata では設定されない
// ============================================================
describe("Group 17: customTitle is never set", () => {
  it("T17.1 - customTitle is always undefined", () => {
    const f = createTempJsonl([userMsg("hello")]);
    const result = readTailMetadata(f);
    expect(result.customTitle).toBeUndefined();
  });

  it("T17.2 - customTitle undefined even with custom-title records in file", () => {
    const f = createTempJsonl([
      { type: "custom-title", customTitle: "My Title" },
      userMsg("hello"),
    ]);
    const result = readTailMetadata(f);
    expect(result.customTitle).toBeUndefined();
  });
});

// ============================================================
// Group 18: JSON with missing/extra type field
// ============================================================
describe("Group 18: JSON with missing/extra type field", () => {
  it("T18.1 - JSON object with no type field", () => {
    const f = createTempJsonl([
      { message: { content: "hello" } },
    ]);
    const result = readTailMetadata(f);
    // type is undefined, not "summary", not user/assistant → skip
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T18.2 - JSON object with type = unknown", () => {
    const f = createTempJsonl([
      { type: "unknown" },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T18.3 - summary record with no other fields", () => {
    const f = createTempJsonl([
      { type: "summary" },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 19: 16KB boundary / truncation
// ============================================================
describe("Group 19: 16KB boundary handling", () => {
  it("T19.1 - file larger than 16KB, relevant messages in last 16KB", () => {
    // Create a file with lots of padding then a real user message at the end
    const padding = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({ type: "file-history-snapshot", data: "x".repeat(100), idx: i })
    ).join("\n");
    const lastLine = JSON.stringify(userMsg("hello"));
    const content = padding + "\n" + lastLine + "\n";

    const filePath = createTempRaw(content);
    const stat = fs.statSync(filePath);
    // Verify it's actually > 16KB
    expect(stat.size).toBeGreaterThan(16384);

    const result = readTailMetadata(filePath);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });

  it("T19.2 - truncated first line in buffer is gracefully skipped", () => {
    // Create a file where the first line in the 16KB buffer is cut mid-JSON
    const longLine = JSON.stringify({
      type: "file-history-snapshot",
      data: "x".repeat(20000), // This will be at the start, partially cut off
    });
    const lastLine = JSON.stringify(
      assistantMsg("done", { stop_reason: "end_turn" })
    );
    const content = longLine + "\n" + lastLine + "\n";

    const filePath = createTempRaw(content);
    const result = readTailMetadata(filePath);
    // Truncated line fails JSON.parse → skipped. end_turn → not waiting.
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 19: システム生成ユーザーメッセージのスキップ
// ============================================================
describe("Group 19: System-generated user messages", () => {
  it("T19.1 - task-notification userメッセージ → real userとみなさずスキップ", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      {
        type: "user",
        sessionId: "sess-1",
        message: {
          role: "user",
          content: '<task-notification>\n<task-id>b26a07c</task-id>\n<status>completed</status>\n</task-notification>',
        },
      },
    ]);
    const result = readTailMetadata(f);
    // task-notification starts with "<" → skipped, previous assistant end_turn → not waiting
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T19.2 - task-notification + output_tokens=1のassistant → 中断と判定", () => {
    const midText = "Producer完了しましたが、AWSトークン期限切れのため処理できませんでした。トークンを更新後、以下で再テストできます。docker compose restart kvs_getmedia";
    const f = createTempJsonl([
      {
        type: "user",
        sessionId: "sess-1",
        message: {
          role: "user",
          content: '<task-notification>\n<task-id>b26a07c</task-id>\n<status>completed</status>\n</task-notification>',
        },
      },
      assistantMsg([textBlock(midText)], {
        stop_reason: null,
        usage: { output_tokens: 1 },
      }),
    ]);
    const result = readTailMetadata(f);
    // output_tokens=1 + text > 100 chars → abandoned; even if not, task-notification skipped
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T19.3 - XMLタグで始まるuserメッセージ(system-reminder等) → スキップ", () => {
    const f = createTempJsonl([
      assistantMsg("done", { stop_reason: "end_turn" }),
      {
        type: "user",
        sessionId: "sess-1",
        message: {
          role: "user",
          content: '<system-reminder>Some internal state</system-reminder>',
        },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: false, isToolUseWaiting: false });
  });

  it("T19.4 - 通常のuserメッセージ(テキスト) → 引き続きisWaiting=true", () => {
    const f = createTempJsonl([
      {
        type: "user",
        sessionId: "sess-1",
        message: {
          role: "user",
          content: "こんにちは、修正してください",
        },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result).toMatchObject({ isWaiting: true, isToolUseWaiting: false });
  });
});

// ============================================================
// Group 20: gitBranch extraction from tail
// ============================================================
describe("Group 20: gitBranch extraction from tail", () => {
  it("T20.1 - gitBranch is extracted from the most recent user/assistant message", () => {
    const f = createTempJsonl([
      {
        type: "user",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:00:00Z",
        gitBranch: "main",
        message: { role: "user", content: "hello" },
      },
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:00:01Z",
        gitBranch: "worktree-feature-branch",
        message: { role: "assistant", content: "hi", stop_reason: "end_turn" },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result.gitBranch).toBe("worktree-feature-branch");
  });

  it("T20.2 - gitBranch from tail reflects worktree switch mid-session", () => {
    const f = createTempJsonl([
      {
        type: "user",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:00:00Z",
        gitBranch: "main",
        message: { role: "user", content: "switch to worktree" },
      },
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:00:01Z",
        gitBranch: "main",
        message: { role: "assistant", content: "ok", stop_reason: "end_turn" },
      },
      {
        type: "user",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:01:00Z",
        gitBranch: "worktree-new-feature",
        message: { role: "user", content: "now on worktree" },
      },
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:01:01Z",
        gitBranch: "worktree-new-feature",
        message: { role: "assistant", content: "got it", stop_reason: "end_turn" },
      },
    ]);
    const result = readTailMetadata(f);
    expect(result.gitBranch).toBe("worktree-new-feature");
  });

  it("T20.3 - no gitBranch in any message", () => {
    const f = createTempJsonl([
      userMsg("hello"),
      assistantMsg("hi", { stop_reason: "end_turn" }),
    ]);
    const result = readTailMetadata(f);
    expect(result.gitBranch).toBeUndefined();
  });

  it("T20.4 - sidechain messages are skipped for gitBranch extraction", () => {
    const f = createTempJsonl([
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:00:00Z",
        gitBranch: "main",
        message: { role: "assistant", content: "done", stop_reason: "end_turn" },
      },
      {
        type: "user",
        sessionId: "sess-1",
        timestamp: "2026-02-19T00:01:00Z",
        gitBranch: "worktree-sidechain",
        isSidechain: true,
        message: { role: "user", content: "side" },
      },
    ]);
    const result = readTailMetadata(f);
    // Sidechain is skipped, so gitBranch comes from the assistant message
    expect(result.gitBranch).toBe("main");
  });
});
