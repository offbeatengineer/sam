// Experiment F: progressive disclosure. Instead of judging every memory each turn, can Jev
// route a message to the right SUBJECT from an index card alone, then judge only the
// memories filed there? The risk is a routing miss: a subject that is not opened takes its
// memories with it, silently. So this measures how often the subject of a core memory is
// picked, against the flat production recall on the same cases and the same 248-memory store.
//
//   index    domain/subject paths (Sonnet) and one card per subject and per domain (Haiku,
//            the production writer model). Both see only the memory texts, never the cases,
//            so the cards are not written toward the questions. Kept in fixtures/.
//   hop 1    one Noul per card. Ablations: full card / holds only / path only, two wordings.
//   flat     production MemoryRecaller over the whole store (the baseline).
//   two-hop  subject cards -> memories in the picked subjects, judged by the production recaller.
//   three-hop domain cards -> subject cards in the picked domains -> memories.
//
//   bun run eval:memory:cards [--fresh] [--cards=v2] [--coverage]
//     --fresh     rebuild the index (~45 LLM calls); otherwise fixtures/cards-index*.json is reused
//     --cards=v2  same grouping, cards rewritten under a revised rule (see CARDS_VERSION)
//     --coverage  only the write-time check: does each card cover the memories filed under it?
//   A full pass costs about $0.10 of Jev.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { truncate, type Turn } from "../../src/memory/judgments.js";
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

// --cards=v2 rewrites the cards under a revised rule, on the SAME grouping, to see whether a
// routing miss can be repaired by what the card says. v2 was written after seeing v1's miss.
const CARDS_VERSION = process.argv.find((a) => a.startsWith("--cards="))?.slice(8) ?? "v1";
const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname; // generated inputs, committed so the recorded numbers can be reproduced
const V1_INDEX_FILE = `${FIXTURES_DIR}cards-index.json`;
const INDEX_FILE = CARDS_VERSION === "v1" ? V1_INDEX_FILE : `${FIXTURES_DIR}cards-index-${CARDS_VERSION}.json`;
const GROUPING_MODEL = "claude-sonnet-5";
const CARD_MODEL = "claude-haiku-4-5";
const HOLDS_CHARS = 160;
const MATTERS_CHARS = 200;

// ---------------------------------------------------------------------------
// The index: paths and cards, written without sight of the cases
// ---------------------------------------------------------------------------

interface Card { path: string; holds: string; matters_when: string }
interface Index { assignments: Record<string, string>; subjects: Card[]; domains: Card[]; models: { grouping: string; cards: string } }
type PartialIndex = Partial<Index>;

const GROUPING_PROMPT = `You organize a personal assistant's long-term memory about one user into a two-level index of paths: domain/subject.
- A subject is one topic, person, pet, project, or collection (a reading log, for example). Notes about the same thing go in the same subject. Prefer meaningful subjects over one subject per note; a subject usually holds between 2 and 30 notes.
- A domain groups related subjects. Use at most 12 domains.
- Paths are lowercase kebab-case, exactly two segments, like home/garden.
- Assign every note id exactly once.`;

const CARD_PROMPT = `You write index cards for a personal assistant's long-term memory. Notes about the user are filed under subjects. Before each reply a judge reads ONLY the cards, never the notes, and decides which subjects to open for the user's latest message. A subject that is not opened is invisible to the assistant, so the card must let the judge recognize every situation in which the notes inside would change the answer.

Write two fields, in English:
- holds: what is filed here, at most ${HOLDS_CHARS} characters. With few notes, name the specifics. With many, generalize and name the kinds of facts.${CARDS_VERSION === "v2" ? " Do not let the bulk crowd out the exceptions: lead with anything upcoming, time-bound, or constraining (a plan, a deadline, a restriction), then summarize the rest by kind." : ""}
- matters_when: tasks, requests, or situations in which these notes would change the assistant's answer, including indirect ones where the user would not mention the subject by name. At most ${MATTERS_CHARS} characters, comma-separated phrases.

Example, for a subject home/garden with notes about a balcony herb garden, tomato seedlings planted in May, and an aphid problem:
holds: Balcony herb garden; tomato seedlings planted in May; ongoing aphid problem.
matters_when: plant care, watering while traveling, recipes with fresh herbs, pest control purchases, balcony furniture, gifts for a gardener`;

