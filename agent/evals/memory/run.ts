// Regression harness for automatic memory. Unlike the exploratory scripts next
// to it, this runs the PRODUCTION question builders and deciders from
// src/memory against the labeled data, and fails when a result drops below the
// committed floor. Run it before changing question wording, thresholds, or the
// pinned Jev model:   bun run eval:memory:all
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  aliasShard,
  decideForget,
  decideGate,
  decideRelations,
  DEFAULT_JEV_MODEL,
  forgetShortlist,
  forgetStage1Questions,
  forgetStage2Questions,
  gateQuestions,
  relationStage1Questions,
  relationStage2Questions,
  shortlistFromStage1,
} from "../../src/memory/judgments.js";
import { MemoryRecaller } from "../../src/memory/recaller.js";
import type { ActiveMemory } from "../../src/memory/store.js";
import { TypeSafeClient } from "../../src/memory/typesafe.js";
import { DUPLICATE, FORGET, INSTRUCTION, MEMORIES, PROFILE, RECALL, SAVE, UPDATE } from "./data.js";
import { evalConfig } from "./typesafe.js";

const PROFILE_IDS = new Set(["M13", "M14"]); // always-on in production, so never judged per turn
const cfg = evalConfig();
const client = new TypeSafeClient(cfg);
const ask = (state: unknown, questions: any) => client.ask(state, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 });

const now = Date.now();
const memory = (id: string): ActiveMemory => ({ id, text: MEMORIES[id], tags: [], source: "user", created_at: now, updated_at: now, kind: PROFILE_IDS.has(id) ? "profile" : "situational" });
const all = Object.keys(MEMORIES).map(memory);
const situational = all.filter((m) => m.kind === "situational");

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const metrics: Record<string, number> = {};
const details: Record<string, unknown> = {};
let servedModel = "";

// --- recall, in the production form: conversation state, aliased ids, short Nouls ---
async function recallSuite(name: string, recaller: MemoryRecaller) {
  const rows = await pool(RECALL, 4, async (c) => {
    const outcome = await recaller.recall([{ role: "user", text: c.msg }], situational);
    if (outcome.status !== "ok") throw new Error(`recall ${c.id} ${outcome.status}: ${outcome.reason}`);
    servedModel = outcome.model ?? servedModel;
    const picked = outcome.picked.map((m) => m.id);
    const allowed = new Set([...c.core, ...c.ok]);
    return { id: c.id, core: c.core, picked, missed: c.core.filter((m) => !picked.includes(m)), noise: picked.filter((m) => !allowed.has(m)), shards: outcome.shards };
  });
  metrics[`${name}.core`] = rows.reduce((n, r) => n + r.core.length - r.missed.length, 0);
  metrics[`${name}.noise`] = rows.reduce((n, r) => n + r.noise.length, 0);
  details[name] = rows.filter((r) => r.missed.length || r.noise.length);
  return rows;
}

await recallSuite("recall", new MemoryRecaller(client, cfg));
// A budget this small forces several shards; recall must not depend on shard boundaries.
const sharded = await recallSuite("recall_sharded", new MemoryRecaller(client, { ...cfg, shardTokenBudget: 1800, maxShards: 50, maxRecalled: 50 }));
metrics["recall_sharded.min_shards"] = Math.min(...sharded.map((r) => r.shards));

// --- save gate ---
const gates = await pool(SAVE, 6, async (c) => ({ c, d: decideGate((await ask({ latest_user_message: c.msg, conversation: [{ role: "user", text: c.msg }] }, gateQuestions())).answers, cfg.saveScoreThreshold) }));
metrics["gate.correct"] = gates.filter(({ c, d }) => d.save === c.save).length;
metrics["gate.false_forget"] = gates.filter(({ d }) => d.forget).length;
details.gate = gates.filter(({ c, d }) => d.save !== c.save).map(({ c, d }) => ({ id: c.id, msg: c.msg, value: d.value }));

// --- relation: stage 1 shortlist, stage 2 decision, exactly as the write pipeline does ---
async function relate(statement: string) {
  const { memories, toId } = aliasShard(all);
  const stage1 = await ask({ new_statement: statement, memories }, relationStage1Questions([...toId.keys()]));
  const shortlist = shortlistFromStage1([{ answers: stage1.answers, toId }]);
  const short = aliasShard(shortlist.map(memory));
  const stage2 = await ask({ new_statement: statement, memories: short.memories }, relationStage2Questions([...short.toId.keys()]));
  return { shortlist, decision: decideRelations(stage2.answers, short.toId, cfg.supersedeConfidence), answers: stage2.answers };
}

