// Experiment E: the same recall cases against a 250-memory store (60 real + 190 distractors).
//   variant 1: ONE Choice over all 250 ids (+none) -> does the core set land in the top 12?
//   variant 2: 250 short per-memory Nouls in one request -> multi-label recall at scale
import { ask, cost, f, type Q } from "./typesafe";
import { MEMORIES, RECALL } from "./data";
import { scaleStore } from "./distractors";

const store = scaleStore();
const real = Object.entries(MEMORIES);
const ids = Object.keys(store);
console.log(`store: ${ids.length} memories (${real.length} real + ${ids.length - real.length} distractors)`);

const choiceQ: Record<string, Q> = {
  gate: { type: "noul", instructions: "Does any entry in `memories` contain a fact, preference, or constraint that should inform the assistant's response to `latest_user_message`?" },
  which: {
    type: "choice",
    instructions: "Which entry in `memories` is the most useful for responding to `latest_user_message`?",
    criteria: { ...Object.fromEntries(ids.map((id) => [id, null])), none: "No memory is useful for this message" },
  },
};
const noulQ: Record<string, Q> = Object.fromEntries(
  ids.map((id) => [`rel::${id}`, { type: "noul", instructions: `Would \`memories.${id}\` change or improve the assistant's response to \`latest_user_message\`?` } as Q]),
);

const TOPK = 12, THRESH = 0.5;
let cHit = 0, nHit = 0, total = 0, nPicked = 0, nNoise = 0;
const cMs: number[] = [], nMs: number[] = [];
let cTok = 0, nTok = 0;
for (let i = 0; i < RECALL.length; i += 4) {
  await Promise.all(RECALL.slice(i, i + 4).map(async (c) => {
    const state = { latest_user_message: c.msg, memories: store };
    const [rc, rn] = await Promise.all([ask(state, choiceQ), ask(state, noulQ)]);
    cMs.push(rc.ms); nMs.push(rn.ms); cTok = rc.usage.input_tokens; nTok = rn.usage.input_tokens;
    const ranked = Object.entries(rc.answers.which.probabilities as Record<string, number>).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, TOPK).map(([k]) => k);
    const picked = ids.map((id) => ({ id, p: rn.answers[`rel::${id}`].noul as number })).filter((x) => x.p >= THRESH).sort((a, b) => b.p - a.p);
    const allowed = new Set([...c.core, ...c.ok, "M13", "M14"]);
    const noise = picked.filter((x) => !allowed.has(x.id));
    cHit += c.core.filter((id) => top.includes(id)).length;
    nHit += c.core.filter((id) => picked.some((x) => x.id === id)).length;
    total += c.core.length; nPicked += picked.length; nNoise += noise.length;
    console.log(`\n${c.id} [${c.kind}] "${c.msg.slice(0, 58)}"  gate=${f(rc.answers.gate.noul)}`);
    console.log(`  choice top${TOPK}: core ${c.core.filter((id) => top.includes(id)).length}/${c.core.length}  ranks ${c.core.map((id) => `${id}#${ranked.findIndex(([k]) => k === id) + 1}`).join(" ") || "-"}  top3 ${ranked.slice(0, 3).map(([k, p]) => `${k}(${f(p)})`).join(" ")}`);
    console.log(`  nouls>=${THRESH}: core ${c.core.filter((id) => picked.some((x) => x.id === id)).length}/${c.core.length}  picked ${picked.length}  noise: ${noise.map((x) => `${x.id}(${f(x.p)})`).join(" ") || "-"}`);
  }));
}
const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
console.log(`\n== 250-memory store`);
console.log(`   single Choice : core in top-${TOPK} ${cHit}/${total}   ${cTok} tokens  median ${f(med(cMs), 0)}ms  $${((cTok / 1e6) * 0.042).toFixed(6)}/turn`);
console.log(`   250 Nouls     : core recall ${nHit}/${total}, noise ${nNoise}/${nPicked}   ${nTok} tokens  median ${f(med(nMs), 0)}ms  $${((nTok / 1e6) * 0.042).toFixed(6)}/turn`);
