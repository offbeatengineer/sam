import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SamAgentSession, SamPromptOptions } from "../types.js";

/**
 * pi's `AgentSession` already has sam's session shape; this adapter only adds
 * per-turn hidden context, which `prompt()` options cannot carry.
 *
 * The context goes in as a "nextTurn" custom message: pi sends it to the model
 * alongside the user message and persists it as a `custom_message` entry with
 * `display: false`, which clients hide and session search skips.
 */
export class PiSessionAdapter implements SamAgentSession {
  constructor(private readonly inner: AgentSession) {}

  get sessionManager() {
    return this.inner.sessionManager;
  }

  get isStreaming(): boolean {
    return this.inner.isStreaming;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.inner.subscribe(listener);
  }

  abort(): Promise<void> {
    return this.inner.abort();
  }

  dispose(): void {
    this.inner.dispose();
  }

  async prompt(text: string, options?: SamPromptOptions): Promise<void> {
    const { hiddenContext, memory: _memory, ...piOptions } = options ?? {};

    // While a turn is streaming, pi queues this prompt as a follow-up and never
    // drains "nextTurn" messages for it, so context queued now would attach to
    // some later, unrelated turn. Skip it instead.
    if (hiddenContext && !this.inner.isStreaming) {
      const context = await hiddenContext.catch(() => undefined);
      if (context && !this.inner.isStreaming) {
        await this.inner.sendCustomMessage(
          { customType: context.customType, content: context.text, display: false, details: context.details },
          { deliverAs: "nextTurn" },
        );
      }
    }

    return this.inner.prompt(text, piOptions);
  }
}
