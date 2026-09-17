import { createHash } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { HiddenContext, SamAgentSession, SamPromptOptions, TurnMemoryInfo } from "../backend/types.js";
import type { SamConfig } from "../config.js";
import { extractMessages } from "../session-search/extract.js";
import { sessionKeyToString, stripMessageHeader, type SessionKey } from "../types.js";
import { extractExchange } from "./exchange.js";
import { truncate, type Turn } from "./judgments.js";
import { formatMemoryContext, MemoryRecaller, type RecallOutcome } from "./recaller.js";
import { MemoryStore, type ActiveMemory } from "./store.js";
import { TypeSafeClient } from "./typesafe.js";
import type { MemoryConfig, TypeSafeConfig } from "./types.js";
import { MemoryWritePipeline, type WriteReport } from "./write-pipeline.js";
import { createFactWriter } from "./writer.js";

// ---------------------------------------------------------------------------
// Automatic memory: recall before every turn and save / supersede / forget
// after it, without the agent LLM deciding to. One decorator around the backend
// session, so app, Discord, and pulse turns all get it and neither backend
// knows memory exists.
// ---------------------------------------------------------------------------

export const MEMORY_CONTEXT_TYPE = "memory_context";
/** Custom session entry clients render as the turn's memory activity. */
export const MEMORY_ACTIVITY_ENTRY = "memory_activity";

const MAX_PRIOR_MESSAGE_CHARS = 600;
const MAX_NEW_MESSAGE_CHARS = 2000;

/** Emitted through `subscribe` next to pi's own events; channels forward it to clients. */
export interface MemoryRecalledEvent {
  type: "memory_recalled";
  memories: { id: string; text: string; kind: string; p: number }[];
  profileIncluded: boolean;
  ms: number;
  /** Set when situational recall could not run; the turn proceeded without it. */
  degraded?: string;
}

/**
 * What the post-turn write pipeline did with the user's new messages. Arrives
 * after `turn_end`, since writing never holds up a turn. In `superseded`,
 * `id`/`text` are the new memory and `replaced` is the one it made outdated;
 * `flagged` memories looked outdated, but not confidently enough to act on.
 */
export type MemoryWrittenEvent = { type: "memory_written" } & WriteReport;

export type MemoryEvent = MemoryRecalledEvent | MemoryWrittenEvent;

export class AutoMemory {
  private static instance: AutoMemory | undefined;

  /** Undefined unless memory and `memory.typesafe` are enabled with a key; callers then change nothing. */
  static get(config: SamConfig): AutoMemory | undefined {
    const memory = config.memory;
    // Same condition as memoryModeFor(): the prompt and the behavior must agree.
    if (!memory || memory.enabled === false || !memory.typesafe?.enabled || !memory.typesafe.apiKey) return undefined;
    AutoMemory.instance ??= new AutoMemory(config, memory, memory.typesafe);
    return AutoMemory.instance;
  }

  /** The instance if automatic memory was ever started; never creates one. */
  static current(): AutoMemory | undefined {
    return AutoMemory.instance;
  }

  readonly client: TypeSafeClient;
  readonly recaller: MemoryRecaller;
  /** Undefined when `memory.typesafe.write` is off; the model then keeps its write tools. */
  readonly pipeline: MemoryWritePipeline | undefined;

  private constructor(
    config: SamConfig,
    private readonly memoryConfig: MemoryConfig,
    readonly cfg: TypeSafeConfig,
  ) {
    this.client = new TypeSafeClient(cfg);
    this.recaller = new MemoryRecaller(this.client, cfg);
    this.pipeline = cfg.write
      ? new MemoryWritePipeline(this.client, cfg, () => this.store(), createFactWriter(config))
      : undefined;
  }

  /** Let queued memory writes finish; call before the process exits. */
  async drain(timeoutMs = 8000): Promise<void> {
    await this.pipeline?.drain(timeoutMs);
  }

  store(): Promise<MemoryStore> {
    return MemoryStore.getInstance(this.memoryConfig);
  }

  wrap(inner: SamAgentSession, key: SessionKey): SamAgentSession {
    return new AutoMemorySession(inner, key, this);
  }
}

class AutoMemorySession implements SamAgentSession {
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  private readonly label: string;
  private turns = 0;
  private profileSentAtTurn = -1;
  private profileSentHash = "";
  /** Session entries already handed to the write pipeline. Entries, not messages, so tool results are covered too. */
  private cursor: number;
  private readonly origin: { channelId: string; conversationId: string };
  private lastOrigin: TurnMemoryInfo["origin"] = "app";
  /** What memory did since the user's last message; shown to the model once. */
  private notices: string[] = [];
  /** Reference notes recalled into the current turn, so an answer built on them is not saved as a copy. */
  private recalledKnowledge: string[] = [];

