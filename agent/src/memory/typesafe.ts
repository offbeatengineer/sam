import type { TypeSafeConfig } from "./types.js";

// ---------------------------------------------------------------------------
// TypeSafe System One ("Jev") client. Raw HTTP on purpose: the official SDK is
// days old and already had a breaking release, and this surface is one POST.
// ---------------------------------------------------------------------------

export type JevQuestion =
  | { type: "noul"; instructions: unknown; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export interface JevAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface JevResult {
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  ms: number;
  model: string;
}

export interface AskOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Extra attempts on 429/529, only while the time budget allows. */
  retries?: number;
}

/** Disabled, missing key, or circuit breaker open. Callers degrade, never crash. */
export class TypeSafeUnavailableError extends Error {}

/** The request reached TypeSafe and was rejected. `status` drives shard-halving. */
export class TypeSafeRequestError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`TypeSafe HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

const BREAKER_FAILURES = 3;
const BREAKER_OPEN_MS = 60_000;
const FLOATING_MODEL = "jev-latest";

export class TypeSafeClient {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private activeModel: string;

  constructor(private readonly cfg: TypeSafeConfig) {
    this.activeModel = cfg.model;
  }

  /** The model requests are sent to; differs from the config once a pin is retired. */
  get model(): string {
    return this.activeModel;
  }

  /** Cheap pre-check so callers can skip building a request they can't send. */
  get available(): boolean {
    return this.cfg.enabled && !!this.cfg.apiKey && Date.now() >= this.openUntil;
  }

  async ask(state: unknown, questions: Record<string, JevQuestion>, opts: AskOptions = {}): Promise<JevResult> {
    if (!this.cfg.enabled) throw new TypeSafeUnavailableError("typesafe is disabled");
    if (!this.cfg.apiKey) throw new TypeSafeUnavailableError("TYPESAFE_API_KEY is not set");
    if (Date.now() < this.openUntil) throw new TypeSafeUnavailableError("circuit breaker open");

    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const deadline = Date.now() + timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    const retries = opts.retries ?? 0;

    try {
      for (let attempt = 0; ; attempt++) {
        const t0 = performance.now();
        const res = await fetch(`${this.cfg.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ state, model: this.activeModel, questions }),
          signal,
        });
        const ms = performance.now() - t0;

        if (res.status === 429 || res.status === 529) {
          const backoff = 300 * 2 ** attempt;
          if (attempt < retries && Date.now() + backoff < deadline) {
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
        }
        if (!res.ok) {
          const text = await res.text();
          // TypeSafe retires pinned versions (jev-1.12 was gone within weeks).
          // Keep memory working on the floating alias rather than going dark.
          if (res.status === 400 && /unknown model/i.test(text) && this.activeModel !== FLOATING_MODEL) {
            console.warn(
              `[memory] TypeSafe no longer serves "${this.activeModel}"; falling back to "${FLOATING_MODEL}". ` +
                `Thresholds were calibrated on the pinned version: re-run the memory evals and update memory.typesafe.model.`,
            );
            this.activeModel = FLOATING_MODEL;
            continue;
          }
          throw new TypeSafeRequestError(res.status, text);
        }

        const json = (await res.json()) as any;
        if (!json || typeof json.answers !== "object" || json.answers === null) {
          throw new Error("TypeSafe response has no answers object");
        }
        this.consecutiveFailures = 0;
        return {
          answers: json.answers,
          usage: json.usage ?? { input_tokens: 0, output_tokens: 0 },
          ms,
          model: json.model ?? this.cfg.model,
        };
      }
    } catch (err) {
      // An over-budget request (400/413) is the caller's sizing problem, and a
      // caller-initiated abort is not an outage; neither should trip the breaker.
      const sizing = err instanceof TypeSafeRequestError && (err.status === 400 || err.status === 413);
      const callerAbort = opts.signal?.aborted === true;
      if (!sizing && !callerAbort) this.recordFailure();
      throw err;
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= BREAKER_FAILURES && Date.now() >= this.openUntil) {
      this.openUntil = Date.now() + BREAKER_OPEN_MS;
      this.consecutiveFailures = 0;
      console.warn(`[memory] TypeSafe failing; pausing automatic memory for ${BREAKER_OPEN_MS / 1000}s`);
    }
  }
}
