/**
 * profile: always applies. situational: what the user said, judged per turn.
 * knowledge: what the user looked up or had explained; it comes from assistant
 * replies and tool output, so it is never promoted to profile and never
 * replaces what the user said about themselves.
 */
export type MemoryKind = "profile" | "situational" | "knowledge";
export type MemoryStatus = "active" | "superseded" | "forgotten";

/**
 * Cap on a reference note, in characters (~500 English words). Not a technical
 * limit: it trades note detail against what each recalled note costs per turn
 * and how many notes fit one Jev request.
 */
export const DEFAULT_KNOWLEDGE_NOTE_CHARS = 4000;

/**
 * Automatic memory driven by TypeSafe System One ("Jev") judgments. Opt-in:
 * when enabled, memory texts and recent conversation snippets are sent to
 * api.typesafe.ai on every turn.
 */
/** Where a knowledge memory came from, so the model and the UI can cite or reopen it. */
export interface MemoryOrigin {
  url?: string;
  tool?: string;
  channelId?: string;
  conversationId?: string;
  /** When the source exchange happened; `session_read` can center on it. */
  timestamp?: number;
}

export interface TypeSafeConfig {
  enabled: boolean;
  apiKey?: string;
  /** Pinned model id. Thresholds are calibrated against a specific version. */
  model: string;
  baseUrl: string;
  /** Hard ceiling for the pre-turn recall request; the turn never waits longer. */
  timeoutMs: number;
  /** Per-request ceiling for the post-turn write pipeline. */
  writeTimeoutMs: number;
  recall: boolean;
  write: boolean;
  recallThreshold: number;
  maxRecalled: number;
  /** How many prior messages accompany the new one in the recall state. */
  contextMessages: number;
  /** Estimated-token budget per request; the store is sharded above this. */
  shardTokenBudget: number;
  maxShards: number;
  saveScoreThreshold: number;
  supersedeConfidence: number;
  /** Re-send the profile block every N turns to survive compaction. */
  profileRefreshTurns: number;
  /** Also keep reference notes of what the assistant explained or looked up. Needs `write`. */
  knowledge: boolean;
  knowledgeScoreThreshold: number;
  /** Tools whose results the knowledge writer may read; "all" excludes only memory and session tools. */
  knowledgeTools: "all" | string[];
  /** Estimated-token budget for the tool results handed to the knowledge writer. */
  knowledgeMaterialTokens: number;
  /** Hard cap on one reference note; the writer's word guidance and the merge threshold derive from it. */
  knowledgeNoteChars: number;
}

/** Model used by the pi-ai fact writer (the agent-sdk backend uses Haiku). */
export interface MemoryWriterConfig {
  provider: string;
  id: string;
}

export interface MemoryConfig {
  enabled?: boolean;
  storagePath: string;
  modelsPath: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  typesafe?: TypeSafeConfig;
  writer?: MemoryWriterConfig;
}