  constructor(
    private readonly inner: SamAgentSession,
    key: SessionKey,
    private readonly auto: AutoMemory,
  ) {
    this.label = sessionKeyToString(key);
    this.origin = { channelId: key.channelId, conversationId: key.conversationId };
    // A resumed conversation's history was handled when it happened.
    this.cursor = (inner.sessionManager.getEntries() as any[]).length;
    // pi queues a prompt sent mid-turn and returns at once, so there
    // `await prompt()` is not the end of the turn; `agent_end` is.
    inner.subscribe((event: any) => {
      if (event?.type === "agent_end" && event.willRetry !== true) this.scheduleWrite();
    });
  }

  get sessionManager() {
    return this.inner.sessionManager;
  }

  get isStreaming(): boolean | undefined {
    return this.inner.isStreaming;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    const unsubscribeInner = this.inner.subscribe(listener);
    return () => {
      this.listeners.delete(listener);
      unsubscribeInner();
    };
  }

  abort(): Promise<void> | void {
    return this.inner.abort();
  }

  dispose(): void {
    this.listeners.clear();
    this.inner.dispose();
  }

  async prompt(text: string, options?: SamPromptOptions): Promise<void> {
    const info = options?.memory;
    // A caller that doesn't say whose words these are gets no memory treatment.
    if (!info) return this.inner.prompt(text, options);

    this.lastOrigin = info.origin;
    const queued = this.inner.isStreaming === true;
    const hiddenContext = this.buildHiddenContext(info);
    try {
      await this.inner.prompt(text, { ...options, hiddenContext });
    } finally {
      // Also after an aborted or failed turn: what the user said still stands.
      if (!queued) this.scheduleWrite();
    }
  }

  /**
   * Hand the user's new messages to the write pipeline. Cursor-based, so the
   * two triggers (prompt resolving, `agent_end`) never process a message twice
   * and a pi follow-up batch of several messages is covered in one job.
   */
  private scheduleWrite(): void {
    const pipeline = this.auto.pipeline;
    if (!pipeline) return;
    try {
      const entries = this.inner.sessionManager.getEntries() as any[];
      if (entries.length <= this.cursor) return;
      const firstNewEntry = this.cursor;
      this.cursor = entries.length;
      // Pulse prompts are not the user's words; skip them but keep the cursor moving.
      if (this.lastOrigin === "pulse") return;

      const firstNew = extractMessages(entries.slice(0, firstNewEntry)).length;
      const messages = extractMessages(entries);

      const start = Math.max(0, firstNew - this.auto.cfg.contextMessages);
      const targetMessages: string[] = [];
      const conversation = messages.slice(start).map((m, i): Turn => {
        const isNew = start + i >= firstNew;
        const raw = m.role === "user" ? stripMessageHeader(m.text) : m.text;
        const text = truncate(raw, isNew && m.role === "user" ? MAX_NEW_MESSAGE_CHARS : MAX_PRIOR_MESSAGE_CHARS);
        if (isNew && m.role === "user") targetMessages.push(text);
        return { role: m.role, text };
      });
      if (targetMessages.length === 0) return;

      const exchange = this.auto.cfg.knowledge
        ? extractExchange(entries, firstNewEntry, this.auto.cfg.knowledgeTools)
        : undefined;
      pipeline.enqueue(
        { label: this.label, conversation, targetMessages, exchange, origin: this.origin, knownNotes: this.recalledKnowledge },
        (report) => this.onWritten(report),
      );
    } catch (err) {
      console.warn(`[memory] could not schedule a memory write for ${this.label}:`, err);
    }
  }

  private onWritten(report: WriteReport): void {
    const parts = [
      report.saved.length && `${report.saved.length} saved`,
      report.superseded.length && `${report.superseded.length} superseded`,
      report.duplicates.length && `${report.duplicates.length} already known`,
      report.forgotten.length && `${report.forgotten.length} forgotten`,
      report.flagged.length && `${report.flagged.length} flagged`,
      report.unresolvedForget && "forget target not found",
    ].filter(Boolean);
    console.log(`[memory] write ${this.label}: ${parts.join(", ")}`);

    // So the model can answer "did you remember that?" truthfully next turn.
    this.notices.push(
      ...report.saved.map((m) => `${m.kind === "knowledge" ? "Saved reference note" : "Saved"}: ${m.text}`),
      ...report.superseded.map((m) => `Updated: "${m.replaced.text}" is now "${m.text}"`),
      ...report.forgotten.map((m) => `Forgot, as the user asked: ${m.text}`),
      ...(report.unresolvedForget ? ["The user asked to forget something, but no saved note matched it, so nothing was removed."] : []),
    );

    try {
      this.inner.sessionManager.appendCustomEntry(MEMORY_ACTIVITY_ENTRY, { phase: "write", ...report });
    } catch (err) {
      console.warn("[memory] could not record memory activity:", err);
    }
    this.emit({ type: "memory_written", ...report });
  }

