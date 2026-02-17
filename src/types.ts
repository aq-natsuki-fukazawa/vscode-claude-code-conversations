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
  type: "user" | "assistant" | "file-history-snapshot" | "queue-operation";
  sessionId?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  gitBranch?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
  };
}

export interface ContentBlock {
  type: string;
  text?: string;
}
