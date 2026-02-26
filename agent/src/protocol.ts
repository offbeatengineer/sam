// ---------------------------------------------------------------------------
// App ↔ Sam WebSocket protocol
// ---------------------------------------------------------------------------

/** Requests sent from the app to sam */
export type AppRequest =
  | { type: "chat"; requestId: string; conversationId: string; text: string }
  | { type: "abort"; conversationId: string }
  | { type: "close_session"; conversationId: string };

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
  | { type: "error"; conversationId?: string; error: string };
