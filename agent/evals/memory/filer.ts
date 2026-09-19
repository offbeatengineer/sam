// Live check of the PRODUCTION filer (src/memory/filer.ts with the production writer prompts),
// the part of recall-through-folders that no Jev eval covers. The fixture memories arrive one
// at a time, as they would over months; the filer runs whenever it says it is due. Then the
// production recaller is run through the trees it grew. Like writer.ts this is not floored:
// the filing model's output varies. What to look for: folder counts near the ones recorded in
// the README (facts ~38, notes ~21-25), few folders of one, and recall intact.
//
//   bun run eval:memory:filer      ~50 writer calls, about $0.03 of Jev
import { readFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { foldersOf, inboxOf, MemoryFiler } from "../../src/memory/filer.js";
import type { Track } from "../../src/memory/judgments.js";
import { MemoryRecaller } from "../../src/memory/recaller.js";
import type { ActiveMemory } from "../../src/memory/store.js";
import { TypeSafeClient } from "../../src/memory/typesafe.js";
import { createFactWriter } from "../../src/memory/writer.js";
import { RECALL, RECALL_CROSS_SUBJECT } from "./data.js";
import { scaleStore } from "./distractors.js";
import { pool } from "./llm.js";
import { evalConfig, f } from "./typesafe.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const cfg = evalConfig();
const tree = { ...cfg.tree, enabled: true, minFlatTokens: 0 };
const writer = createFactWriter(loadConfig());
const client = new TypeSafeClient(cfg);
const recaller = new MemoryRecaller(client, { ...cfg, maxRecalled: 50, tree });

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs], r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** The store as the filer sees it, in memory. Ids are the fixture ids, which `setFolders` of the real store would refuse. */
class ArrivalStore {
  rows: ActiveMemory[] = [];
  async listActive() { return this.rows; }
  async setFolders(assignments: { id: string; folder: string }[]) {
    for (const a of assignments) { const row = this.rows.find((r) => r.id === a.id); if (row) row.folder = a.folder; }
    return assignments.length;
  }
}

async function grow(track: Track, arrivals: ActiveMemory[]): Promise<ActiveMemory[]> {
  const store = new ArrivalStore();
  const filer = new MemoryFiler(async () => store, writer, tree);
  let calls = 0;
  for (const [i, m] of arrivals.entries()) {
    store.rows.push({ ...m, created_at: i, updated_at: i, folder: "" });
    while (filer.due(store.rows) && (await filer.step())) calls++;
  }
  const folders = [...foldersOf(store.rows, track).values()].map((x) => x.length);
  console.log(`\n${track}: ${arrivals.length} arrived, ${calls} writer calls -> ${folders.length} folders (largest ${Math.max(...folders)}, ${folders.filter((n) => n === 1).length} of one), ${inboxOf(store.rows, track).length} still unfiled`);
  console.log(`   ${[...foldersOf(store.rows, track).entries()].sort((a, b) => b[1].length - a[1].length).map(([name, x]) => `${name}(${x.length})`).join(" ")}`);
  return store.rows;
}

console.log(`writer: ${writer.name}; batches ${tree.factBatch} facts / ${tree.noteBatch} notes, caps ${tree.factCap} / ${tree.noteCap}`);
const now = Date.now();
const factArrivals = shuffled(Object.entries(scaleStore()).filter(([id]) => id !== "M13" && id !== "M14"), 1).map(([id, text]): ActiveMemory => ({ id, text, tags: [], source: "user", created_at: now, updated_at: now, kind: "situational" }));
const noteFixtures: { id: string; text: string; tags: string[] }[] = [...fixture("notes-data.json").notes, ...fixture("grow-data.json").bridges];
const noteArrivals = shuffled(noteFixtures, 2).map((n): ActiveMemory => ({ id: n.id, text: n.text, tags: n.tags, source: "auto", created_at: now, updated_at: now, kind: "knowledge" }));
const [facts, notes] = await Promise.all([grow("facts", factArrivals), grow("notes", noteArrivals)]);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
{
  const cases = [...RECALL, ...RECALL_CROSS_SUBJECT];
  const rows = await pool(cases, 4, async (c) => {
    const outcome = await recaller.recall([{ role: "user", text: c.msg }], facts);
    const picked = outcome.picked.map((m) => m.id);
    return { missed: c.core.filter((id) => !picked.includes(id)).map((id) => `${c.id} ${id}`), noise: picked.filter((id) => !c.core.includes(id) && !c.ok.includes(id)).length, tokens: outcome.tokens, opened: outcome.routing?.opened.length ?? 0 };
  });
  const total = cases.reduce((n, c) => n + c.core.length, 0);
  const missed = rows.flatMap((r) => r.missed);
  console.log(`\nfacts through the grown tree: core ${total - missed.length}/${total}, noise ${rows.reduce((n, r) => n + r.noise, 0)}, ${f(mean(rows.map((r) => r.opened)), 1)} folders opened, ${Math.round(mean(rows.map((r) => r.tokens)))} tokens/turn (flat: 13,961)${missed.length ? `\n   missed: ${missed.join(" | ")}` : ""}`);
}
{
  const fair = new Set<string>(fixture("grow-fair.json"));
  const queries: { id: string; msg: string; target: string }[] = [...fixture("notes-data.json").queries, ...fixture("grow-data.json").queries].filter((q) => fair.has(q.id)).filter((_, i) => i % 4 === 0);
  const rows = await pool(queries, 4, async (q) => {
    const outcome = await recaller.recall([{ role: "user", text: q.msg }], notes);
    return { id: q.id, hit: outcome.picked.some((m) => m.id === q.target), tokens: outcome.tokens, opened: outcome.routing?.opened.length ?? 0 };
  });
  const missed = rows.filter((r) => !r.hit).map((r) => r.id);
  console.log(`notes through the grown tree: target ${rows.length - missed.length}/${rows.length}, ${f(mean(rows.map((r) => r.opened)), 1)} folders opened, ${Math.round(mean(rows.map((r) => r.tokens)))} tokens/turn (flat: 33,173)${missed.length ? `\n   missed: ${missed.join(" ")}` : ""}`);
}
