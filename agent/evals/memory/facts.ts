// Experiment I: listing cards for USER FACTS. grow.ts found that a folder whose card is the
// listing of what is inside cannot hide a misfiled note, so the tree can be grown carelessly.
// Facts have no titles, but they are one sentence each: the listing is the facts themselves.
// Does that work as a subject card, replacing the LLM-written Holds/Matters-when of cards.ts,
// and does a fact tree grown one fact at a time recall as well as a grouped one?
//
//   store    the 248 memories and 25 cases of cards.ts (30 core memories).
//   listing  "<subject>/ holds N memories: fact | fact | ..." with one Noul per subject, on the
//            cards.ts grouping (33 subjects), against its LLM cards and flat recall.
//   grown    trees filed one fact at a time by a Jev Choice over the folder listings; a new
//            folder is named by Haiku; a folder past the cap is split by Haiku. Two arrival
//            orders, caps 8 and 16.
//   batched  the alternative: facts wait in an inbox and Haiku, seeing every folder, files 12 at
//            a time (cap 16).
//   domains  a level above, also a listing: "<domain>/ holds: subject (n), subject (n), ...".
//
//   bun run eval:memory:facts [--fresh] [--only=batched]      about $0.25 of Jev
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Turn } from "../../src/memory/judgments.js";
import { MemoryRecaller } from "../../src/memory/recaller.js";
import type { ActiveMemory } from "../../src/memory/store.js";
import { TypeSafeClient, type JevQuestion } from "../../src/memory/typesafe.js";
import { RECALL, RECALL_CROSS_SUBJECT, type RecallCase } from "./data.js";
import { scaleStore } from "./distractors.js";
import { llm, pool } from "./llm.js";
import { evalConfig, f, PRICE_PER_M_INPUT } from "./typesafe.js";

const CASES = [...RECALL, ...RECALL_CROSS_SUBJECT];
const PROFILE_IDS = new Set(["M13", "M14"]); // always-on in production, never judged per turn
const STORE = Object.fromEntries(Object.entries(scaleStore()).filter(([id]) => !PROFILE_IDS.has(id)));
const IDS = Object.keys(STORE);
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname; // generated inputs, committed so the recorded numbers can be reproduced
const TREES_FILE = `${FIXTURES_DIR}facts-trees.json`;
const NAME_MODEL = "claude-haiku-4-5";
const fresh = process.argv.includes("--fresh");
mkdirSync(RESULTS_DIR, { recursive: true });

const cfg = evalConfig();
const client = new TypeSafeClient(cfg);
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const slug = (s: unknown) => clean(s).toLowerCase().replace(/[^a-z0-9/-]+/g, "-").replace(/^-+|-+$/g, "") || "folder";

type Home = Record<string, string>; // memory id -> folder
const foldersOf = (home: Home) => {
  const out = new Map<string, string[]>();
  for (const id of IDS) out.set(home[id], [...(out.get(home[id]) ?? []), id]);
  return out;
};
const listing = (name: string, ids: string[]) => `${name}/ holds ${ids.length} ${ids.length === 1 ? "memory" : "memories"}: ${ids.map((id) => STORE[id]).join(" | ")}`;

// ---------------------------------------------------------------------------
// Growing a fact tree
// ---------------------------------------------------------------------------

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs], r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

