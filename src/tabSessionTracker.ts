import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execSync } from "child_process";

/**
 * Tracks which Claude Code sessions are open as editor tabs.
 * Uses VSCode's internal SQLite state database to map tab titles → session IDs,
 * then matches against runtime tab labels.
 */
const log = vscode.window.createOutputChannel("Claude Conversations");

export class TabSessionTracker {
  // sessionId → tab title (from SQLite)
  private sessionToTitle = new Map<string, string>();
  // title → sessionId (reverse lookup)
  private titleToSession = new Map<string, string>();

  constructor() {
    this.readFromSqlite();
    this.trackTabChanges();
    this.logState();
  }

  private logState(): void {
    log.appendLine("=== TabSessionTracker initialized ===");
    log.appendLine(`SQLite mappings: ${this.sessionToTitle.size}`);
    for (const [sid, title] of this.sessionToTitle) {
      log.appendLine(`  sid=${sid} → title=${JSON.stringify(title)}`);
    }
    let webviewCount = 0;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputWebview) {
          webviewCount++;
          const vt = (tab.input as vscode.TabInputWebview).viewType;
          const isClaude = vt.includes("claudeVSCodePanel");
          log.appendLine(`  WebView tab: label=${JSON.stringify(tab.label)} viewType=${JSON.stringify(vt)} isClaude=${isClaude}`);
        }
      }
    }
    if (webviewCount === 0) {
      log.appendLine("  (no WebView tabs found)");
    }
  }

  /**
   * Read VSCode's internal state.vscdb to get title↔sessionId mappings
   * for currently persisted Claude Code editor panels.
   */
  private readFromSqlite(): void {
    try {
      const workspacePath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) return;

      const storagePath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Code",
        "User",
        "workspaceStorage"
      );

      if (!fs.existsSync(storagePath)) return;

      // Find workspace hash by matching workspace.json
      let hash: string | undefined;
      for (const dir of fs.readdirSync(storagePath)) {
        const wsJsonPath = path.join(storagePath, dir, "workspace.json");
        try {
          const wsJson = JSON.parse(fs.readFileSync(wsJsonPath, "utf8"));
          if (wsJson.folder === `file://${workspacePath}`) {
            hash = dir;
            break;
          }
        } catch {
          // skip
        }
      }

      if (!hash) return;

      const dbPath = path.join(storagePath, hash, "state.vscdb");
      if (!fs.existsSync(dbPath)) return;

      // Read SQLite via CLI (built-in on macOS). Use -readonly to avoid lock issues.
      const result = execSync(
        `sqlite3 -readonly "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'memento/workbench.parts.editor'"`,
        { timeout: 5000, encoding: "utf8" }
      );

      if (!result?.trim()) return;

      const editorState = JSON.parse(result.trim());
      this.extractSessions(editorState);
    } catch {
      // Database locked, format changed, or sqlite3 not available — silently ignore
    }
  }

  /**
   * Recursively walk the editor state JSON to find Claude Code webview panels
   * and extract their title + sessionId.
   * Handles multiply-nested JSON strings (VSCode stores editors as escaped JSON).
   */
  private extractSessions(obj: unknown): void {
    if (typeof obj === "string") {
      // Try parsing JSON strings (VSCode nests JSON as escaped strings)
      try {
        const parsed = JSON.parse(obj);
        this.extractSessions(parsed);
      } catch {
        // not JSON, skip
      }
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractSessions(item);
      }
      return;
    }

    if (!obj || typeof obj !== "object") return;

    const rec = obj as Record<string, unknown>;

    // Match Claude Code webview panels in the editor state
    const viewType = String(rec.viewType ?? "");
    const providedId = String(rec.providedId ?? "");
    if (
      (viewType.includes("claudeVSCodePanel") ||
        providedId === "claudeVSCodePanel") &&
      typeof rec.state === "string" &&
      typeof rec.title === "string"
    ) {
      try {
        const state = JSON.parse(rec.state);
        if (state.sessionID) {
          this.sessionToTitle.set(state.sessionID, rec.title);
          this.titleToSession.set(rec.title, state.sessionID);
        }
      } catch {
        // skip
      }
    }

    for (const key of Object.keys(rec)) {
      this.extractSessions(rec[key]);
    }
  }

  /**
   * Track runtime tab changes to keep our mapping up to date.
   * When a new Claude Code tab appears with a title that matches one of our
   * conversation titles, record the mapping.
   */
  private trackTabChanges(): void {
    vscode.window.tabGroups.onDidChangeTabs(() => {
      // Update title→session mapping for newly renamed tabs
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (
            tab.input instanceof vscode.TabInputWebview &&
            (tab.input as vscode.TabInputWebview).viewType ===
              "claudeVSCodePanel" &&
            tab.label !== "Claude Code"
          ) {
            // If we already have a session for this title, keep it.
            // Otherwise it's a new tab we don't know the session for yet.
          }
        }
      }
    });
  }

  /**
   * Register a mapping when we open a session (so we can track it at runtime).
   */
  registerOpen(sessionId: string, conversationTitle: string): void {
    // Claude Code truncates: title.length > 25 ? title.slice(0,24)+"…" : title
    const tabTitle =
      conversationTitle.length > 25
        ? conversationTitle.substring(0, 24) + "…"
        : conversationTitle;
    this.sessionToTitle.set(sessionId, tabTitle);
    this.titleToSession.set(tabTitle, sessionId);
  }

  /**
   * Find a Claude Code tab that's showing the given session.
   * Returns the Tab + its group index if found.
   */
  findTabForSession(
    sessionId: string
  ): { tab: vscode.Tab; groupIndex: number; tabIndex: number } | undefined {
    const title = this.sessionToTitle.get(sessionId);
    log.appendLine(`findTabForSession: sid=${sessionId} → expected title=${JSON.stringify(title)}`);
    if (!title) return undefined;

    for (let gi = 0; gi < vscode.window.tabGroups.all.length; gi++) {
      const group = vscode.window.tabGroups.all[gi];
      for (let ti = 0; ti < group.tabs.length; ti++) {
        const tab = group.tabs[ti];
        if (
          tab.input instanceof vscode.TabInputWebview &&
          (tab.input as vscode.TabInputWebview).viewType.includes("claudeVSCodePanel")
        ) {
          const match = tab.label === title;
          log.appendLine(`  tab[${gi}][${ti}]: label=${JSON.stringify(tab.label)} match=${match}`);
          if (match) {
            return { tab, groupIndex: gi, tabIndex: ti };
          }
        }
      }
    }

    log.appendLine("  → no matching tab found");
    return undefined;
  }

  /**
   * Try to focus an existing Claude Code tab.
   * Uses editor group focus + tab index navigation.
   */
  async focusTab(info: {
    tab: vscode.Tab;
    groupIndex: number;
    tabIndex: number;
  }): Promise<boolean> {
    try {
      // Focus the editor group containing the tab
      const groupCommands = [
        "workbench.action.focusFirstEditorGroup",
        "workbench.action.focusSecondEditorGroup",
        "workbench.action.focusThirdEditorGroup",
      ];

      if (info.groupIndex < groupCommands.length) {
        await vscode.commands.executeCommand(
          groupCommands[info.groupIndex]
        );
      }

      // Navigate to the specific tab by index (0-based)
      await vscode.commands.executeCommand(
        "workbench.action.openEditorAtIndex",
        info.tabIndex
      );

      return true;
    } catch {
      return false;
    }
  }
}
