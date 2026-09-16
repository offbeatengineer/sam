import {
  aliasShard,
  decideForget,
  decideGate,
  decideRelations,
  estimateTokens,
  forgetShortlist,
  forgetStage1Questions,
  forgetStage2Questions,
  gateQuestions,
  relationStage1Questions,
  relationStage2Questions,
  shardMemories,
  shortlistFromStage1,
  truncate,
  type Turn,
} from "./judgments.js";
import type { ActiveMemory, MemoryStore } from "./store.js";
import type { JevQuestion, JevResult, TypeSafeClient } from "./typesafe.js";
import type { TypeSafeConfig } from "./types.js";
import type { CandidateFact, MemoryFactWriter } from "./writer.js";

// ---------------------------------------------------------------------------
// After a turn: decide whether the user said anything worth keeping, have an
// LLM write it down, and reconcile it with what is already stored. Nothing is
// written without a Jev judgment, and nothing is destroyed: outdated memories
// are superseded and "forget" is a status, both reversible from the UI.
// ---------------------------------------------------------------------------

export interface MemoryChange {
  id: string;
  text: string;
}

export interface WriteReport {
  saved: (MemoryChange & { kind: string })[];
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
}

const MAX_GATE_MESSAGE_CHARS = 4000;
const MAX_PROFILE_MEMORIES = 20;
const STAGE_OVERHEAD_TOKENS = 400;

/** Last line of defense behind the writer's own rule against recording secrets. */
const SECRET_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|\b(password|passwd|passphrase|api[ _-]?key|secret|token)\b\s*(is|=|:)\s*\S+/i;

export function isEmptyReport(r: WriteReport): boolean {
  return (
    r.saved.length + r.superseded.length + r.duplicates.length + r.forgotten.length + r.flagged.length === 0 &&
    !r.unresolvedForget
  );
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

  constructor(
    private readonly client: TypeSafeClient,
    private readonly cfg: TypeSafeConfig,
    private readonly store: () => Promise<MemoryStore>,
    private readonly writer: MemoryFactWriter,
  ) {}

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

    return report;
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

  /** Insert, skip as duplicate, or insert and supersede, depending on how the fact relates to the store. */
  private async reconcile(fact: CandidateFact, report: WriteReport): Promise<void> {
    if (SECRET_PATTERN.test(fact.text)) {
      console.warn("[memory] dropped a candidate fact that looks like a secret");
      return;
    }

    const store = await this.store();
    const active = await store.listActive();
    const byId = new Map(active.map((m) => [m.id, m]));
    const state = { new_statement: fact.text };

    let decision;
    try {
      const stage1 = await this.acrossShards(active, state, relationStage1Questions);
      const shortlist = shortlistFromStage1(stage1).map((id) => byId.get(id)!).filter(Boolean);
      const { memories, toId } = aliasShard(shortlist);
      const stage2 = await this.ask({ ...state, memories }, relationStage2Questions([...toId.keys()]));
      decision = decideRelations(stage2.answers, toId, this.cfg.supersedeConfidence);
    } catch (err) {
      // Without the relation judgment a save could duplicate or contradict the store.
      console.warn(`[memory] could not reconcile "${truncate(fact.text, 60)}", not saving:`, errText(err));
      return;
    }

    if (decision.isInstruction) {
      console.warn(`[memory] rejected an instruction-shaped fact: "${truncate(fact.text, 80)}"`);
      return;
    }

    const change = (id: string): MemoryChange => ({ id, text: byId.get(id)?.text ?? "" });

    // Restating something known refreshes it. If the restatement also outdates
    // another memory, the existing duplicate is what replaces it.
    let currentId = decision.duplicates[0];
    if (currentId) {
      await store.touch(currentId);
      report.duplicates.push(change(currentId));
    } else {
      const profileCount = active.filter((m) => m.kind === "profile").length;
      const kind = fact.kind === "profile" && decision.profileScope && profileCount < MAX_PROFILE_MEMORIES ? "profile" : "situational";
      currentId = await store.save(fact.text, fact.tags, "auto", { kind });
      if (decision.supersede.length === 0) report.saved.push({ id: currentId, text: fact.text, kind });
    }

    for (const oldId of decision.supersede) {
      if (oldId === currentId) continue;
      if (await store.supersede(oldId, currentId)) {
        report.superseded.push({ id: currentId, text: fact.text, replaced: change(oldId) });
      }
    }
    for (const id of decision.flagged) report.flagged.push(change(id));
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
        const { memories, toId } = aliasShard(shortlist);
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
    const shards = shardMemories(active, reserved, this.cfg.shardTokenBudget);
    return Promise.all(
      shards.map(async (shard) => {
        const { memories, toId } = aliasShard(shard);
        const result = await this.ask({ ...state, memories }, questions([...toId.keys()]));
        return { answers: result.answers, toId };
      }),
    );
  }

  private ask(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResult> {
    return this.client.ask(state, questions, { timeoutMs: this.cfg.writeTimeoutMs, retries: 3 });
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
