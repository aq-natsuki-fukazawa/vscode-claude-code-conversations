export interface ConversationMeta {
  sessionId: string;
  title: string;
  timestamp: Date;
  filePath: string;
  messageCount: number;
  model?: string;
  gitBranch?: string;
  projectPath: string;
  projectDir: string;
  isPinned: boolean;
  isWaiting: boolean; // last message is from user → waiting for response
  isToolUseWaiting: boolean; // last assistant message has tool_use without tool_result → waiting for permission
}

export interface JnsonlMessage {
  type: "user" | "assistant" | "file-history-snapshot" | "queue-operation" | "custom-title";
  sessionId?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  gitBranch?: string;
  customTitle?: string; // present when type === "custom-title"
  toolUseResult?: unknown; // present on user messages that are tool_result responses
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    stop_reason?: string | null; // null = streaming/intermediate, "end_turn" = done, "tool_use" = tool call
  };
}

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string; // tool name for tool_use blocks
}
