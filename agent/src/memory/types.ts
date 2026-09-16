export type MemoryKind = "profile" | "situational";
export type MemoryStatus = "active" | "superseded" | "forgotten";

/**
 * Automatic memory driven by TypeSafe System One ("Jev") judgments. Opt-in:
 * when enabled, memory texts and recent conversation snippets are sent to
 * api.typesafe.ai on every turn.
 */
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
