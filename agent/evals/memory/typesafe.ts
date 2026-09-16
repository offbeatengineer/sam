// The exploratory scripts in this folder predate src/memory/typesafe.ts. They
// keep their small `ask()` surface, now backed by the production client so
// there is one HTTP implementation. New evals (run.ts) use the client directly.
import { parseTypeSafeConfig } from "../../src/config.js";
import { TypeSafeClient, type JevQuestion, type JevResult } from "../../src/memory/typesafe.js";
import type { TypeSafeConfig } from "../../src/memory/types.js";

export type Q = JevQuestion;
/** Loosely typed on purpose: the exploratory scripts index into answers freely. */
export type Result = Omit<JevResult, "answers"> & { answers: Record<string, any> };
export const PRICE_PER_M_INPUT = 0.042;

/** Production defaults, with timeouts loose enough that an eval never fails on latency. */
export function evalConfig(overrides: Partial<TypeSafeConfig> = {}): TypeSafeConfig {
  return { ...parseTypeSafeConfig({ enabled: true }), timeoutMs: 30_000, writeTimeoutMs: 30_000, ...overrides };
}

const client = new TypeSafeClient(evalConfig());

export function ask(state: unknown, questions: Record<string, Q>): Promise<Result> {
  return client.ask(state, questions, { retries: 4 });
}

export const cost = (r: Result) => (r.usage.input_tokens / 1e6) * PRICE_PER_M_INPUT;
export const f = (n: number, d = 2) => n.toFixed(d);
