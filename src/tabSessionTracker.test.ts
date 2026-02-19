import { describe, it, expect } from "vitest";
import { normalizeTabTitle } from "./tabTitleUtils";

describe("normalizeTabTitle", () => {
  // ============================================================
  // 基本的な短いタイトル（25文字以下）
  // ============================================================
  describe("短いタイトル（truncateなし）", () => {
    it("通常の短い文字列はそのまま返す", () => {
      expect(normalizeTabTitle("hello world")).toBe("hello world");
    });

    it("空文字列はそのまま返す", () => {
      expect(normalizeTabTitle("")).toBe("");
    });

    it("25文字ちょうどはtruncateしない", () => {
      const title = "a".repeat(25);
      expect(normalizeTabTitle(title)).toBe(title);
    });
  });

  // ============================================================
  // 長いタイトル（25文字超 → truncate）
  // ============================================================
  describe("長いタイトル（truncateあり）", () => {
    it("26文字はtruncateされる", () => {
      const title = "a".repeat(26);
      expect(normalizeTabTitle(title)).toBe("a".repeat(24) + "…");
    });

    it("60文字のタイトルはtruncateされる", () => {
      const title = "This is a very long conversation title that exceeds limit!!";
      const result = normalizeTabTitle(title);
      expect(result.length).toBe(25);
      expect(result.endsWith("…")).toBe(true);
      expect(result).toBe("This is a very long conv…");
    });
  });

  // ============================================================
  // 改行を含むタイトル
  // ============================================================
  describe("改行を含むタイトル", () => {
    it("LFが含まれる場合はスペースに置換される", () => {
      expect(normalizeTabTitle("hello\nworld")).toBe("hello world");
    });

    it("CRLFが含まれる場合はスペースに置換される", () => {
      expect(normalizeTabTitle("hello\r\nworld")).toBe("hello world");
    });

    it("連続する改行は1つのスペースに置換される", () => {
      expect(normalizeTabTitle("hello\n\n\nworld")).toBe("hello world");
    });

    it("先頭の改行はtrimされる", () => {
      expect(normalizeTabTitle("\nhello")).toBe("hello");
    });

    it("末尾の改行はtrimされる", () => {
      expect(normalizeTabTitle("hello\n")).toBe("hello");
    });

    it("改行のみの文字列は空文字になる", () => {
      expect(normalizeTabTitle("\n\n\n")).toBe("");
    });

    it("改行を含む長いタイトルは正規化後にtruncateされる", () => {
      const title = "first line\nsecond line that makes it very long indeed";
      const result = normalizeTabTitle(title);
      // "first line second line t…" (24 chars + …)
      expect(result.length).toBe(25);
      expect(result.endsWith("…")).toBe(true);
      expect(result).toBe("first line second line t…");
    });

    it("改行をスペースに置換しても文字数は変わらないのでtruncateされる", () => {
      // "abcdefghijklmnopqrstuvwx\nz" → "abcdefghijklmnopqrstuvwx z" (26文字) → truncate
      const title = "abcdefghijklmnopqrstuvwx\nz";
      expect(normalizeTabTitle(title)).toBe("abcdefghijklmnopqrstuvwx…");
    });

    it("改行がtrimされて25文字以下になる場合はtruncateしない", () => {
      // "abcdefghijklmnopqrstuvwxy\n" → trim → "abcdefghijklmnopqrstuvwxy" (25文字)
      const title = "abcdefghijklmnopqrstuvwxy\n";
      expect(normalizeTabTitle(title)).toBe("abcdefghijklmnopqrstuvwxy");
    });
  });

  // ============================================================
  // タブ文字を含むタイトル
  // ============================================================
  describe("タブ文字を含むタイトル", () => {
    it("タブはスペースに置換される", () => {
      expect(normalizeTabTitle("hello\tworld")).toBe("hello world");
    });

    it("連続タブは1つのスペースに置換される", () => {
      expect(normalizeTabTitle("hello\t\tworld")).toBe("hello world");
    });
  });

  // ============================================================
  // 空白の正規化
  // ============================================================
  describe("空白の正規化", () => {
    it("連続スペースは1つにまとめられる", () => {
      expect(normalizeTabTitle("hello   world")).toBe("hello world");
    });

    it("先頭スペースはtrimされる", () => {
      expect(normalizeTabTitle("  hello")).toBe("hello");
    });

    it("末尾スペースはtrimされる", () => {
      expect(normalizeTabTitle("hello  ")).toBe("hello");
    });

    it("改行+スペースの混合は1つのスペースになる", () => {
      expect(normalizeTabTitle("hello \n world")).toBe("hello world");
    });
  });

  // ============================================================
  // Unicode文字を含むタイトル
  // ============================================================
  describe("Unicode文字を含むタイトル", () => {
    it("日本語タイトルは正常にtruncateされる", () => {
      const title = "これは非常に長い日本語の会話タイトルです。テストのためのものです。";
      const result = normalizeTabTitle(title);
      expect(result.length).toBe(25);
      expect(result.endsWith("…")).toBe(true);
    });

    it("絵文字を含むタイトル（サロゲートペア）", () => {
      // 🎉 is a surrogate pair (2 UTF-16 code units)
      const title = "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉";
      const result = normalizeTabTitle(title);
      // Each emoji is 2 code units, 13 emojis = 26 code units > 25
      // substring(0, 24) may split a surrogate pair
      expect(result.endsWith("…")).toBe(true);
    });

    it("日本語+改行の組み合わせ", () => {
      expect(normalizeTabTitle("日本語\nテスト")).toBe("日本語 テスト");
    });
  });

  // ============================================================
  // 特殊なエッジケース
  // ============================================================
  describe("特殊なエッジケース", () => {
    it("スペースのみの文字列は空文字になる", () => {
      expect(normalizeTabTitle("   ")).toBe("");
    });

    it("混合空白（スペース+タブ+改行）のみは空文字になる", () => {
      expect(normalizeTabTitle(" \t \n \r\n ")).toBe("");
    });

    it("制御文字（NULL）は保持される", () => {
      // NUL文字は改行やタブではないので置換されない
      const title = "hello\x00world";
      expect(normalizeTabTitle(title)).toBe("hello\x00world");
    });

    it("実際のClaude Codeタイトル: 25文字ちょうどはtruncateしない", () => {
      // "npm run build && npm test" = 25文字
      expect(normalizeTabTitle("npm run build && npm test")).toBe("npm run build && npm test");
    });

    it("実際のClaude Codeタイトル: コマンド入力を含む（26文字以上）", () => {
      expect(normalizeTabTitle("npm run build && npm test!")).toBe("npm run build && npm tes…");
    });

    it("実際のClaude Codeタイトル: ファイルパスを含む", () => {
      expect(normalizeTabTitle("src/components/Header.tsx のバグを修正")).toBe("src/components/Header.ts…");
    });

    it("実際のClaude Codeタイトル: 複数行のプロンプト", () => {
      const title = "以下を修正してください\n- バグA\n- バグB";
      expect(normalizeTabTitle(title)).toBe("以下を修正してください - バグA - バグB");
    });

    it("正規化前に25文字以下、正規化後に25文字超のケース（ありえないが安全確認）", () => {
      // 改行をスペースに変換しても文字数は変わらない（同じ1文字）
      // ただしtrimで減ることはある
      const title = "a".repeat(24) + "\n"; // 25 chars → trimで24 chars
      expect(normalizeTabTitle(title)).toBe("a".repeat(24));
    });
  });
});
