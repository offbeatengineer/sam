import { fitSources, type Exchange } from "./exchange.js";
import {
  aliasShard,
  decideForget,
  decideGate,
  decideKnowledgeGate,
  decideRelations,
  estimateTokens,
  forgetShortlist,
  forgetStage1Questions,
  forgetStage2Questions,
  gateQuestions,
  knowledgeGateQuestions,
  knowledgeGateState,
  memoryTextLimit,
  relationStage1Questions,
  relationStage2Questions,
  shardMemories,
  shortlistFromStage1,
  truncate,
  type RelationDecision,
  type Turn,
} from "./judgments.js";
import type { ActiveMemory, MemoryStore } from "./store.js";
import type { JevQuestion, JevResult, TypeSafeClient } from "./typesafe.js";
import type { MemoryOrigin, TypeSafeConfig } from "./types.js";
import { MAX_TAGS, type CandidateFact, type KnownNote, type MemoryFactWriter, type MergeResult } from "./writer.js";

// ---------------------------------------------------------------------------
// After a turn: decide whether the user said anything worth keeping, have an
// LLM write it down, and reconcile it with what is already stored. Nothing is
// written without a Jev judgment, and nothing is destroyed: outdated memories
// are superseded and "forget" is a status, both reversible from the UI.
//
// Two separate tracks share this pipeline. Facts about the user come only from
// the user's own messages. Knowledge (what the assistant explained or looked
// up) comes from assistant and tool output, which nobody vetted, so it is kept
// as its own kind: reconciled only against other knowledge, never a profile
// memory, never able to replace something the user said.
//
// A reference note covers one subject, so a later exchange on that subject
// updates the note rather than adding a second one. The writer marks what it
// wrote as a revision of a note it was shown (the ones recalled into the turn),
// and the relation judgment finds a note it was not shown; either way the merge
// writer folds the new text into the old note, which the merged note replaces.
// ---------------------------------------------------------------------------

export interface MemoryChange {
  id: string;
  text: string;
}

export interface WriteReport {
  saved: (MemoryChange & { kind: string; origin?: MemoryOrigin })[];
  /** `id`/`text` are the new memory; a revised or merged note lands here too, with the note it replaced. */
  superseded: (MemoryChange & { replaced: MemoryChange })[];
  duplicates: MemoryChange[];
  forgotten: MemoryChange[];
  flagged: MemoryChange[];
  unresolvedForget?: boolean;
}

export interface WriteJob {
  label: string;
  /** Recent transcript ending with the target messages; user texts already stripped of channel framing. */
  conversation: Turn[];
  /** New user messages since the last job for this conversation. */
  targetMessages: string[];
  /** The whole turn, tool results included; absent when knowledge memory is off. */
  exchange?: Exchange;
  /** Where the turn happened, recorded on knowledge memories so they can be traced back. */
  origin?: Pick<MemoryOrigin, "channelId" | "conversationId">;
  /** Knowledge memories recalled into this turn; the writer revises them and must not save them again. */
  knownNotes?: KnownNote[];
}

const MAX_GATE_MESSAGE_CHARS = 4000;
const MAX_PROFILE_MEMORIES = 20;
const STAGE_OVERHEAD_TOKENS = 400;
/** A reply this short with no tool use has nothing in it to learn from; skip the request. */
const MIN_KNOWLEDGE_REPLY_CHARS = 80;
/** A note this close to the cap is not merged into: every merge compacts, and this stops the drift. */
const MERGE_EXISTING_RATIO = 0.8;
/** Notices re-enter the next turn's context; a paragraph note is shown by its opening only. */
export const MAX_NOTICE_TEXT_CHARS = 160;

/** Last line of defense behind the writer's own rule against recording secrets. */
const SECRET_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|\b(password|passwd|passphrase|api[ _-]?key|secret|token)\b\s*(is|=|:)\s*\S+/i;
/** Reference notes legitimately say "a token is ...", so there only an assignment counts. */
const KNOWLEDGE_SECRET_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|\b(password|passwd|passphrase|api[ _-]?key|secret|token)\b\s*[=:]\s*\S+/i;

const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

export function isEmptyReport(r: WriteReport): boolean {
  return (
    r.saved.length + r.superseded.length + r.duplicates.length + r.forgotten.length + r.flagged.length === 0 &&
    !r.unresolvedForget
  );
}

const brief = (text: string) => truncate(text.replace(/\s+/g, " ").trim(), MAX_NOTICE_TEXT_CHARS);

