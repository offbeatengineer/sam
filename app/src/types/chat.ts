export type MessageRole = "user" | "assistant" | "system";
export type ToolStatus = "pending" | "running" | "success" | "warning" | "error";

export interface ToolExecution {
  id: string;
  name: string;
  status: ToolStatus;
  expanded: boolean;
  details?: string;
  input?: Record<string, unknown>;  // Tool parameters
  output?: string;                   // Tool result
}

export interface ThinkingData {
  content: string;
  isComplete: boolean;
}

// Content block types for interleaved thinking/text
export interface TextBlock {
  type: "text";
  content: string;
}

export interface ThinkingBlock {
  type: "thinking";
  content: string;
  isComplete: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock;

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolExecutions?: ToolExecution[];
  thinking?: ThinkingData;
  // Content blocks for interleaved thinking/text
  contentBlocks?: ContentBlock[];
}

// ---------------------------------------------------------------------------
// App ↔ Sam protocol types (matches agent/src/protocol.ts)
// ---------------------------------------------------------------------------

export interface AppResponse {
  type: string;
  conversationId?: string;
  requestId?: string;
  // text_delta / thinking_delta
  delta?: string;
  contentIndex?: number;
  // tool fields
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  partialResult?: string;
  result?: string;
  isError?: boolean;
  // error
  error?: string;
  // memory fields
  memories?: MemoryItem[];
  total?: number;
  count?: number;
  success?: boolean;
  id?: string;
  text?: string;
  tags?: string[];
}

export interface MemoryItem {
  id: string;
  text: string;
  tags: string[];
  source: string;
  created_at: number;
  score: number;
}
