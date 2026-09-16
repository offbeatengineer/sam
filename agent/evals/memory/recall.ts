// Experiment A: automatic per-turn recall. One request per user message carries
//   - a Noul per memory ("would this memory change the response?")  -> independent, multi-label
//   - one Choice over all memory ids + none                          -> ranking
//   - one Noul gate ("does any memory bear on this?")
import { mkdirSync, writeFileSync } from "node:fs";
import { ask, cost, f, type Q } from "./typesafe";
import { MEMORIES, RECALL } from "./data";

const ids = Object.keys(MEMORIES);

function questions(): Record<string, Q> {
  const q: Record<string, Q> = {
    gate: {
      type: "noul",
      instructions: "Does any entry in `memories` contain a fact, preference, or constraint that should inform the assistant's response to `latest_user_message`?",
      criteria: { true: "At least one memory would change or improve the response", false: "The response would be the same without any of the memories" },
    },
    which: {
      type: "choice",
      instructions: "Which entry in `memories` is the most useful for responding to `latest_user_message`?",
      criteria: { ...Object.fromEntries(ids.map((id) => [id, null])), none: "No memory is useful for this message" },
    },
  };
  for (const id of ids) {
    q[`rel::${id}`] = {
      type: "noul",
      instructions: `Should the assistant take \`memories.${id}\` into account when responding to \`latest_user_message\`?`,
      criteria: {
        true: "The memory holds a fact, preference, or constraint that would change or improve the response, even if the message does not mention it",
        false: "The memory is about something else, or the response would be the same without it",
      },
    };
  }
  return q;
}

const THRESH = 0.5;
const out: any[] = [];
const q = questions();

async function run(c: (typeof RECALL)[number]) {
  const r = await ask({ latest_user_message: c.msg, memories: MEMORIES }, q);
  const rel = ids.map((id) => ({ id, p: r.answers[`rel::${id}`].noul as number })).sort((a, b) => b.p - a.p);
  const picked = rel.filter((x) => x.p >= THRESH).map((x) => x.id);
  const choiceTop = Object.entries(r.answers.which.probabilities as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { c, gate: r.answers.gate.noul as number, rel, picked, choiceTop, usage: r.usage, ms: r.ms, cost: cost(r) };
}

// small pool
const results: Awaited<ReturnType<typeof run>>[] = [];
for (let i = 0; i < RECALL.length; i += 4) results.push(...(await Promise.all(RECALL.slice(i, i + 4).map(run))));

let coreHit = 0, coreTotal = 0, noise = 0, pickedTotal = 0;
for (const r of results) {
  const { c } = r;
  // M13/M14 are always-on style preferences; baseline.ts allows them too, keep the two comparable
  const allowed = new Set([...c.core, ...c.ok, "M13", "M14"]);
  const hit = c.core.filter((id) => r.picked.includes(id));
  const extra = r.picked.filter((id) => !allowed.has(id));
  coreHit += hit.length; coreTotal += c.core.length; noise += extra.length; pickedTotal += r.picked.length;
  console.log(`\n${c.id} [${c.kind}] "${c.msg}"`);
  console.log(`  gate=${f(r.gate)}  tokens=${r.usage.input_tokens}  ${f(r.ms, 0)}ms  $${r.cost.toFixed(6)}`);
  console.log(`  noul>=${THRESH}: ${r.picked.map((id) => `${id}(${f(r.rel.find((x) => x.id === id)!.p)})`).join(" ") || "-"}`);
  console.log(`  core ${hit.length}/${c.core.length}${c.core.length ? " missed: " + (c.core.filter((id) => !hit.includes(id)).map((id) => `${id}(${f(r.rel.find((x) => x.id === id)!.p)})`).join(" ") || "-") : ""}   noise: ${extra.join(" ") || "-"}`);
  console.log(`  choice top: ${r.choiceTop.map(([k, p]) => `${k}(${f(p)})`).join(" ")}`);
  out.push({ id: c.id, kind: c.kind, msg: c.msg, gate: r.gate, picked: r.picked, core: c.core, ok: c.ok, rel: r.rel.slice(0, 10), choiceTop: r.choiceTop, usage: r.usage, ms: r.ms });
}
console.log(`\n== Jev per-memory Noul @${THRESH}: core recall ${coreHit}/${coreTotal}, noise ${noise}/${pickedTotal} picked`);
const noneCases = results.filter((r) => r.c.kind === "none");
console.log(`== "none" cases: gate values ${noneCases.map((r) => f(r.gate)).join(", ")}; vs others min gate ${f(Math.min(...results.filter((r) => r.c.kind !== "none").map((r) => r.gate)))}`);
const lat = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(`== latency median ${f(lat[lat.length >> 1], 0)}ms, max ${f(lat[lat.length - 1], 0)}ms; mean cost $${(results.reduce((s, r) => s + r.cost, 0) / results.length).toFixed(6)}/turn`);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/recall.json", import.meta.url), JSON.stringify(out, null, 1));