/** One line per change, for the model's next turn: so it can answer "did you remember that?" truthfully. */
export function noticesFor(report: WriteReport): string[] {
  return [
    ...report.saved.map((m) => `${m.kind === "knowledge" ? "Saved reference note" : "Saved"}: ${brief(m.text)}`),
    ...report.superseded.map((m) => `Updated: "${brief(m.replaced.text)}" is now "${brief(m.text)}"`),
    ...report.forgotten.map((m) => `Forgot, as the user asked: ${brief(m.text)}`),
    ...(report.unresolvedForget ? ["The user asked to forget something, but no saved note matched it, so nothing was removed."] : []),
  ];
}

/** What the knowledge track needs beyond the fact itself. */
interface KnowledgeContext {
  origin: MemoryOrigin;
  /** Notes the writer was shown this turn. It had its chance to revise them, so they are not merge candidates. */
  knownIds: Set<string>;
  today: string;
}

export class MemoryWritePipeline {
  /**
   * One chain for the whole process, not one per conversation: it keeps each
   * conversation's jobs in order and also stops two conversations from
   * inserting the same fact at the same moment. Writes are rare (the gate
   * rejects most turns), so the serialization costs nothing in practice.
   */
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  /** How much of each memory a Jev request carries; sized so a reference note is never cut. */
  private readonly textLimit: number;

  constructor(
    private readonly client: TypeSafeClient,
    private readonly cfg: TypeSafeConfig,
    private readonly store: () => Promise<MemoryStore>,
    private readonly writer: MemoryFactWriter,
  ) {
    this.textLimit = memoryTextLimit(cfg.knowledgeNoteChars);
  }

  enqueue(job: WriteJob, onDone: (report: WriteReport) => void): void {
    this.pending++;
    this.tail = this.tail
      .then(() => this.run(job))
      .then((report) => {
        if (report && !isEmptyReport(report)) onDone(report);
      })
      .catch((err) => console.warn(`[memory] write pipeline failed for ${job.label}:`, err))
      .finally(() => {
        this.pending--;
      });
  }

