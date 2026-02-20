import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConversationProvider, ConversationItem } from "./conversationProvider";
import { pinSession, unpinSession, isPinned } from "./pinManager";
import { getClaudeProjectsDir } from "./conversationParser";
import { ConversationMeta } from "./types";
import { TabSessionTracker } from "./tabSessionTracker";

// Flag to suppress open when togglePin triggers list.select
let suppressOpen = false;

export function activate(context: vscode.ExtensionContext) {
  const provider = new ConversationProvider();
  const tabTracker = new TabSessionTracker();

  // Register for both sidebar locations
  const treeView1 = vscode.window.createTreeView("claudeConversations", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const treeView2 = vscode.window.createTreeView(
    "claudeConversationsSecondary",
    {
      treeDataProvider: provider,
      showCollapseAll: true,
    },
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeConversations.refresh", () => {
      provider.refresh();
    }),
  );

  // New session
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.newSession",
      async () => {
        try {
          await vscode.commands.executeCommand("claude-vscode.editor.open");
        } catch {
          vscode.window.showInformationMessage(
            "Claude Code extension may not be installed.",
          );
        }
      },
    ),
  );

  // Open conversation in Claude Code
  // If the session is already open as a tab, focus that tab instead of creating new
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.open",
      async (meta: ConversationMeta) => {
        if (suppressOpen) return;
        try {
          // Check if this session already has an open tab
          const existing = tabTracker.findTabForSession(meta.sessionId, meta.title);
          if (existing) {
            await tabTracker.focusTab(existing);
            return;
          }

          // No existing tab — open new and register the mapping
          tabTracker.registerOpen(meta.sessionId, meta.title);
          await vscode.commands.executeCommand(
            "claude-vscode.editor.open",
            meta.sessionId,
            undefined,
          );
        } catch {
          vscode.window.showInformationMessage(
            `Session: ${meta.sessionId}\nClaude Code extension may not be installed.`,
          );
        }
      },
    ),
  );

  // Pin conversation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.pin",
      (item: ConversationItem) => {
        if (item?.meta) {
          pinSession(item.meta.sessionId);
          provider.refresh();
        }
      },
    ),
  );

  // Unpin conversation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.unpin",
      (item: ConversationItem) => {
        if (item?.meta) {
          unpinSession(item.meta.sessionId);
          provider.refresh();
        }
      },
    ),
  );

  // Copy session ID to clipboard
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.copySessionId",
      async (item: ConversationItem) => {
        if (item?.meta) {
          await vscode.env.clipboard.writeText(item.meta.sessionId);
          vscode.window.showInformationMessage(
            `Session ID copied: ${item.meta.sessionId}`,
          );
        }
      },
    ),
  );

  // Rename conversation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.rename",
      async (item: ConversationItem) => {
        if (!item?.meta) return;

        const newTitle = await vscode.window.showInputBox({
          prompt: "Enter new conversation title",
          value: item.meta.title,
        });

        if (!newTitle) return;

        try {
          const record = JSON.stringify({
            type: "custom-title",
            customTitle: newTitle,
            sessionId: item.meta.sessionId,
          });
          fs.appendFileSync(item.meta.filePath, record + "\n", "utf8");
          provider.refresh();
          vscode.window.showInformationMessage(
            `Renamed to "${newTitle}"`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to rename: ${err}`,
          );
        }
      },
    ),
  );

  // Delete conversation (move to .bak directory)
  // Based on claude-code-sessions by es6.kr (MIT License)
  // https://github.com/es6kr/claude-code-sessions
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claudeConversations.delete",
      async (item?: ConversationItem) => {
        // When invoked via keybinding, item is not passed — use tree selection
        if (!item) {
          const selected = treeView1.selection[0] ?? treeView2.selection[0];
          if (selected instanceof ConversationItem) {
            item = selected;
          }
        }
        if (!item?.meta) return;

        const confirm = await vscode.window.showWarningMessage(
          `Delete session "${item.meta.title}"?`,
          { modal: true },
          "Delete",
        );

        if (confirm !== "Delete") return;

        try {
          const backupDir = path.join(
            path.dirname(item.meta.filePath),
            ".bak",
          );
          fs.mkdirSync(backupDir, { recursive: true });
          const backupPath = path.join(
            backupDir,
            path.basename(item.meta.filePath),
          );
          fs.renameSync(item.meta.filePath, backupPath);

          unpinSession(item.meta.sessionId);
          provider.refresh();
          vscode.window.showInformationMessage("Session deleted");
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to delete: ${err}`);
        }
      },
    ),
  );

  // Toggle pin (p key) — select focused item first (suppressing open), then toggle
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeConversations.togglePin", async () => {
      suppressOpen = true;
      await vscode.commands.executeCommand("list.select");
      suppressOpen = false;
      const selected =
        treeView1.selection[0] ?? treeView2.selection[0];
      if (selected instanceof ConversationItem) {
        const sid = selected.meta.sessionId;
        if (isPinned(sid)) {
          unpinSession(sid);
        } else {
          pinSession(sid);
        }
        provider.refresh();
      }
    }),
  );

  // Search conversations
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeConversations.search", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search conversations...",
        placeHolder: "Filter by title or branch name",
      });
      if (query !== undefined) {
        provider.setFilter(query);
      }
    }),
  );

  // Focus command (Cmd+8)
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeConversations.focus", async () => {
      try {
        await vscode.commands.executeCommand("claudeConversationsSecondary.focus");
      } catch {
        try {
          await vscode.commands.executeCommand("claudeConversations.focus");
        } catch {
          // ignore
        }
      }
    }),
  );

  // Watch for .jsonl file changes — fast refresh (500ms debounce)
  const claudeDir = getClaudeProjectsDir();
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(claudeDir, "**/*.jsonl"),
  );

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const debouncedRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => provider.refresh(), 500);
  };

  watcher.onDidCreate(debouncedRefresh);
  watcher.onDidChange(debouncedRefresh);
  watcher.onDidDelete(debouncedRefresh);

  // Periodic refresh every 5s for real-time feel
  const interval = setInterval(() => provider.refresh(), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  context.subscriptions.push(treeView1, treeView2, watcher);
}

export function deactivate() {}
