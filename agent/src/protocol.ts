// ---------------------------------------------------------------------------
// App ↔ Sam WebSocket protocol
// ---------------------------------------------------------------------------

/** Attachment reference included in a chat request (file already uploaded via POST /upload) */
export interface ChatAttachment {
  type: "image" | "audio";
  path: string;       // server-side file path from upload response
  mimeType: string;
}

/** Requests sent from the app to sam */
export type AppRequest =
  | { type: "chat"; requestId: string; conversationId: string; text: string; attachments?: ChatAttachment[] }
  | { type: "abort"; conversationId: string }
  | { type: "close_session"; conversationId: string }
  // Session browsing
  | { type: "list_sessions"; requestId: string }
  | { type: "get_session_entries"; requestId: string; sessionPath: string }
  | { type: "rename_session"; requestId: string; sessionPath: string; name: string }
  // Session archiving
  | { type: "archive_session"; requestId: string; sessionPath: string }
  | { type: "unarchive_session"; requestId: string; sessionPath: string }
  | { type: "list_archived_sessions"; requestId: string }
  // Memory management
  | { type: "memory_list"; requestId: string; limit?: number; offset?: number }
  | { type: "memory_search"; requestId: string; query: string; limit?: number; tags?: string[] }
  | { type: "memory_save"; requestId: string; text: string; tags?: string[]; source?: string }
  | { type: "memory_update"; requestId: string; id: string; text: string; tags?: string[] }
  | { type: "memory_delete"; requestId: string; id: string }
  // Skill management
  | { type: "list_skills"; requestId: string }
  | { type: "get_skill"; requestId: string; filename: string }
  | { type: "save_skill"; requestId: string; filename: string; content: string }
  | { type: "delete_skill"; requestId: string; filename: string }
  // Kit management
  | { type: "list_kits"; requestId: string }
  | { type: "enable_kit"; requestId: string; kitId: string }
  | { type: "disable_kit"; requestId: string; kitId: string }
  | { type: "reload_kit"; requestId: string; kitId: string }
  | { type: "delete_kit"; requestId: string; kitId: string }
  // Session search
  | { type: "session_search"; requestId: string; query: string; limit?: number };

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
  | { type: "tool_end"; conversationId: string; toolCallId: string; toolName: string; result: string; isError: boolean; details?: unknown }
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
  | { type: "memory_error"; requestId: string; error: string }
  // Session mutation
  | { type: "rename_session_result"; requestId: string; success: boolean }
  | { type: "archive_session_result"; requestId: string; success: boolean }
  | { type: "unarchive_session_result"; requestId: string; success: boolean }
  | { type: "archived_sessions_list"; requestId: string; sessions: SessionInfoDTO[] }
  // Skill management responses
  | { type: "skills_list_result"; requestId: string; skills: SkillInfoDTO[] }
  | { type: "skill_content_result"; requestId: string; filename: string; content: string }
  | { type: "skill_save_result"; requestId: string; success: boolean }
  | { type: "skill_delete_result"; requestId: string; success: boolean }
  | { type: "skill_error"; requestId: string; error: string }
  // Artifacts
  | { type: "artifacts_changed"; event: string; path: string }
  // Kit management responses
  | { type: "kits_list_result"; requestId: string; kits: KitInfoDTO[] }
  | { type: "kit_action_result"; requestId: string; success: boolean; error?: string }
  | { type: "kits_changed"; event: string; kitId: string }
  // Session search
  | { type: "session_search_result"; requestId: string; results: SessionSearchResultDTO[]; count: number };

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

/** Skill metadata returned by list_skills */
export interface SkillInfoDTO {
  filename: string;
  modified: string;
  size: number;
}

/** Kit metadata returned by list_kits */
export interface KitInfoDTO {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  enabled: boolean;
}

/** Session search result returned in protocol responses */
export interface SessionSearchResultDTO {
  text: string;
  role: string;
  score: number;
  session_name: string;
  conversation_id: string;
  channel_id: string;
  timestamp: number;
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