  /** Called before the process exits: a save-worthy last message must not be lost to Ctrl-C. */
  async drain(timeoutMs: number): Promise<void> {
    if (this.pending === 0) return;
    console.log(`[memory] finishing ${this.pending} pending memory write${this.pending === 1 ? "" : "s"}...`);
    await Promise.race([this.tail, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
    if (this.pending > 0) console.warn(`[memory] gave up on ${this.pending} pending memory write(s) after ${timeoutMs}ms`);
  }

  private async run(job: WriteJob): Promise<WriteReport | undefined> {
    // Never write ungated: without Jev there is no judgment, so there is no write.
    if (!this.client.available) return undefined;

    const report: WriteReport = { saved: [], superseded: [], duplicates: [], forgotten: [], flagged: [] };

    const gates = await Promise.all(job.targetMessages.map((message) => this.gate(job, message)));
    const toSave = job.targetMessages.filter((_, i) => gates[i]?.save);
    const toForget = job.targetMessages.filter((_, i) => gates[i]?.forget);

    for (const message of toForget) await this.forget(job, message, report);

    if (toSave.length > 0) {
      const facts = await this.writer.write({
        conversation: job.conversation,
        targetMessages: toSave,
        today: new Date().toISOString().slice(0, 10),
      });
      console.log(`[memory] writer (${this.writer.name}) -> ${facts.length} fact${facts.length === 1 ? "" : "s"}`);
      // Sequential so that fact 2 is reconciled against a store that already holds fact 1.
      for (const fact of facts) await this.reconcile(fact, report);
    }

    await this.knowledge(job, report);

    return report;
  }

  /** Keep what the user learned this turn. Never throws: the user-fact report above must still be delivered. */
  private async knowledge(job: WriteJob, report: WriteReport): Promise<void> {
    const exchange = job.exchange;
    if (!this.cfg.knowledge || !exchange || exchange.userMessages.length === 0) return;
    const reply = exchange.assistantReply;
    if (!reply || (reply.length < MIN_KNOWLEDGE_REPLY_CHARS && exchange.toolCalls.length === 0)) return;

    try {
      const result = await this.ask(
        knowledgeGateState(exchange.userMessages, reply, exchange.toolCalls),
        knowledgeGateQuestions(),
      );
      const decision = decideKnowledgeGate(result.answers, this.cfg.knowledgeScoreThreshold);
      console.log(
        `[memory] knowledge gate ${decision.value.toFixed(2)} ${decision.save ? "save" : "skip"} ` +
          `(${exchange.toolCalls.length} tool call${exchange.toolCalls.length === 1 ? "" : "s"}) ` +
          `"${truncate(exchange.userMessages[0].replace(/\s+/g, " "), 60)}"`,
      );
      if (!decision.save) return;

      const today = new Date().toISOString().slice(0, 10);
      const sources = fitSources(exchange.sources, this.cfg.knowledgeMaterialTokens);
      const facts = await this.writer.writeKnowledge({
        userMessages: exchange.userMessages,
        assistantReply: reply,
        sources,
        knownNotes: job.knownNotes,
        maxChars: this.cfg.knowledgeNoteChars,
        today,
      });
      console.log(
        `[memory] knowledge writer (${this.writer.name}) read ${sources.length} source${sources.length === 1 ? "" : "s"} ` +
          `-> ${facts.length} note${facts.length === 1 ? "" : "s"}` +
          (facts.length ? ` (${facts.map((f) => `${f.text.length} chars${f.revises ? ", revision" : ""}`).join("; ")})` : ""),
      );
      const knownIds = new Set((job.knownNotes ?? []).map((n) => n.id));
      for (const fact of facts) {
        if (!looksEnglish(fact.text)) console.warn(`[memory] knowledge note is not in English: "${truncate(fact.text, 60)}"`);
        const origin: MemoryOrigin = { ...job.origin, timestamp: exchange.timestamp || Date.now(), ...dropUndefined(fact.origin) };
        // The kind is ours to set, whatever the writer returned.
        await this.reconcile({ ...fact, kind: "knowledge" }, report, { origin, knownIds, today });
      }
    } catch (err) {
      console.warn(`[memory] knowledge from ${job.label} not saved:`, errText(err));
    }
  }

  private async gate(job: WriteJob, message: string) {
    try {
      const result = await this.ask(
        { latest_user_message: truncate(message, MAX_GATE_MESSAGE_CHARS), conversation: job.conversation },
        gateQuestions(),
      );
      const decision = decideGate(result.answers, this.cfg.saveScoreThreshold);
      console.log(
        `[memory] gate ${decision.value.toFixed(2)} ${decision.save ? "save" : "skip"}` +
          `${decision.forget ? " +forget" : ""} (hyp ${decision.hypothetical.toFixed(2)}, transient ${decision.transient.toFixed(2)}) ` +
          `"${truncate(message.replace(/\s+/g, " "), 60)}"`,
      );
      return decision;
    } catch (err) {
      console.warn(`[memory] gate unavailable, skipping message:`, errText(err));
      return undefined;
    }
  }

  /**
   * Insert, skip as duplicate, fold into an existing note, or insert and supersede, depending on how
   * the fact relates to the store. A fact is only compared with its own track (knowledge with knowledge, the
   * user's facts with the user's facts), so text from a web page can never retire something the user said.
   */
  private async reconcile(fact: CandidateFact, report: WriteReport, ctx?: KnowledgeContext): Promise<void> {
    const isKnowledge = fact.kind === "knowledge";
    if ((isKnowledge ? KNOWLEDGE_SECRET_PATTERN : SECRET_PATTERN).test(fact.text)) {
      console.warn("[memory] dropped a candidate fact that looks like a secret");
      return;
    }

    const store = await this.store();
    const all = await store.listActive();
    const active = all.filter((m) => (m.kind === "knowledge") === isKnowledge);
    const byId = new Map(active.map((m) => [m.id, m]));
    const track = isKnowledge ? "knowledge" : "user";
    const change = (id: string): MemoryChange => ({ id, text: byId.get(id)?.text ?? "" });

    // What the writer wrote as an update to a note it was shown. That note is left
    // out of the comparison: it is being replaced regardless, and judged against
    // its own update it would read as a duplicate or as outdated.
    const revised = isKnowledge && ctx && fact.revises ? byId.get(fact.revises) : undefined;
    if (fact.revises && !revised) console.log(`[memory] revised note ${fact.revises.slice(0, 8)} is no longer active; treating the update as a new note`);

    let decision: RelationDecision;
    let shortlist: ActiveMemory[];
    try {
      ({ decision, shortlist } = await this.relate(fact.text, revised ? active.filter((m) => m.id !== revised.id) : active, track));
    } catch (err) {
      // Without the relation judgment a save could duplicate or contradict the store.
      console.warn(`[memory] could not reconcile "${truncate(fact.text, 60)}", not saving:`, errText(err));
      return;
    }
    if (this.rejected(decision, fact.text)) return;

    if (revised && ctx) {
      const merged = await this.merge(revised, fact, ctx);
      if (merged) {
        const newId = await this.replace(store, revised, merged, fact.tags, ctx, report, "revised");
        await this.supersedeAll(store, decision.supersede, newId, merged, [revised.id], report, change);
        for (const id of decision.flagged) report.flagged.push(change(id));
        return;
      }
      // The merge writer would not fold it in: the new facts are kept on their own rather than lost.
    }

    // Restating something known refreshes it. If the restatement also outdates
    // another memory, the existing duplicate is what replaces it.
    const duplicateId = decision.duplicates[0];
    if (duplicateId) {
      await store.touch(duplicateId);
      report.duplicates.push(change(duplicateId));
      await this.supersedeAll(store, decision.supersede, duplicateId, fact.text, [], report, change);
      for (const id of decision.flagged) report.flagged.push(change(id));
      return;
    }

    // A note on a subject the store already covers, by a note the writer was not
    // shown: one note per subject, so the two are merged when the writer agrees.
    if (isKnowledge && ctx && !revised) {
      const sameSubject = new Set([...decision.supersede, ...decision.consistent]);
      const limit = this.cfg.knowledgeNoteChars * MERGE_EXISTING_RATIO;
      const candidate = shortlist.find((m) => sameSubject.has(m.id) && !ctx.knownIds.has(m.id) && m.text.length <= limit);
      if (candidate) {
        const merged = await this.merge(candidate, fact, ctx);
        if (merged) {
          const newId = await this.replace(store, candidate, merged, fact.tags, ctx, report, "merged");
          await this.supersedeAll(store, decision.supersede, newId, merged, [candidate.id], report, change);
          for (const id of decision.flagged) report.flagged.push(change(id));
          return;
        }
      }
    }

    const profileCount = active.filter((m) => m.kind === "profile").length;
    const kind = isKnowledge
      ? "knowledge"
      : fact.kind === "profile" && decision.profileScope && profileCount < MAX_PROFILE_MEMORIES
        ? "profile"
        : "situational";
    const currentId = await store.save(fact.text, fact.tags, "auto", { kind, origin: isKnowledge ? ctx?.origin : undefined });
    if (decision.supersede.length === 0) report.saved.push({ id: currentId, text: fact.text, kind, origin: isKnowledge ? ctx?.origin : undefined });
    await this.supersedeAll(store, decision.supersede, currentId, fact.text, [], report, change);
    for (const id of decision.flagged) report.flagged.push(change(id));
  }

  /** Stage 1 across the whole track, stage 2 on the shortlist (best candidates first). */
  private async relate(
    text: string,
    candidates: ActiveMemory[],
    track: "user" | "knowledge",
  ): Promise<{ decision: RelationDecision; shortlist: ActiveMemory[] }> {
    const byId = new Map(candidates.map((m) => [m.id, m]));
    const state = { new_statement: text };
    const stage1 = await this.acrossShards(candidates, state, relationStage1Questions);
    const shortlist = shortlistFromStage1(stage1).map((id) => byId.get(id)!).filter(Boolean);
    const { memories, toId } = aliasShard(shortlist, this.textLimit);
    const stage2 = await this.ask({ ...state, memories }, relationStage2Questions([...toId.keys()], track));
    return { decision: decideRelations(stage2.answers, toId, this.cfg.supersedeConfidence), shortlist };
  }

  private rejected(decision: RelationDecision, text: string): boolean {
    if (decision.isInstruction) {
      console.warn(`[memory] rejected an instruction-shaped fact: "${truncate(text, 80)}"`);
      return true;
    }
    if (decision.aboutUser) {
      console.warn(`[memory] rejected a reference note that makes claims about the user: "${truncate(text, 80)}"`);
      return true;
    }
    return false;
  }

  /** The knowledge guards alone, for text the writer composed from notes that already passed them. */
  private async guardKnowledge(text: string): Promise<boolean> {
    try {
      const result = await this.ask({ new_statement: text, memories: {} }, relationStage2Questions([], "knowledge"));
      const decision = decideRelations(result.answers, new Map(), this.cfg.supersedeConfidence);
      return !decision.isInstruction && !decision.aboutUser;
    } catch (err) {
      console.warn("[memory] could not guard a merged note:", errText(err));
      return false;
    }
  }

  /** The merged replacement for `existing` and `fact`, or undefined when the two stay separate. */
  private async merge(existing: ActiveMemory, fact: CandidateFact, ctx: KnowledgeContext): Promise<string | undefined> {
    let result: MergeResult;
    try {
      result = await this.writer.mergeKnowledge({ existing: existing.text, addition: fact.text, maxChars: this.cfg.knowledgeNoteChars, today: ctx.today });
    } catch (err) {
      console.warn(`[memory] merge writer failed; saving the note on its own:`, errText(err));
      return undefined;
    }
    if (!result.merged) {
      console.log(`[memory] writer kept the note separate from ${existing.id.slice(0, 8)}`);
      return undefined;
    }
    if (KNOWLEDGE_SECRET_PATTERN.test(result.text)) {
      console.warn("[memory] merged note looks like it holds a secret; saving the note on its own");
      return undefined;
    }
    if (!(await this.guardKnowledge(result.text))) {
      console.warn(`[memory] merged note failed the guards; saving the note on its own: "${truncate(result.text, 80)}"`);
      return undefined;
    }
    return result.text;
  }

  /** Save `text` as the new version of `old`. Its source stays when the new text cites none. */
  private async replace(
    store: MemoryStore,
    old: ActiveMemory,
    text: string,
    tags: string[],
    ctx: KnowledgeContext,
    report: WriteReport,
    how: "revised" | "merged",
  ): Promise<string> {
    const origin = dropUndefined({ ...ctx.origin, url: ctx.origin.url ?? old.origin?.url, tool: ctx.origin.tool ?? old.origin?.tool }) as MemoryOrigin;
    const merged = [...new Set([...(old.tags ?? []), ...tags])].slice(0, MAX_TAGS);
    const newId = await store.save(text, merged, "auto", { kind: "knowledge", origin });
    if (await store.supersede(old.id, newId)) report.superseded.push({ id: newId, text, replaced: { id: old.id, text: old.text } });
    console.log(`[memory] ${how} note ${old.id.slice(0, 8)} -> ${newId.slice(0, 8)} (${text.length} chars)`);
    return newId;
  }

  private async supersedeAll(
    store: MemoryStore,
    ids: string[],
    byId: string,
    text: string,
    done: string[],
    report: WriteReport,
    change: (id: string) => MemoryChange,
  ): Promise<void> {
    for (const oldId of ids) {
      if (oldId === byId || done.includes(oldId)) continue;
      if (await store.supersede(oldId, byId)) report.superseded.push({ id: byId, text, replaced: change(oldId) });
    }
  }

  private async forget(job: WriteJob, message: string, report: WriteReport): Promise<void> {
    try {
      const store = await this.store();
      const active = await store.listActive();
      const byId = new Map(active.map((m) => [m.id, m]));
      const state = { latest_user_message: truncate(message, MAX_GATE_MESSAGE_CHARS), conversation: job.conversation };

      const stage1 = await this.acrossShards(active, state, forgetStage1Questions);
      const shortlist = forgetShortlist(stage1).map((id) => byId.get(id)!).filter(Boolean);
      let matched: string[] = [];
      if (shortlist.length > 0) {
        const { memories, toId } = aliasShard(shortlist, this.textLimit);
        const stage2 = await this.ask({ ...state, memories }, forgetStage2Questions([...toId.keys()]));
        matched = decideForget(stage2.answers, toId);
      }

      if (matched.length === 0) {
        report.unresolvedForget = true;
        return;
      }
      for (const id of matched) {
        // A status, not a delete: the memory stops being used and stops being
        // sent anywhere, and the UI can restore it or delete it for good.
        if (await store.setStatus(id, "forgotten")) report.forgotten.push({ id, text: byId.get(id)?.text ?? "" });
      }
    } catch (err) {
      console.warn("[memory] forget request could not be processed:", errText(err));
      report.unresolvedForget = true;
    }
  }

  /** Run shard-level questions over the whole store; a store of any size stays within one request's budget. */
  private async acrossShards(
    active: ActiveMemory[],
    state: Record<string, unknown>,
    questions: (aliases: string[]) => Record<string, JevQuestion>,
  ): Promise<{ answers: JevResult["answers"]; toId: Map<string, string> }[]> {
    if (active.length === 0) return [];
    const reserved = estimateTokens(JSON.stringify(state)) + STAGE_OVERHEAD_TOKENS;
    const shards = shardMemories(active, reserved, this.cfg.shardTokenBudget, this.textLimit);
    return Promise.all(
      shards.map(async (shard) => {
        const { memories, toId } = aliasShard(shard, this.textLimit);
        const result = await this.ask({ ...state, memories }, questions([...toId.keys()]));
        return { answers: result.answers, toId };
      }),
    );
  }

  private ask(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResult> {
    return this.client.ask(state, questions, { timeoutMs: this.cfg.writeTimeoutMs, retries: 3 });
  }
}

/** Notes are meant to be English; a mostly-CJK one is worth a warning, not a drop. */
function looksEnglish(text: string): boolean {
  const letters = text.replace(/\s/g, "").length;
  const cjk = (text.match(CJK_PATTERN) ?? []).length;
  return letters === 0 || cjk / letters <= 0.3;
}

function dropUndefined<T extends object>(o: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