const CARD_SCHEMA = {
  type: "object",
  properties: { holds: { type: "string" }, matters_when: { type: "string" } },
  required: ["holds", "matters_when"],
  additionalProperties: false,
};

const capCard = (path: string, raw: any): Card => ({
  path,
  holds: truncate(String(raw?.holds ?? "").replace(/\s+/g, " ").trim(), HOLDS_CHARS),
  matters_when: truncate(String(raw?.matters_when ?? "").replace(/\s+/g, " ").trim(), MATTERS_CHARS),
});

async function group(): Promise<Record<string, string>> {
  console.log(`building the index: grouping ${IDS.length} memories with ${GROUPING_MODEL} ...`);
  const listing = IDS.map((id) => `${id}: ${STORE[id]}`).join("\n");
  const grouped = await llm(GROUPING_MODEL, GROUPING_PROMPT, `Notes:\n${listing}`, {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" }, path: { type: "string" } }, required: ["id", "path"], additionalProperties: false },
      },
    },
    required: ["assignments"],
    additionalProperties: false,
  });
  const assignments: Record<string, string> = {};
  for (const a of grouped.assignments ?? []) {
    const path = String(a.path).toLowerCase().trim();
    if (STORE[a.id] && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(path) && !assignments[a.id]) assignments[a.id] = path;
  }
  const unfiled = IDS.filter((id) => !assignments[id]);
  if (unfiled.length) console.log(`  ${unfiled.length} memories came back unfiled or malformed; filing them under misc/unsorted: ${unfiled.join(" ")}`);
  for (const id of unfiled) assignments[id] = "misc/unsorted";
  return assignments;
}

async function subjectCards(assignments: Record<string, string>): Promise<Card[]> {
  const bySubject = new Map<string, string[]>();
  for (const id of IDS) bySubject.set(assignments[id], [...(bySubject.get(assignments[id]) ?? []), id]);
  console.log(`  ${bySubject.size} subjects; writing their cards with ${CARD_MODEL} ...`);
  return pool([...bySubject.entries()], 5, async ([path, ids]) =>
    capCard(path, await llm(CARD_MODEL, CARD_PROMPT, `Write the card for this subject.\nSubject: ${path}\nNotes filed here (${ids.length}):\n${ids.map((id) => `- ${STORE[id]}`).join("\n")}`, CARD_SCHEMA)),
  );
}

async function domainCards(subjects: Card[]): Promise<Card[]> {
  const byDomain = new Map<string, Card[]>();
  for (const s of subjects) byDomain.set(s.path.split("/")[0], [...(byDomain.get(s.path.split("/")[0]) ?? []), s]);
  console.log(`  ${byDomain.size} domains; writing their cards from the subject cards ...`);
  return pool([...byDomain.entries()], 5, async ([domain, cards]) =>
    capCard(
      domain,
      await llm(
        CARD_MODEL,
        CARD_PROMPT,
        `Write the card for this domain. A domain is a group of subjects; the judge opens it to see the subjects inside.\nDomain: ${domain}\nSubjects filed here (${cards.length}):\n${cards.map((c) => `- ${c.path}: ${c.holds} (matters when: ${c.matters_when})`).join("\n")}`,
        CARD_SCHEMA,
      ),
    ),
  );
}

/** Saved after every stage, so a stage that fails does not cost the ones before it. */
async function buildIndex(): Promise<Index> {
  const partial: PartialIndex = existsSync(INDEX_FILE) && !process.argv.includes("--fresh") ? JSON.parse(readFileSync(INDEX_FILE, "utf8")) : {};
  // Card versions are compared on one grouping, so later versions take v1's paths.
  if (CARDS_VERSION !== "v1" && !partial.assignments && existsSync(V1_INDEX_FILE)) partial.assignments = JSON.parse(readFileSync(V1_INDEX_FILE, "utf8")).assignments;
  if (partial.domains) console.log(`index: reusing ${INDEX_FILE} (pass --fresh to rebuild)`);
  const save = () => writeFileSync(INDEX_FILE, JSON.stringify(partial, null, 2));
  partial.models = { grouping: GROUPING_MODEL, cards: CARD_MODEL };
  if (!partial.assignments) { partial.assignments = await group(); save(); }
  if (!partial.subjects) { partial.subjects = await subjectCards(partial.assignments); save(); }
  if (!partial.domains) { partial.domains = await domainCards(partial.subjects); save(); }
  return partial as Index;
}

