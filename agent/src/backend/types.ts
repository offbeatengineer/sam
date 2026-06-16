import type {
  AgentSessionEvent,
  PromptOptions,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * The minimal session surface the rest of sam consumes — dispatcher.ts,
 * channels/app-channel.ts, and session-registry.ts only ever touch these five
 * members. Both the pi-coding-agent backend (its `AgentSession` satisfies this
 * structurally) and the Claude Agent SDK backend implement it, so the channels
 * and clients don't care which backend is active.
 *
 * Events emitted through `subscribe` use pi's `AgentSessionEvent` shape, so
 * app-channel's `ensureSubscription` translator needs zero changes.
 */
export interface SamAgentSession {
  /** Run one turn. Resolves only when the turn is fully complete. */
  prompt(text: string, options?: PromptOptions): Promise<void>;
  /** Subscribe to pi-shaped agent events. Returns an unsubscribe function. */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  /** Abort the in-flight turn (if any). */
  abort(): Promise<void> | void;
  /** Tear down the session and release resources. */
  dispose(): void;
  /** Used by app-channel to persist audio-attachment metadata. */
  readonly sessionManager: Pick<SessionManager, "appendCustomEntry">;
}
