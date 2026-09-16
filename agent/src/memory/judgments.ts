import type { JevAnswer, JevQuestion } from "./typesafe.js";

// ---------------------------------------------------------------------------
// Pure builders and deciders for the Jev judgments behind automatic memory.
// No I/O here: evals/memory imports these so it measures exactly what
// production sends. Question wording is the wording that was measured; change
// it only together with a re-run of the evals.
// ---------------------------------------------------------------------------

/** Version the thresholds below were calibrated on. Pins look like `jev-1.13.0`. */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface MemoryText {
  id: string;
  text: string;
}

/** Rough but conservative: ASCII runs ~4 chars/token, CJK and friends ~1.5 tokens/char. */
export function estimateTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other * 1.5);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** State entry plus one short Noul per memory (measured ~57 tokens at ~20-token texts). */
const PER_MEMORY_OVERHEAD_TOKENS = 45;
export const MAX_MEMORY_CHARS = 400;

/**
 * Split the store into evenly loaded shards that each fit one request.
 * `reservedTokens` covers the conversation and any shard-independent questions.
 */
export function shardMemories<T extends MemoryText>(mems: T[], reservedTokens: number, budget: number): T[][] {
  if (mems.length === 0) return [];
  const room = Math.max(1000, budget - reservedTokens);
  const costs = mems.map((m) => estimateTokens(truncate(m.text, MAX_MEMORY_CHARS)) + PER_MEMORY_OVERHEAD_TOKENS);
  const total = costs.reduce((a, b) => a + b, 0);
  const shardCount = Math.max(1, Math.ceil(total / room));
  const target = total / shardCount;

  const shards: T[][] = [[]];
  let load = 0;
  for (let i = 0; i < mems.length; i++) {
    const current = shards[shards.length - 1];
    if (current.length > 0 && load + costs[i] > target && shards.length < shardCount) {
      shards.push([]);
      load = 0;
    }
    shards[shards.length - 1].push(mems[i]);
    load += costs[i];
  }
  return shards;
}

/**
 * Real ids are 36-char UUIDs and each appears twice per memory (state key and
 * question text). Short per-request aliases keep the measured shard capacity.
 */
