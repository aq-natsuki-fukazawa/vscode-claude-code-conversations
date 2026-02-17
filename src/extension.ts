import * as vscode from "vscode";
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
          const existing = tabTracker.findTabForSession(meta.sessionId);
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
