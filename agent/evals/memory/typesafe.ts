// Minimal TypeSafe client for the feasibility experiments (raw HTTP, no SDK).
export type Q =
  | { type: "noul"; instructions: unknown; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export interface Result {
  answers: Record<string, any>;
  usage: { input_tokens: number; output_tokens: number };
  ms: number;
  model: string;
}

const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) throw new Error("TYPESAFE_API_KEY missing");

export const PRICE_PER_M_INPUT = 0.042;

export async function ask(state: unknown, questions: Record<string, Q>, model = "jev-latest"): Promise<Result> {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, model, questions }),
    });
    const ms = performance.now() - t0;
    if ((res.status === 429 || res.status === 529) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const body = (await res.json()) as any;
    return { answers: body.answers, usage: body.usage, ms, model: body.model };
  }
}

export const cost = (r: Result) => (r.usage.input_tokens / 1e6) * PRICE_PER_M_INPUT;
export const f = (n: number, d = 2) => n.toFixed(d);