export function aliasShard(shard: MemoryText[]): { memories: Record<string, string>; toId: Map<string, string> } {
  const memories: Record<string, string> = {};
  const toId = new Map<string, string>();
  shard.forEach((m, i) => {
    const alias = `m${i}`;
    memories[alias] = truncate(m.text, MAX_MEMORY_CHARS);
    toId.set(alias, m.id);
  });
  return { memories, toId };
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

const REL = "rel::";

/** One independent Noul per memory. A Choice sums to 1, so it can rank but not test relevance. */
export function recallQuestions(aliases: string[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  for (const alias of aliases) {
    q[`${REL}${alias}`] = {
      type: "noul",
      instructions: `Would \`memories.${alias}\` change or improve the assistant's next response in \`conversation\`?`,
    };
  }
  return q;
}

export interface Picked {
  id: string;
  p: number;
}

/** A missing answer counts as p=0: a partial response must never throw away the rest. */
export function pickRecalled(answers: Record<string, JevAnswer>, toId: Map<string, string>, threshold: number): Picked[] {
  const picked: Picked[] = [];
  for (const [alias, id] of toId) {
    const p = answers[`${REL}${alias}`]?.noul ?? 0;
    if (p >= threshold) picked.push({ id, p });
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Save gate: is this user message worth a (comparatively expensive) LLM call
// to write memories from? State: { latest_user_message, conversation }.
// ---------------------------------------------------------------------------

/**
 * Measured: skips scored <= 0.93 and saves >= 1.70 on this 0..2 rubric, so the
 * default threshold of 1.3 sits in the middle of the gap.
 * `forget_request` is new and has no measurement behind its threshold yet.
 */
export function gateQuestions(): Record<string, JevQuestion> {
  return {
    value: {
      type: "score",
      instructions: "How valuable is `latest_user_message` as long-term memory for the user's personal assistant?",
      criteria: [
        "Nothing worth remembering: a greeting, acknowledgement, question, one-off request, or momentary status",
        "A minor or short-lived detail that is unlikely to matter next week",
        "A lasting fact, preference, decision, or correction the assistant should still know a month from now",
      ],
    },
    hypothetical: {
      type: "noul",
      instructions: "Is the main statement in `latest_user_message` hypothetical, counterfactual, or a joke rather than a claim about reality?",
    },
    transient: {
      type: "noul",
      instructions: "Is the information in `latest_user_message` only useful for the next few hours, such as a momentary mood, the status of the current task, or today's logistics?",
    },
    forget_request: {
      type: "noul",
      instructions: "Is the user asking the assistant in `latest_user_message` to forget, delete, or stop remembering something it knows about them?",
    },
  };
}

export const FORGET_REQUEST_THRESHOLD = 0.7;

export interface GateDecision {
  save: boolean;
  forget: boolean;
  value: number;
  hypothetical: number;
  transient: number;
  forgetRequest: number;
}

export function decideGate(answers: Record<string, JevAnswer>, saveScoreThreshold: number): GateDecision {
  const value = answers.value?.score ?? 0;
  const forgetRequest = answers.forget_request?.noul ?? 0;
  return {
    save: value >= saveScoreThreshold,
    forget: forgetRequest >= FORGET_REQUEST_THRESHOLD,
    value,
    // Logged, not acted on: the Score alone separated every measured case.
    hypothetical: answers.hypothetical?.noul ?? 0,
    transient: answers.transient?.noul ?? 0,
    forgetRequest,
  };
}

// ---------------------------------------------------------------------------
// Relation of one candidate fact to the store. State: { new_statement, memories }.
// Two stages: a cheap Choice over every memory finds candidates, then a
// per-memory relation Choice judges only that shortlist.
// ---------------------------------------------------------------------------

const NONE = "none";
const SHORTLIST_SIZE = 8;
const SHORTLIST_MIN_P = 0.005;

function idChoice(aliases: string[], noneMeaning: string): Record<string, unknown> {
  return { ...Object.fromEntries(aliases.map((a) => [a, null])), [NONE]: noneMeaning };
}

/** `which_outdated` had the right top-1 in every measured case; `which_related` is new (it finds duplicates). */
export function relationStage1Questions(aliases: string[]): Record<string, JevQuestion> {
  return {
    any_conflict: {
      type: "noul",
      instructions: "Does `new_statement` contradict, replace, or make outdated any entry in `memories`?",
    },
    which_outdated: {
      type: "choice",
      instructions: "Which entry in `memories` is made outdated or contradicted by `new_statement`?",
      criteria: idChoice(aliases, "No memory is contradicted or made outdated"),
    },
    which_related: {
      type: "choice",
      instructions: "Which entry in `memories` is about the same subject as `new_statement`?",
      criteria: idChoice(aliases, "No memory is about the same subject"),
    },
  };
}

/** Best candidates across all shards, by the higher of the two Choice probabilities. */
export function shortlistFromStage1(shards: { answers: Record<string, JevAnswer>; toId: Map<string, string> }[]): string[] {
  const best = new Map<string, number>();
  for (const { answers, toId } of shards) {
    for (const key of ["which_outdated", "which_related"]) {
      for (const [alias, p] of Object.entries(answers[key]?.probabilities ?? {})) {
        const id = toId.get(alias);
        if (id && p >= SHORTLIST_MIN_P) best.set(id, Math.max(best.get(id) ?? 0, p));
      }
    }
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, SHORTLIST_SIZE).map(([id]) => id);
}

const RELATION = "relation::";

export function relationStage2Questions(aliases: string[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {
    // Both new. profile_scope guards the always-on block; is_instruction keeps
    // commands out of a store that is replayed into an agent that can act.
    profile_scope: {
      type: "noul",
      instructions: "Would `new_statement` be relevant to almost every conversation with this user regardless of topic, such as a preference about how the assistant should communicate?",
    },
    is_instruction: {
      type: "noul",
      instructions: "Is `new_statement` an instruction for the assistant to run a command, take an action, or change its safety behavior, rather than a fact or preference about the user?",
    },
  };
  for (const alias of aliases) {
    q[`${RELATION}${alias}`] = {
      type: "choice",
      instructions: `How does \`new_statement\` relate to \`memories.${alias}\`?`,
      criteria: {
        unrelated: "They are about different subjects, or about different people or things",
        consistent: "Same subject, and both can be true at once; the new statement is merely related or adds detail",
        duplicate: "The new statement says the same thing the memory already records",
        outdated: "The new statement contradicts the memory, or replaces part of it with newer information, so the memory should no longer be trusted as written",
      },
    };
  }
  return q;
}

export const IS_INSTRUCTION_THRESHOLD = 0.5;
export const PROFILE_SCOPE_THRESHOLD = 0.7;
export const DUPLICATE_CONFIDENCE = 0.5;

export interface RelationDecision {
  /** Replace these: judged outdated with enough confidence to act. */
  supersede: string[];
  /** Judged outdated, but not confidently. Measured false flags sat near 0.4, real ones >= 0.65. */
  flagged: string[];
  duplicates: string[];
  isInstruction: boolean;
  profileScope: boolean;
}

export function decideRelations(answers: Record<string, JevAnswer>, toId: Map<string, string>, supersedeConfidence: number): RelationDecision {
  const decision: RelationDecision = {
    supersede: [],
    flagged: [],
    duplicates: [],
    isInstruction: (answers.is_instruction?.noul ?? 0) >= IS_INSTRUCTION_THRESHOLD,
    profileScope: (answers.profile_scope?.noul ?? 0) >= PROFILE_SCOPE_THRESHOLD,
  };
  for (const [alias, id] of toId) {
    const a = answers[`${RELATION}${alias}`];
    const confidence = a?.confidence ?? 0;
    if (a?.choice === "outdated") (confidence >= supersedeConfidence ? decision.supersede : decision.flagged).push(id);
    else if (a?.choice === "duplicate" && confidence >= DUPLICATE_CONFIDENCE) decision.duplicates.push(id);
  }
  return decision;
}

// ---------------------------------------------------------------------------
// Explicit "forget X". State: { latest_user_message, conversation, memories }.
// Unmeasured; conservative thresholds, and forgetting is a recoverable status.
// ---------------------------------------------------------------------------

const FORGET = "forget::";
const FORGET_SHORTLIST_SIZE = 5;
export const FORGET_MATCH_THRESHOLD = 0.75;

export function forgetStage1Questions(aliases: string[]): Record<string, JevQuestion> {
  return {
    which_forget: {
      type: "choice",
      instructions: "Which entry in `memories` is the user asking the assistant to forget in `latest_user_message`?",
      criteria: idChoice(aliases, "None of these memories is what the user wants forgotten"),
    },
  };
}

export function forgetShortlist(shards: { answers: Record<string, JevAnswer>; toId: Map<string, string> }[]): string[] {
  const best = new Map<string, number>();
  for (const { answers, toId } of shards) {
    for (const [alias, p] of Object.entries(answers.which_forget?.probabilities ?? {})) {
      const id = toId.get(alias);
      if (id && p >= SHORTLIST_MIN_P) best.set(id, Math.max(best.get(id) ?? 0, p));
    }
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, FORGET_SHORTLIST_SIZE).map(([id]) => id);
}

/** A Choice always picks something, so each candidate is confirmed by an independent Noul. */
export function forgetStage2Questions(aliases: string[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};
  for (const alias of aliases) {
    q[`${FORGET}${alias}`] = {
      type: "noul",
      instructions: `Is the user asking the assistant in \`latest_user_message\` to forget or stop using \`memories.${alias}\`?`,
    };
  }
  return q;
}

export function decideForget(answers: Record<string, JevAnswer>, toId: Map<string, string>): string[] {
  const ids: string[] = [];
  for (const [alias, id] of toId) {
    if ((answers[`${FORGET}${alias}`]?.noul ?? 0) >= FORGET_MATCH_THRESHOLD) ids.push(id);
  }
  return ids;
}
