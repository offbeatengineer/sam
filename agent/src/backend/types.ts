import type {
  AgentSessionEvent,
  PromptOptions,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * Text the model sees for one turn that is NOT part of the user's message:
 * never persisted as the user message, never replayed to clients as something
 * the user typed, never indexed by session search.
 */
export interface HiddenContext {
  customType: string;
  text: string;
  details?: unknown;
}

/** Where a turn came from, and the user's words without channel framing. */
export interface TurnMemoryInfo {
  userText: string;
  origin: "app" | "discord" | "pulse";
}

export interface SamPromptOptions extends PromptOptions {
  /**
   * Resolves to context for this turn, or undefined for none. Must never
   * reject. A promise so a backend can overlap producing it with its own
   * startup work instead of adding the two serially.
   */
  hiddenContext?: Promise<HiddenContext | undefined>;
  /** Consumed by the automatic-memory decorator; backends ignore it. */
  memory?: TurnMemoryInfo;
}

/**
 * The minimal session surface the rest of sam consumes — dispatcher.ts,
 * channels/app-channel.ts, and session-registry.ts only ever touch these five
 * members. Both the pi-coding-agent backend (through a thin adapter) and the
 * Claude Agent SDK backend implement it, so the channels and clients don't
 * care which backend is active.
 *
 * Events emitted through `subscribe` use pi's `AgentSessionEvent` shape, so
 * app-channel's `ensureSubscription` translator needs zero changes.
 */
export interface SamAgentSession {
  /** Run one turn. Resolves only when the turn is fully complete. */
  prompt(text: string, options?: SamPromptOptions): Promise<void>;
  /** Subscribe to pi-shaped agent events. Returns an unsubscribe function. */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  /** Abort the in-flight turn (if any). */
  abort(): Promise<void> | void;
  /** Tear down the session and release resources. */
  dispose(): void;
  /**
   * `appendCustomEntry` persists client-side metadata (audio attachments,
   * memory activity); `getEntries` lets automatic memory read the transcript.
   */
  readonly sessionManager: Pick<SessionManager, "appendCustomEntry" | "getEntries">;
  /**
   * True while a turn is running on a backend that queues concurrent prompts
   * instead of rejecting them (pi). `await prompt()` then returns early, so
   * it is not a turn-end signal.
   */
  readonly isStreaming?: boolean;
}
