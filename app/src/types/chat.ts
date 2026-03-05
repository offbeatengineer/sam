export type ToolStatus = "pending" | "running" | "success" | "warning" | "error";

export interface ToolExecution {
  id: string;
  name: string;
  status: ToolStatus;
  expanded: boolean;
  details?: string;
  input?: Record<string, unknown>;
  output?: string;
}

export interface ThinkingData {
  content: string;
  isComplete: boolean;
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
  details?: unknown;
  // artifacts
  event?: string;
  path?: string;
  // kits
  kitId?: string;
  // error
  error?: string;
  // session browsing fields
  sessions?: import("./session").SessionInfoDTO[];
  header?: object | null;
  entries?: object[];
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