  /** Never rejects: a memory failure must not cost the user their turn. */
  private async buildHiddenContext(info: TurnMemoryInfo): Promise<HiddenContext | undefined> {
    try {
      const turn = this.turns++;
      const store = await this.auto.store();
      const active = await store.listActive();
      const profile = active.filter((m) => m.kind === "profile");
      const situational = active.filter((m) => m.kind !== "profile");

      // Pulse prompts are a static file, not the user's words: judging them
      // would send the store off-machine on a timer for nothing.
      const judge = this.auto.cfg.recall && info.origin !== "pulse";
      const outcome: RecallOutcome = judge
        ? await this.auto.recaller.recall(this.conversation(info.userText), situational)
        : { status: "skipped", picked: [], ms: 0, tokens: 0, shards: 0 };

      this.recalledKnowledge = outcome.picked.filter((m) => m.kind === "knowledge").map((m) => m.text);
      const profileDue = this.profileDue(turn, profile);
      const notices = this.notices;
      this.notices = [];
      const text = formatMemoryContext({
        profile: profileDue ? profile : undefined,
        recalled: outcome.picked,
        notices,
        judgedNoneRelevant: outcome.status === "ok",
      });

      this.log(outcome, situational.length, profileDue ? profile.length : 0);
      if (judge || profileDue) {
        this.emit({
          type: "memory_recalled",
          memories: outcome.picked.map(({ id, text: t, kind, p }) => ({ id, text: t, kind, p })),
          profileIncluded: profileDue,
          ms: Math.round(outcome.ms),
          degraded: outcome.status === "degraded" ? outcome.reason : undefined,
        });
      }
      if (outcome.picked.length > 0) {
        this.inner.sessionManager.appendCustomEntry(MEMORY_ACTIVITY_ENTRY, {
          phase: "recall",
          memories: outcome.picked.map(({ id, text: t, kind, p }) => ({ id, text: t, kind, p })),
          ms: Math.round(outcome.ms),
        });
      }

      if (!text) return undefined;
      return { customType: MEMORY_CONTEXT_TYPE, text, details: { recalled: outcome.picked.map((m) => m.id) } };
    } catch (err) {
      console.warn(`[memory] recall failed for ${this.label}; continuing without it:`, err);
      return undefined;
    }
  }

  /**
   * Profile memories are not judged, so re-sending them every turn would only
   * pile copies into the transcript. Send them when the model cannot already
   * have them: a new session object, a changed profile, or after enough turns
   * that compaction may have dropped the last copy.
   */
  private profileDue(turn: number, profile: ActiveMemory[]): boolean {
    if (profile.length === 0) return false;
    const hash = createHash("sha1").update(profile.map((m) => `${m.id}:${m.text}`).join("\n")).digest("hex");
    const due =
      this.profileSentAtTurn < 0 ||
      hash !== this.profileSentHash ||
      turn - this.profileSentAtTurn >= this.auto.cfg.profileRefreshTurns;
    if (due) {
      this.profileSentAtTurn = turn;
      this.profileSentHash = hash;
    }
    return due;
  }

  /** Recent transcript plus the new message, which the backend has not persisted yet. */
  private conversation(userText: string): Turn[] {
    const prior = extractMessages(this.inner.sessionManager.getEntries() as any[])
      .slice(-this.auto.cfg.contextMessages)
      .map((m): Turn => ({
        role: m.role,
        text: truncate(m.role === "user" ? stripMessageHeader(m.text) : m.text, MAX_PRIOR_MESSAGE_CHARS),
      }));
    return [...prior, { role: "user", text: truncate(userText, MAX_NEW_MESSAGE_CHARS) }];
  }

  private log(outcome: RecallOutcome, judged: number, profileCount: number): void {
    const profile = profileCount > 0 ? ` + ${profileCount} profile` : "";
    if (outcome.status === "ok") {
      const tokens = outcome.tokens >= 1000 ? `${(outcome.tokens / 1000).toFixed(1)}K` : `${outcome.tokens}`;
      console.log(
        `[memory] recall ${judged} mem, ${outcome.shards} shard${outcome.shards === 1 ? "" : "s"}, ${tokens} tok, ` +
          `${Math.round(outcome.ms)}ms -> ${outcome.picked.length} picked${profile} (${outcome.model})`,
      );
    } else if (outcome.status === "degraded") {
      console.warn(`[memory] recall unavailable (${outcome.reason}) after ${Math.round(outcome.ms)}ms; turn continues${profile}`);
    }
  }

  private emit(event: MemoryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event as unknown as AgentSessionEvent);
      } catch (err) {
        console.error("[memory] listener error:", err);
      }
    }
  }
}