mkdirSync(RESULTS_DIR, { recursive: true });
mkdirSync(FIXTURES_DIR, { recursive: true });
const index = await buildIndex();

const subjectOf = (id: string) => index.assignments[id];
const domainOf = (id: string) => subjectOf(id).split("/")[0];
const sizes = new Map<string, number>();
for (const id of IDS) sizes.set(subjectOf(id), (sizes.get(subjectOf(id)) ?? 0) + 1);

console.log(`\nindex: ${IDS.length} memories -> ${index.subjects.length} subjects -> ${index.domains.length} domains`);
for (const d of index.domains) {
  console.log(`\n${d.path}/\n    holds: ${d.holds}\n    when:  ${d.matters_when}`);
  for (const s of index.subjects.filter((s) => s.path.startsWith(`${d.path}/`))) {
    console.log(`  ${s.path} (${sizes.get(s.path)})\n    holds: ${s.holds}\n    when:  ${s.matters_when}`);
  }
}
const coreIds = [...new Set(CASES.flatMap((c) => c.core))];
console.log(`\ncore memories sit in ${new Set(coreIds.map(subjectOf)).size} subjects: ${coreIds.map((id) => `${id}=${subjectOf(id)}`).join("  ")}`);

// ---------------------------------------------------------------------------
// Hop 1: one Noul per card
// ---------------------------------------------------------------------------

const cfg = evalConfig();
const client = new TypeSafeClient(cfg);

type Variant = "full" | "holds" | "path";
type Wording = "would" | "likely";
const cardText = (c: Card, v: Variant) =>
  v === "path" ? c.path : v === "holds" ? `${c.path}. Holds: ${c.holds}` : `${c.path}. Holds: ${c.holds} Matters when: ${c.matters_when}`;
const WORDINGS: Record<Wording, (alias: string) => string> = {
  // "would": the production recall question, pointed at a subject instead of a memory.
  would: (a) => `Would the notes filed under \`subjects.${a}\` change or improve the assistant's next response in \`conversation\`?`,
  // "likely": says out loud that the judge sees a card, not the notes.
  likely: (a) => `Is \`subjects.${a}\` likely to hold a note that would change or improve the assistant's next response in \`conversation\`?`,
};

interface Routed { p: Map<string, number>; tokens: number; ms: number }
async function route(msg: string, cards: Card[], variant: Variant, wording: Wording): Promise<Routed> {
  const conversation: Turn[] = [{ role: "user", text: msg }];
  const subjects: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  cards.forEach((c, i) => {
    subjects[`s${i}`] = cardText(c, variant);
    questions[`open::s${i}`] = { type: "noul", instructions: WORDINGS[wording](`s${i}`) };
  });
  const r = await client.ask({ conversation, subjects }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 });
  return { p: new Map(cards.map((c, i) => [c.path, r.answers[`open::s${i}`]?.noul ?? 0])), tokens: r.usage.input_tokens, ms: r.ms };
}

// ---------------------------------------------------------------------------
// --coverage: can a bad card be caught when it is written, instead of missing silently later?
// One request per subject: for each memory filed there, does the card cover it?
// ---------------------------------------------------------------------------

if (process.argv.includes("--coverage")) {
  const COVER_WORDINGS: Record<string, (a: string) => string> = {
    covers: (a) => `Does \`card\` name the fact in \`notes.${a}\`, or clearly cover it by kind?`,
    expects: (a) => `Would someone who reads only \`card\` expect the subject to hold the fact in \`notes.${a}\`?`,
  };
  const rows: { id: string; path: string; size: number; covers: number; expects: number }[] = [];
  await pool(index.subjects, 6, async (card) => {
    const ids = IDS.filter((id) => subjectOf(id) === card.path);
    const notes = Object.fromEntries(ids.map((id, i) => [`n${i}`, STORE[id]]));
    const questions: Record<string, JevQuestion> = {};
    for (const [name, wording] of Object.entries(COVER_WORDINGS)) ids.forEach((_, i) => (questions[`${name}::n${i}`] = { type: "noul", instructions: wording(`n${i}`) }));
    const r = await client.ask({ card: cardText(card, "full"), notes }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 });
    ids.forEach((id, i) => rows.push({ id, path: card.path, size: ids.length, covers: r.answers[`covers::n${i}`]?.noul ?? 0, expects: r.answers[`expects::n${i}`]?.noul ?? 0 }));
  });
  const core = new Set(coreIds);
  for (const name of ["covers", "expects"] as const) {
    const sorted = [...rows].sort((a, b) => a[name] - b[name]);
    const below = sorted.filter((r) => r[name] < 0.5);
    console.log(`\n== coverage (${name}), cards ${CARDS_VERSION}: ${below.length}/${rows.length} memories below 0.5; the 12 lowest:`);
    for (const r of sorted.slice(0, 12)) console.log(`   ${f(r[name])}  ${r.id}${core.has(r.id) ? "*" : " "} ${r.path} (${r.size})  ${truncate(STORE[r.id], 70)}`);
    console.log(`   core memories (*): ${coreIds.map((id) => `${id} ${f(rows.find((r) => r.id === id)![name])}`).join("  ")}`);
  }
  writeFileSync(`${RESULTS_DIR}cards-coverage-${CARDS_VERSION}.json`, JSON.stringify(rows, null, 2));
  process.exit(0);
}