const updates = await pool(UPDATE, 4, async (c) => ({ c, ...(await relate(c.msg)) }));
metrics["update.outdated_found"] = updates.reduce((n, { c, decision }) => n + c.outdated.filter((m) => decision.supersede.includes(m)).length, 0);
// What the confidence gate exists to prevent: acting on a memory that is not outdated.
metrics["update.false_supersede"] = updates.reduce((n, { c, decision }) => n + decision.supersede.filter((m) => !c.outdated.includes(m)).length, 0);
metrics["update.traps"] = updates.reduce((n, { c, decision }) => n + c.trap.filter((m) => decision.supersede.includes(m) || decision.duplicates.includes(m)).length, 0);
details.update = updates.map(({ c, decision }) => ({ id: c.id, expect: c.outdated, supersede: decision.supersede, flagged: decision.flagged, duplicates: decision.duplicates })).filter((r) => JSON.stringify(r.expect.slice().sort()) !== JSON.stringify(r.supersede.slice().sort()) || r.flagged.length);

const dups = await pool(DUPLICATE, 5, async (c) => ({ c, ...(await relate(c.fact)) }));
metrics["duplicate.shortlisted"] = dups.filter(({ c, shortlist }) => shortlist.includes(c.duplicateOf)).length;
metrics["duplicate.found"] = dups.filter(({ c, decision }) => decision.duplicates.includes(c.duplicateOf)).length;
details.duplicate = dups.filter(({ c, decision }) => !decision.duplicates.includes(c.duplicateOf)).map(({ c }) => c.id);

const instructions = await pool(INSTRUCTION, 4, async (c) => ({ c, ...(await relate(c.fact)) }));
metrics["instruction.correct"] = instructions.filter(({ c, decision }) => decision.isInstruction === c.instruction).length;
// The costly direction: an instruction that gets stored.
metrics["instruction.missed"] = instructions.filter(({ c, decision }) => c.instruction && !decision.isInstruction).length;
details.instruction = instructions.filter(({ c, decision }) => decision.isInstruction !== c.instruction).map(({ c, answers }) => ({ id: c.id, p: answers.is_instruction?.noul }));

const profiles = await pool(PROFILE, 4, async (c) => ({ c, ...(await relate(c.fact)) }));
metrics["profile.correct"] = profiles.filter(({ c, decision }) => decision.profileScope === c.profile).length;
details.profile = profiles.filter(({ c, decision }) => decision.profileScope !== c.profile).map(({ c, answers }) => ({ id: c.id, p: answers.profile_scope?.noul }));

// --- forget: gate Noul, then Choice shortlist, then confirming Nouls ---
const forgets = await pool(FORGET, 4, async (c) => {
  const state = { latest_user_message: c.msg, conversation: [{ role: "user", text: c.msg }] };
  const gate = decideGate((await ask(state, gateQuestions())).answers, cfg.saveScoreThreshold);
  let matched: string[] = [];
  if (gate.forget) {
    const { memories, toId } = aliasShard(all);
    const stage1 = await ask({ ...state, memories }, forgetStage1Questions([...toId.keys()]));
    const short = aliasShard(forgetShortlist([{ answers: stage1.answers, toId }]).map(memory));
    if (short.toId.size > 0) matched = decideForget((await ask({ ...state, memories: short.memories }, forgetStage2Questions([...short.toId.keys()]))).answers, short.toId);
  }
  return { c, gate, matched };
});
metrics["forget.correct"] = forgets.filter(({ c, matched }) => JSON.stringify(matched.slice().sort()) === JSON.stringify(c.forget.slice().sort())).length;
// The costly direction: forgetting something the user did not ask to forget.
metrics["forget.wrongly_forgotten"] = forgets.reduce((n, { c, matched }) => n + matched.filter((m) => !c.forget.includes(m)).length, 0);
details.forget = forgets.filter(({ c, matched }) => JSON.stringify(matched.slice().sort()) !== JSON.stringify(c.forget.slice().sort())).map(({ c, gate, matched }) => ({ id: c.id, expect: c.forget, matched, forgetRequest: gate.forgetRequest }));

// --- report against floors ---
const floors = JSON.parse(readFileSync(new URL("./floors.json", import.meta.url), "utf8")) as Record<string, { min?: number; max?: number; of?: number }>;
let failed = 0;
console.log(`\nmodel served: ${servedModel}${servedModel !== DEFAULT_JEV_MODEL ? `   (floors were calibrated on ${DEFAULT_JEV_MODEL})` : ""}\n`);
for (const [key, value] of Object.entries(metrics)) {
  const floor = floors[key];
  const bad = floor && ((floor.min !== undefined && value < floor.min) || (floor.max !== undefined && value > floor.max));
  if (bad) failed++;
  const bound = !floor ? "(no floor)" : floor.min !== undefined ? `>= ${floor.min}` : `<= ${floor.max}`;
  console.log(`${bad ? "FAIL" : "ok  "}  ${key.padEnd(28)} ${String(value).padStart(3)}${floor?.of ? `/${floor.of}` : ""}   ${bound}`);
}
for (const [name, value] of Object.entries(details)) {
  if (Array.isArray(value) && value.length > 0) console.log(`\n${name}: ${JSON.stringify(value)}`);
}

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/run.json", import.meta.url), JSON.stringify({ model: servedModel, metrics, details }, null, 1));
if (failed > 0) {
  console.error(`\n${failed} metric(s) below their floor.`);
  process.exit(1);
}
console.log("\nAll metrics within their floors.");
