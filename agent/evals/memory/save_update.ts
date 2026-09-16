// Experiment B (save gate) and C (invalidate / dedupe against the store).
import { mkdirSync, writeFileSync } from "node:fs";
import { ask, cost, f, type Q } from "./typesafe";
import { MEMORIES, SAVE, UPDATE } from "./data";

const ids = Object.keys(MEMORIES);
const pool = async <T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>) => {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(fn))));
  return out;
};

// ---------- B: should this turn write to memory? ----------
const SAVE_Q: Record<string, Q> = {
  durable_fact: { type: "noul", instructions: "Does `latest_user_message` state a lasting fact about the user, the people in their life, or their projects, as opposed to a momentary state?" },
  standing_pref: { type: "noul", instructions: "Does `latest_user_message` express a preference or instruction meant to apply to future interactions, not only to the current task?" },
  decision: { type: "noul", instructions: "Does `latest_user_message` report a decision that has already been made about the user's life, work, or projects?" },
  hypothetical: { type: "noul", instructions: "Is the main statement in `latest_user_message` hypothetical, counterfactual, or a joke rather than a claim about reality?" },
  transient: { type: "noul", instructions: "Is the information in `latest_user_message` only useful for the next few hours, such as a momentary mood, the status of the current task, or today's logistics?" },
  about_user_world: { type: "noul", instructions: "Is `latest_user_message` about the user's own life, relationships, preferences, or projects, rather than general world knowledge or a request for the assistant to do something?" },
  value: {
    type: "score",
    instructions: "How valuable is `latest_user_message` as long-term memory for the user's personal assistant?",
    criteria: [
      "Nothing worth remembering: a greeting, acknowledgement, question, one-off request, or momentary status",
      "A minor or short-lived detail that is unlikely to matter next week",
      "A lasting fact, preference, decision, or correction the assistant should still know a month from now",
    ],
  },
};

console.log("=== B: save gate ===");
const saveRes = await pool(SAVE, 6, async (c) => ({ c, r: await ask({ latest_user_message: c.msg }, SAVE_Q) }));
let correctScore = 0, correctRule = 0;
console.log("id   gold  value  dur  pref  dec  hyp  trans about | score>=1.2  rule");
for (const { c, r } of saveRes) {
  const a = r.answers;
  const n = (k: string) => a[k].noul as number;
  const byScore = a.value.score >= 1.2;
  const signal = Math.max(n("durable_fact"), n("standing_pref"), n("decision"));
  const byRule = signal >= 0.6 && n("hypothetical") < 0.5 && n("transient") < 0.6;
  correctScore += +(byScore === c.save); correctRule += +(byRule === c.save);
  console.log(`${c.id}  ${c.save ? "SAVE" : "skip"}  ${f(a.value.score)}  ${f(n("durable_fact"))} ${f(n("standing_pref"))} ${f(n("decision"))} ${f(n("hypothetical"))} ${f(n("transient"))}  ${f(n("about_user_world"))} | ${byScore === c.save ? "ok " : "XX "}        ${byRule === c.save ? "ok" : "XX"}   ${c.note}: "${c.msg.slice(0, 50)}"`);
}
console.log(`score-only: ${correctScore}/${SAVE.length}   noul-rule: ${correctRule}/${SAVE.length}   tokens≈${saveRes[0].r.usage.input_tokens}  median ${f(saveRes.map((x) => x.r.ms).sort((a, b) => a - b)[saveRes.length >> 1], 0)}ms`);

// ---------- C: which stored memories does the new statement invalidate / duplicate? ----------
function updateQuestions(): Record<string, Q> {
  const q: Record<string, Q> = {
    any_conflict: { type: "noul", instructions: "Does `new_statement` contradict, replace, or make outdated any entry in `memories`?" },
    which_outdated: {
      type: "choice",
      instructions: "Which entry in `memories` is made outdated or contradicted by `new_statement`?",
      criteria: { ...Object.fromEntries(ids.map((id) => [id, null])), none: "No memory is contradicted or made outdated" },
    },
  };
  for (const id of ids) {
    q[`rel::${id}`] = {
      type: "choice",
      instructions: `How does \`new_statement\` relate to \`memories.${id}\`?`,
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

console.log("\n=== C: invalidate / dedupe ===");
const uq = updateQuestions();
const updRes = await pool(UPDATE, 4, async (c) => ({ c, r: await ask({ new_statement: c.msg, memories: MEMORIES }, uq) }));
let outHit = 0, outTotal = 0, falseOut = 0, dupHit = 0, dupTotal = 0, trapFalls = 0, trapTotal = 0;
const dump: any[] = [];
for (const { c, r } of updRes) {
  const rel = ids.map((id) => ({ id, a: r.answers[`rel::${id}`] }));
  const flaggedOut = rel.filter((x) => x.a.choice === "outdated");
  const flaggedDup = rel.filter((x) => x.a.choice === "duplicate");
  const flaggedCons = rel.filter((x) => x.a.choice === "consistent");
  const show = (xs: typeof rel, k: string) => xs.map((x) => `${x.id}(${f(x.a.probabilities[k])}/c${f(x.a.confidence)})`).join(" ") || "-";
  outHit += c.outdated.filter((id) => flaggedOut.some((x) => x.id === id)).length; outTotal += c.outdated.length;
  falseOut += flaggedOut.filter((x) => !c.outdated.includes(x.id)).length;
  dupHit += c.duplicate.filter((id) => flaggedDup.some((x) => x.id === id)).length; dupTotal += c.duplicate.length;
  trapFalls += c.trap.filter((id) => flaggedOut.some((x) => x.id === id) || flaggedDup.some((x) => x.id === id)).length; trapTotal += c.trap.length;
  const top = Object.entries(r.answers.which_outdated.probabilities as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`\n${c.id} "${c.msg}"   [expect outdated=${c.outdated.join(",") || "-"} dup=${c.duplicate.join(",") || "-"}] ${c.note}`);
  console.log(`  per-memory outdated:  ${show(flaggedOut, "outdated")}`);
  console.log(`  per-memory duplicate: ${show(flaggedDup, "duplicate")}`);
  console.log(`  per-memory consistent: ${show(flaggedCons, "consistent")}`);
  console.log(`  missed outdated p: ${c.outdated.filter((id) => !flaggedOut.some((x) => x.id === id)).map((id) => `${id}:${JSON.stringify(Object.fromEntries(Object.entries(r.answers[`rel::${id}`].probabilities).map(([k, v]) => [k, +(v as number).toFixed(2)])))}`).join(" ") || "-"}`);
  console.log(`  single-Choice: ${top.map(([k, p]) => `${k}(${f(p)})`).join(" ")}   any_conflict=${f(r.answers.any_conflict.noul)}   tokens=${r.usage.input_tokens} ${f(r.ms, 0)}ms $${cost(r).toFixed(6)}`);
  dump.push({ id: c.id, msg: c.msg, flaggedOut: flaggedOut.map((x) => x.id), flaggedDup: flaggedDup.map((x) => x.id), top, any: r.answers.any_conflict.noul, usage: r.usage, ms: r.ms });
}
console.log(`\n== outdated found ${outHit}/${outTotal}, false 'outdated' flags ${falseOut}, duplicates found ${dupHit}/${dupTotal}, traps fallen into ${trapFalls}/${trapTotal}`);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/update.json", import.meta.url), JSON.stringify(dump, null, 1));
