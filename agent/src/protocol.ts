// ---------------------------------------------------------------------------
// App ↔ Sam WebSocket protocol
// ---------------------------------------------------------------------------

/** Requests sent from the app to sam */
export type AppRequest =
  | { type: "chat"; requestId: string; conversationId: string; text: string }
  | { type: "abort"; conversationId: string }
  | { type: "close_session"; conversationId: string }
  // Session browsing
  | { type: "list_sessions"; requestId: string }
  | { type: "get_session_entries"; requestId: string; sessionPath: string }
  // Memory management
  | { type: "memory_list"; requestId: string; limit?: number; offset?: number }
  | { type: "memory_search"; requestId: string; query: string; limit?: number; tags?: string[] }
  | { type: "memory_save"; requestId: string; text: string; tags?: string[]; source?: string }
  | { type: "memory_update"; requestId: string; id: string; text: string; tags?: string[] }
  | { type: "memory_delete"; requestId: string; id: string };

/** Responses sent from sam to the app */
export type AppResponse =
  // Turn lifecycle
  | { type: "turn_start"; conversationId: string; requestId: string }
  | { type: "turn_end"; conversationId: string; requestId: string }
  // Streaming text
  | { type: "text_delta"; conversationId: string; delta: string; contentIndex: number }
  // Thinking
  | { type: "thinking_delta"; conversationId: string; delta: string; contentIndex: number }
  | { type: "thinking_end"; conversationId: string; contentIndex: number }
  // Tool execution
  | { type: "tool_start"; conversationId: string; toolCallId: string; toolName: string; args: any }
  | { type: "tool_update"; conversationId: string; toolCallId: string; toolName: string; partialResult: string }
  | { type: "tool_end"; conversationId: string; toolCallId: string; toolName: string; result: string; isError: boolean }
  // Session lifecycle
  | { type: "session_created"; conversationId: string }
  | { type: "session_closed"; conversationId: string }
  | { type: "aborted"; conversationId: string }
  | { type: "error"; conversationId?: string; error: string }
  // Session browsing responses
  | { type: "sessions_list"; requestId: string; sessions: SessionInfoDTO[] }
  | { type: "session_entries"; requestId: string; header: object | null; entries: object[] }
  // Memory management responses
  | { type: "memory_list_result"; requestId: string; memories: MemoryResult[]; total: number }
  | { type: "memory_search_result"; requestId: string; memories: MemoryResult[]; count: number }
  | { type: "memory_save_result"; requestId: string; id: string; text: string; tags: string[] }
  | { type: "memory_update_result"; requestId: string; success: boolean }
  | { type: "memory_delete_result"; requestId: string; success: boolean }
  | { type: "memory_error"; requestId: string; error: string };

/** Session metadata returned by list_sessions */
export interface SessionInfoDTO {
  path: string;
  id: string;
  channelId: string;
  conversationId: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

/** Memory item returned in protocol responses */
export interface MemoryResult {
  id: string;
  text: string;
  tags: string[];
  source: string;
  created_at: number;
  score: number;
}