async function nameFolder(id: string, existing: string[]): Promise<string> {
  const r = await llm(
    NAME_MODEL,
    `You name folders for a personal assistant's memory of facts about its user. A folder is a subject: a person, a pet, a project, a place, or an area of the user's life. Its name must be broad enough that later facts on the same subject would be filed there too, not a label for this one fact. Lowercase kebab-case, one to three words.`,
    `Name a new folder for this fact.\nFact: ${STORE[id]}\nExisting folders, which the new name must differ from: ${existing.join(", ") || "(none yet)"}`,
    { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
  );
  let name = slug(r.name).replace(/\//g, "-");
  while (existing.includes(name)) name = `${name}-2`;
  return name;
}

async function splitFolder(name: string, ids: string[], existing: string[]): Promise<{ name: string; ids: string[] }[] | undefined> {
  const r = await llm(
    NAME_MODEL,
    `You reorganize a personal assistant's memory of facts about its user. A folder has grown too large. Split its facts into two or three folders by subject, so that facts someone would look for together stay together. Name each folder with the subject it covers: lowercase kebab-case, one to three words. Assign every fact id exactly once.`,
    `Split this folder.\nFolder: ${name}\nFacts:\n${ids.map((id) => `${id}: ${STORE[id]}`).join("\n")}\nNames already taken by other folders: ${existing.filter((x) => x !== name).join(", ") || "(none)"}`,
    { type: "object", properties: { folders: { type: "array", items: { type: "object", properties: { name: { type: "string" }, ids: { type: "array", items: { type: "string" } } }, required: ["name", "ids"], additionalProperties: false } } }, required: ["folders"], additionalProperties: false },
  );
  const taken = new Set(existing.filter((x) => x !== name));
  const seen = new Set<string>();
  const groups: { name: string; ids: string[] }[] = [];
  for (const g of r.folders ?? []) {
    const inside = (g.ids as string[]).filter((id) => ids.includes(id) && !seen.has(id));
    inside.forEach((id) => seen.add(id));
    if (inside.length === 0) continue;
    let folder = slug(g.name).replace(/\//g, "-");
    while (taken.has(folder)) folder = `${folder}-2`;
    taken.add(folder);
    groups.push({ name: folder, ids: inside });
  }
  if (groups.length < 2) return undefined;
  groups[0].ids.push(...ids.filter((id) => !seen.has(id)));
  return groups;
}

interface Tree { key: string; home: Home; created: number; splits: string[]; filingTokens: number }
async function grow(seed: number, cap: number): Promise<Tree> {
  const members = new Map<string, string[]>();
  const tree: Tree = { key: `shuffle-${seed}/cap${cap}`, home: {}, created: 0, splits: [], filingTokens: 0 };
  const unsplittable = new Map<string, number>();
  for (const id of shuffled(IDS, seed)) {
    const names = [...members.keys()];
    let home: string | undefined;
    if (names.length > 0) {
      const folders = Object.fromEntries(names.map((name, i) => [`f${i}`, listing(name, members.get(name)!)]));
      const questions: Record<string, JevQuestion> = {
        file: {
          type: "choice",
          instructions: "Which entry in `folders` is the right place to file `fact`, so that someone looking for it would look there?",
          criteria: { ...Object.fromEntries(names.map((_, i) => [`f${i}`, null])), none: "No folder is about this fact's subject; it needs a new folder" },
        },
      };
      const r = await retrying(() => client.ask({ fact: STORE[id], folders }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 }));
      tree.filingTokens += r.usage.input_tokens;
      const choice = r.answers.file?.choice ?? "none";
      home = choice === "none" ? undefined : names[Number(choice.slice(1))];
    }
    if (home === undefined) { home = await nameFolder(id, names); members.set(home, []); tree.created++; }
    members.get(home)!.push(id);
    tree.home[id] = home;
    const inside = members.get(home)!;
    if (inside.length > cap && inside.length >= (unsplittable.get(home) ?? 0) + 3) {
      const groups = await splitFolder(home, inside, [...members.keys()]);
      if (!groups) unsplittable.set(home, inside.length);
      else {
        members.delete(home);
        for (const g of groups) { members.set(g.name, g.ids); for (const x of g.ids) tree.home[x] = g.name; }
        tree.splits.push(`${home}(${inside.length}) -> ${groups.map((g) => `${g.name}(${g.ids.length})`).join(" + ")}`);
      }
    }
  }
  return tree;
}

/**
 * The alternative to filing each fact as it arrives: new facts wait in an inbox (which recall
 * always reads), and a model that sees every folder files a batch of them at once. It can put
 * two new facts on one new subject together, which one-at-a-time filing never can.
 */
const BATCH = 12;
const BATCH_CAP = 16;
const shortListing = (name: string, ids: string[]) => `${name}/ (${ids.length}): ${ids.slice(0, 6).map((id) => STORE[id]).join(" | ")}${ids.length > 6 ? ` | ... and ${ids.length - 6} more` : ""}`;
async function growBatched(seed: number): Promise<Tree> {
  const members = new Map<string, string[]>();
  const tree: Tree = { key: `batched-${seed}/cap${BATCH_CAP}`, home: {}, created: 0, splits: [], filingTokens: 0 };
  const order = shuffled(IDS, seed);
  for (let i = 0; i < order.length; i += BATCH) {
    const batch = order.slice(i, i + BATCH);
    const r = await llm(
      NAME_MODEL,
      `You file new facts about a user into the folders of a personal assistant's memory. A folder is a subject: a person, a pet, a project, a place, or an area of the user's life such as food, health, work or travel. For each new fact give the folder it belongs in: the name of an existing folder when one covers its subject, otherwise a new name. Prefer an existing folder. Prefer a broad subject over a narrow one: a folder should be able to take later facts on the same subject. New facts on the same subject go to the same folder. Names are lowercase kebab-case, one to three words. Assign every fact id exactly once.`,
      `File these facts.\nExisting folders:\n${[...members.entries()].map(([name, ids]) => shortListing(name, ids)).join("\n") || "(none yet)"}\n\nNew facts:\n${batch.map((id) => `${id}: ${STORE[id]}`).join("\n")}`,
      { type: "object", properties: { assignments: { type: "array", items: { type: "object", properties: { id: { type: "string" }, folder: { type: "string" } }, required: ["id", "folder"], additionalProperties: false } } }, required: ["assignments"], additionalProperties: false },
    );
    const placed = new Set<string>();
    for (const a of r.assignments ?? []) {
      if (!batch.includes(a.id) || placed.has(a.id)) continue;
      const name = slug(a.folder).replace(/\//g, "-");
      if (!members.has(name)) { members.set(name, []); tree.created++; }
      members.get(name)!.push(a.id);
      tree.home[a.id] = name;
      placed.add(a.id);
    }
    for (const id of batch.filter((x) => !placed.has(x))) { if (!members.has("unsorted")) members.set("unsorted", []); members.get("unsorted")!.push(id); tree.home[id] = "unsorted"; }
    for (const [name, inside] of [...members.entries()]) {
      if (inside.length <= BATCH_CAP) continue;
      const groups = await splitFolder(name, inside, [...members.keys()]);
      if (!groups) continue;
      members.delete(name);
      for (const g of groups) { members.set(g.name, g.ids); for (const x of g.ids) tree.home[x] = g.name; }
      tree.splits.push(`${name}(${inside.length}) -> ${groups.map((g) => `${g.name}(${g.ids.length})`).join(" + ")}`);
    }
  }
  return tree;
}

const trees: Record<string, Tree> = existsSync(TREES_FILE) && !fresh ? JSON.parse(readFileSync(TREES_FILE, "utf8")) : {};
const WANTED = [{ seed: 1, cap: 8 }, { seed: 2, cap: 8 }, { seed: 1, cap: 16 }, { seed: 2, cap: 16 }];
const missing = WANTED.filter((w) => !trees[`shuffle-${w.seed}/cap${w.cap}`]);
if (missing.length) {
  console.log(`growing ${missing.length} fact trees, ${IDS.length} facts each ...`);
  await pool(missing, 4, async (w) => {
    const t = await grow(w.seed, w.cap);
    trees[t.key] = t;
    writeFileSync(TREES_FILE, JSON.stringify(trees, null, 2));
    console.log(`  ${t.key}: ${new Set(Object.values(t.home)).size} folders, ${t.splits.length} splits, ${Math.round(t.filingTokens / IDS.length)} tokens per filing`);
  });
}

const BATCHED = [1, 2];
const missingBatched = BATCHED.filter((seed) => !trees[`batched-${seed}/cap${BATCH_CAP}`]);
if (missingBatched.length) {
  console.log(`growing ${missingBatched.length} batch-filed trees (${BATCH} facts per batch, filed by ${NAME_MODEL}) ...`);
  await pool(missingBatched, 2, async (seed) => {
    const t = await growBatched(seed);
    trees[t.key] = t;
    writeFileSync(TREES_FILE, JSON.stringify(trees, null, 2));
    console.log(`  ${t.key}: ${new Set(Object.values(t.home)).size} folders, ${t.splits.length} splits`);
  });
}

// ---------------------------------------------------------------------------
// Recall through a tree of listings
// ---------------------------------------------------------------------------

const now = Date.now();
const memory = (id: string): ActiveMemory => ({ id, text: STORE[id], tags: [], source: "user", created_at: now, updated_at: now, kind: "situational" });
const recaller = new MemoryRecaller(client, { ...cfg, maxRecalled: 50 });
interface Judged { picked: string[]; tokens: number; ms: number }
async function judge(msg: string, ids: string[]): Promise<Judged> {
  if (ids.length === 0) return { picked: [], tokens: 0, ms: 0 };
  return retrying(async () => {
    const outcome = await recaller.recall([{ role: "user", text: msg }], ids.map(memory));
    if (outcome.status !== "ok") throw new Error(`recall ${outcome.status}: ${outcome.reason}`);
    return { picked: outcome.picked.map((m) => m.id), tokens: outcome.tokens, ms: outcome.ms };
  });
}

interface Routed { p: Record<string, number>; tokens: number; ms: number }
async function routeCards(msg: string, cards: { id: string; text: string }[], question: (alias: string) => string): Promise<Routed> {
  if (cards.length === 0) return { p: {}, tokens: 0, ms: 0 };
  const conversation: Turn[] = [{ role: "user", text: msg }];
  const state: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  cards.forEach((c, i) => { state[`s${i}`] = c.text; questions[`open::s${i}`] = { type: "noul", instructions: question(`s${i}`) }; });
  const r = await retrying(() => client.ask({ conversation, subjects: state }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 }));
  return { p: Object.fromEntries(cards.map((c, i) => [c.id, r.answers[`open::s${i}`]?.noul ?? 0])), tokens: r.usage.input_tokens, ms: r.ms };
}
const SUBJECT_Q = (a: string) => `Would a memory listed in \`subjects.${a}\` change or improve the assistant's next response in \`conversation\`?`;
const DOMAIN_Q = (a: string) => `Would a memory filed under \`subjects.${a}\` change or improve the assistant's next response in \`conversation\`?`;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
const totalCore = CASES.reduce((n, c) => n + c.core.length, 0);
const dump: Record<string, unknown> = {};

interface Row { c: RecallCase; hop1: Routed; e2e: Record<string, Judged & { read: number; opened: number }> }
const THRESHOLDS = [0.5, 0.3, 0.15];

function header() {
  console.log(`   ${"tree".padEnd(30)}${"folders".padEnd(9)}${"hop-1 tokens".padEnd(14)}${THRESHOLDS.map((t) => `@${t}: core  noise  read  tokens`.padEnd(34)).join("")}`);
}
async function through(name: string, home: Home) {
  const folders = foldersOf(home);
  const cards = [...folders.entries()].map(([id, ids]) => ({ id, text: listing(id, ids) }));
  const rows = await pool(CASES, 5, async (c): Promise<Row> => {
    const hop1 = await routeCards(c.msg, cards, SUBJECT_Q);
    const e2e: Row["e2e"] = {};
    for (const t of THRESHOLDS) {
      const open = cards.filter((k) => (hop1.p[k.id] ?? 0) >= t).map((k) => k.id);
      const ids = IDS.filter((id) => open.includes(home[id]));
      const j = await judge(c.msg, ids);
      e2e[t] = { ...j, tokens: hop1.tokens + j.tokens, ms: hop1.ms + j.ms, read: ids.length, opened: open.length };
    }
    return { c, hop1, e2e };
  });
  const cells = THRESHOLDS.map((t) => {
    const missed = rows.flatMap((r) => r.c.core.filter((id) => !r.e2e[t].picked.includes(id)).map((id) => `${r.c.id} ${id}`));
    const noise = rows.reduce((n, r) => n + r.e2e[t].picked.filter((id) => !r.c.core.includes(id) && !r.c.ok.includes(id)).length, 0);
    return { text: `${`${totalCore - missed.length}/${totalCore}`.padEnd(8)}${String(noise).padEnd(7)}${f(mean(rows.map((r) => r.e2e[t].read)), 0).padEnd(6)}${String(Math.round(mean(rows.map((r) => r.e2e[t].tokens))))}`.padEnd(34), missed };
  });
  console.log(`   ${name.padEnd(30)}${String(folders.size).padEnd(9)}${String(Math.round(mean(rows.map((r) => r.hop1.tokens)))).padEnd(14)}${cells.map((x) => x.text).join("")}`);
  cells.forEach((x, i) => { if (x.missed.length) console.log(`      missed @${THRESHOLDS[i]}: ${x.missed.map((m) => `${m}->${home[m.split(" ")[1]]}`).join(" | ")}`); });
  const noneOpened = mean(rows.filter((r) => r.c.kind === "none").map((r) => r.e2e[0.15].opened));
  if (noneOpened > 0) console.log(`      "nothing relevant" cases open ${f(noneOpened, 1)} folders at 0.15`);
  dump[name] = rows.map((r) => ({ id: r.c.id, p: Object.fromEntries(Object.entries(r.hop1.p).filter(([, p]) => p >= 0.1)), e2e: r.e2e }));
  return rows;
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const grouped: Home = JSON.parse(readFileSync(`${FIXTURES_DIR}cards-index.json`, "utf8")).assignments;
console.log(`\n== recall through listing cards: one Noul per folder over its facts verbatim, then the production recall on the facts inside`);
console.log(`   ${IDS.length} memories, ${CASES.length} cases, ${totalCore} core memories. cards.ts on the same store: flat 30/30, noise 11-12, 13,961 tokens; LLM cards v2 @0.5 30/30, noise 2, 4,442 tokens`);
header();
if (!only) await through("grouped in one pass (33)", grouped);
for (const w of WANTED) {
  const t = trees[`shuffle-${w.seed}/cap${w.cap}`];
  if (!only) await through(`grown ${t.key}`, t.home);
}
for (const seed of BATCHED) {
  const t = trees[`batched-${seed}/cap${BATCH_CAP}`];
  await through(t.key, t.home);
  const sizes = [...foldersOf(t.home).entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`      ${sizes.length} folders (${sizes.filter(([, x]) => x.length === 1).length} singletons): ${sizes.map(([name, x]) => `${name}(${x.length})`).join(" ").slice(0, 600)}`);
}
if (only === "batched") process.exit(0);
for (const w of WANTED) {
  const t = trees[`shuffle-${w.seed}/cap${w.cap}`];
  const sizes = [...foldersOf(t.home).values()].map((x) => x.length);
  console.log(`\n   grown ${t.key}: ${sizes.length} folders (largest ${Math.max(...sizes)}, ${sizes.filter((s) => s === 1).length} singletons), ${t.splits.length} splits, ${Math.round(t.filingTokens / IDS.length)} Jev tokens per filing`);
  for (const [name, ids] of [...foldersOf(t.home).entries()].filter(([, ids]) => ids.some((id) => id.startsWith("M"))).slice(0, 6)) console.log(`      ${listing(name, ids).slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// A level above: domain listings of subject names
// ---------------------------------------------------------------------------

console.log(`\n== a level above, on the one-pass grouping: domain cards that list subject names, open at 0.15, then subject listings at 0.15, then the facts`);
{
  const folders = foldersOf(grouped);
  const domains = new Map<string, string[]>();
  for (const name of folders.keys()) domains.set(name.split("/")[0], [...(domains.get(name.split("/")[0]) ?? []), name]);
  const domainCards = [...domains.entries()].map(([id, subs]) => ({ id, text: `${id}/ holds ${subs.length} subjects: ${subs.map((s) => `${s.split("/")[1]} (${folders.get(s)!.length})`).join(", ")}` }));
  console.log(`   sample: ${domainCards[0].text}`);
  const rows = await pool(CASES, 5, async (c) => {
    const hop0 = await routeCards(c.msg, domainCards, DOMAIN_Q);
    const openDomains = domainCards.filter((d) => (hop0.p[d.id] ?? 0) >= 0.15).map((d) => d.id);
    const cards = [...folders.entries()].filter(([name]) => openDomains.includes(name.split("/")[0])).map(([id, ids]) => ({ id, text: listing(id, ids) }));
    const hop1 = await routeCards(c.msg, cards, SUBJECT_Q);
    const open = cards.filter((k) => (hop1.p[k.id] ?? 0) >= 0.15).map((k) => k.id);
    const j = await judge(c.msg, IDS.filter((id) => open.includes(grouped[id])));
    return { c, domainMiss: c.core.filter((id) => !openDomains.includes(grouped[id].split("/")[0])), picked: j.picked, tokens: hop0.tokens + hop1.tokens + j.tokens, ms: hop0.ms + hop1.ms + j.ms, openDomains: openDomains.length };
  });
  const missed = rows.flatMap((r) => r.c.core.filter((id) => !r.picked.includes(id)).map((id) => `${r.c.id} ${id}${r.domainMiss.includes(id) ? " (domain not opened)" : ""}`));
  console.log(`   core ${totalCore - missed.length}/${totalCore}   domains opened ${f(mean(rows.map((r) => r.openDomains)), 1)} of ${domainCards.length}   ${Math.round(mean(rows.map((r) => r.tokens)))} tokens   median ${Math.round(median(rows.map((r) => r.ms)))} ms${missed.length ? `\n      missed: ${missed.join(" | ")}` : ""}`);
  dump.domains = rows.map((r) => ({ id: r.c.id, picked: r.picked, tokens: r.tokens, openDomains: r.openDomains }));
}

writeFileSync(`${RESULTS_DIR}facts.json`, JSON.stringify(dump));
console.log(`\nraw results: ${RESULTS_DIR}facts.json   $${(PRICE_PER_M_INPUT).toFixed(3)}/M input tokens`);
