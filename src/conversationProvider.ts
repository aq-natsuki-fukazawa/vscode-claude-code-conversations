import * as vscode from "vscode";
import { ConversationMeta } from "./types";
import {
  loadConversationsForProject,
  getProjectDisplayName,
} from "./conversationParser";
import { getPinnedSessionIds } from "./pinManager";

type TreeItem = GroupItem | ConversationItem;

export class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly conversations: ConversationMeta[],
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

export class ConversationItem extends vscode.TreeItem {
  constructor(public readonly meta: ConversationMeta) {
    super(meta.title, vscode.TreeItemCollapsibleState.None);

    this.description = this.formatDescription();
    this.tooltip = this.formatTooltip();
    this.contextValue = meta.isPinned ? "pinnedConversation" : "conversation";

    // Icon: toolUseWaiting (shield) > waiting (loading~) > pinned > normal
    let icon: string;
    let iconColor: vscode.ThemeColor | undefined;
    if (meta.isToolUseWaiting) {
      icon = "shield";
      iconColor = new vscode.ThemeColor("charts.orange");
    } else if (meta.isWaiting) {
      icon = "loading~spin";
      iconColor = new vscode.ThemeColor("charts.yellow");
    } else if (meta.isPinned) {
      icon = "pinned";
    } else {
      icon = "comment-discussion";
    }
    this.iconPath = new vscode.ThemeIcon(icon, iconColor);
    this.command = {
      command: "claudeConversations.open",
      title: "Open Conversation",
      arguments: [meta],
    };
  }

  private formatDescription(): string {
    const parts: string[] = [];
    if (this.meta.gitBranch) {
      parts.push(this.meta.gitBranch);
    }
    parts.push(`${this.meta.messageCount} messages`);
    return parts.join(" · ");
  }

  private formatTooltip(): string {
    const lines = [this.meta.title];
    if (this.meta.gitBranch) {
      lines.push(`Branch: ${this.meta.gitBranch}`);
    }
    if (this.meta.model) {
      lines.push(`Model: ${this.meta.model}`);
    }
    lines.push(`Messages: ${this.meta.messageCount}`);
    lines.push(`Time: ${this.meta.timestamp.toLocaleString()}`);
    lines.push(`Session: ${this.meta.sessionId}`);
    return lines.join("\n");
  }
}

export class ConversationProvider
  implements vscode.TreeDataProvider<TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private conversations: ConversationMeta[] = [];
  private filterText: string = "";
  private currentWorkspacePath: string | undefined;


  constructor() {
    this.currentWorkspacePath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  refresh(): void {
    this.conversations = [];
    this._onDidChangeTreeData.fire();
  }

  setFilter(text: string): void {
    this.filterText = text.toLowerCase();
    this._onDidChangeTreeData.fire();
  }


  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }
    if (element instanceof GroupItem) {
      return element.conversations.map((c) => new ConversationItem(c));
    }
    return [];
  }

  private async getRootItems(): Promise<TreeItem[]> {
    if (this.conversations.length === 0) {
      this.conversations = await this.loadConversations();
    }

    let filtered = this.conversations;
    if (this.filterText) {
      filtered = filtered.filter(
        (c) =>
          c.title.toLowerCase().includes(this.filterText) ||
          (c.gitBranch?.toLowerCase().includes(this.filterText) ?? false)
      );
    }

    const pinned = filtered.filter((c) => c.isPinned);
    const unpinned = filtered.filter((c) => !c.isPinned);

    const items: TreeItem[] = [];

    // Pinned group
    if (pinned.length > 0) {
      items.push(
        new GroupItem(
          `Pinned (${pinned.length})`,
          pinned,
          vscode.TreeItemCollapsibleState.Expanded
        )
      );
    }

    // Flat list for current workspace (no project grouping)
    for (const c of unpinned) {
      items.push(new ConversationItem(c));
    }

    return items;
  }

  private async loadConversations(): Promise<ConversationMeta[]> {
    if (!this.currentWorkspacePath) {
      return [];
    }

    // Claude encodes project paths by replacing / and . with -
    const projectDir = this.currentWorkspacePath.replace(/[/.]/g, "-");
    const conversations = await loadConversationsForProject(projectDir);
    const pinnedIds = getPinnedSessionIds();

    for (const c of conversations) {
      c.isPinned = pinnedIds.has(c.sessionId);
    }

    return conversations;
  }
}

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