const THRESHOLDS = [0.5, 0.3, 0.15];
const VARIANTS: Variant[] = ["full", "holds", "path"];
const WORDING_KEYS: Wording[] = ["would", "likely"];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const totalCore = CASES.reduce((n, c) => n + c.core.length, 0);
const noneCases = CASES.filter((c) => c.kind === "none");
const dump: Record<string, unknown> = { index };

/** routed[level][variant/wording][caseId] */
const routed: Record<string, Record<string, Record<string, Routed>>> = { subject: {}, domain: {} };

for (const [level, cards, keyOf] of [
  ["subject", index.subjects, subjectOf],
  ["domain", index.domains, domainOf],
] as const) {
  console.log(`\n== hop 1 over ${cards.length} ${level} cards: is the ${level} of each core memory picked? (${totalCore} core memories, ${CASES.length} cases)`);
  console.log(`   ${"cards".padEnd(14)} ${THRESHOLDS.map((t) => `core@${t}`.padEnd(10)).join("")}${THRESHOLDS.map((t) => `open@${t}`.padEnd(10)).join("")}${"none@0.3".padEnd(10)}min core p   tokens  ms`);
  for (const wording of WORDING_KEYS) {
    for (const variant of VARIANTS) {
      const key = `${variant}/${wording}`;
      const rows = await pool(CASES, 5, async (c) => [c.id, await route(c.msg, cards, variant, wording)] as const);
      routed[level][key] = Object.fromEntries(rows);
      const coreP = CASES.flatMap((c) => c.core.map((id) => ({ c: c.id, id, p: routed[level][key][c.id].p.get(keyOf(id)) ?? 0 })));
      const opened = (t: number, cs: RecallCase[]) => mean(cs.map((c) => [...routed[level][key][c.id].p.values()].filter((p) => p >= t).length));
      const worst = coreP.reduce((a, b) => (b.p < a.p ? b : a));
      console.log(
        `   ${key.padEnd(14)} ${THRESHOLDS.map((t) => `${coreP.filter((x) => x.p >= t).length}/${totalCore}`.padEnd(10)).join("")}${THRESHOLDS.map((t) => f(opened(t, CASES), 1).padEnd(10)).join("")}${f(opened(0.3, noneCases), 1).padEnd(10)}${`${f(worst.p)} (${worst.c} ${worst.id})`.padEnd(13)}${String(Math.round(mean(rows.map(([, r]) => r.tokens)))).padEnd(8)}${Math.round(median(rows.map(([, r]) => r.ms)))}`,
      );
      const misses = coreP.filter((x) => x.p < 0.5).sort((a, b) => a.p - b.p);
      if (misses.length) console.log(`      below 0.5: ${misses.map((x) => `${x.c} ${x.id}->${keyOf(x.id)} ${f(x.p)}`).join(" | ")}`);
      dump[`hop1.${level}.${key}`] = { coreP, opened: CASES.map((c) => ({ c: c.id, opened: [...routed[level][key][c.id].p.entries()].filter(([, p]) => p >= 0.15).map(([path, p]) => `${path} ${f(p)}`) })) };
    }
  }
}

// ---------------------------------------------------------------------------
// End to end, against the flat production recall
// ---------------------------------------------------------------------------

const now = Date.now();
const memory = (id: string): ActiveMemory => ({ id, text: STORE[id], tags: [], source: "user", created_at: now, updated_at: now, kind: "situational" });
const recaller = new MemoryRecaller(client, { ...cfg, maxRecalled: 50 });

interface E2E { id: string; missed: string[]; noise: string[]; tokens: number; ms: number; judged: number }
async function judge(c: RecallCase, ids: string[], before: { tokens: number; ms: number }): Promise<E2E> {
  const allowed = new Set([...c.core, ...c.ok]);
  if (ids.length === 0) return { id: c.id, missed: c.core, noise: [], judged: 0, tokens: before.tokens, ms: before.ms };
  const outcome = await recaller.recall([{ role: "user", text: c.msg }], ids.map(memory));
  if (outcome.status !== "ok") throw new Error(`recall ${c.id} ${outcome.status}: ${outcome.reason}`);
  const picked = outcome.picked.map((m) => m.id);
  return {
    id: c.id,
    missed: c.core.filter((id) => !picked.includes(id)),
    noise: picked.filter((id) => !allowed.has(id)),
    tokens: before.tokens + outcome.tokens,
    ms: before.ms + outcome.ms,
    judged: ids.length,
  };
}

function report(name: string, rows: E2E[]) {
  const missed = rows.flatMap((r) => r.missed.map((id) => `${r.id} ${id}`));
  const tokens = mean(rows.map((r) => r.tokens));
  console.log(
    `   ${name.padEnd(34)} core ${totalCore - missed.length}/${totalCore}  noise ${String(rows.reduce((n, r) => n + r.noise.length, 0)).padEnd(3)} judged ${f(mean(rows.map((r) => r.judged)), 0).padStart(3)} memories  ${String(Math.round(tokens)).padStart(6)} tokens  $${((tokens / 1e6) * PRICE_PER_M_INPUT).toFixed(5)}/turn  median ${Math.round(median(rows.map((r) => r.ms)))} ms`,
  );
  if (missed.length) console.log(`      missed: ${missed.join(" | ")}`);
  dump[`e2e.${name}`] = rows;
}

console.log(`\n== end to end on the ${IDS.length}-memory store (item threshold ${cfg.recallThreshold}; latency adds the hops, which run in sequence)`);
const flat = await pool(CASES, 4, (c) => judge(c, IDS, { tokens: 0, ms: 0 }));
report("flat (production)", flat);
const flatMissed = new Set(flat.flatMap((r) => r.missed.map((id) => `${r.id} ${id}`)));
if (flatMissed.size) console.log(`      (a core memory the flat recall misses is not a routing loss)`);

for (const wording of WORDING_KEYS) {
  for (const t of [0.5, 0.3]) {
    const hop1 = routed.subject[`full/${wording}`];
    const rows = await pool(CASES, 5, (c) => {
      const open = new Set([...hop1[c.id].p.entries()].filter(([, p]) => p >= t).map(([path]) => path));
      return judge(c, IDS.filter((id) => open.has(subjectOf(id))), hop1[c.id]);
    });
    report(`two-hop  subject@${t} ${wording}`, rows);
  }
}

for (const wording of WORDING_KEYS) {
  const t = 0.3;
  const hop1 = routed.domain[`full/${wording}`];
  const rows = await pool(CASES, 5, async (c) => {
    const openDomains = new Set([...hop1[c.id].p.entries()].filter(([, p]) => p >= t).map(([path]) => path));
    const candidates = index.subjects.filter((s) => openDomains.has(s.path.split("/")[0]));
    if (candidates.length === 0) return judge(c, [], hop1[c.id]);
    const hop2 = await route(c.msg, candidates, "full", wording);
    const open = new Set([...hop2.p.entries()].filter(([, p]) => p >= t).map(([path]) => path));
    return judge(c, IDS.filter((id) => open.has(subjectOf(id))), { tokens: hop1[c.id].tokens + hop2.tokens, ms: hop1[c.id].ms + hop2.ms });
  });
  report(`three-hop domain@${t} subject@${t} ${wording}`, rows);
}

// Maps do not serialize; the per-case probabilities are already in the hop1.* entries.
const dumpFile = `${RESULTS_DIR}cards${CARDS_VERSION === "v1" ? "" : `-${CARDS_VERSION}`}.json`;
writeFileSync(dumpFile, JSON.stringify(dump, null, 2));
console.log(`\nraw results: ${dumpFile}`);
