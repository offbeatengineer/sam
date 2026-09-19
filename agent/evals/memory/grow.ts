// Experiment H: can the folder tree be GROWN, one note at a time, instead of grouped in one pass
// by a model that sees everything? notes.ts showed folders are what makes recall cheap, but its
// folders came from a global grouping of 16 tidy themes. Here notes arrive in a stream, each is
// filed by Jev into an existing folder or a new one, and the store is messier: 24 "bridge" notes
// sit between two themes (LanceDB from Bun, a corgi in a Shanghai compound).
//
//   data     the 80 notes and 144 queries of notes.ts, plus 24 bridge notes and 72 queries for
//            them (Sonnet; the queries are written from the note alone).
//   filing   per arriving note, one Jev request over the current folders, each shown as its
//            directory listing (name + titles inside). Two rules, asked in the same request:
//              choice  one Choice over the folders plus "none"; none -> new folder
//              noul    one Noul per folder; best >= 0.5 is the home, none >= 0.5 -> new folder;
//                      other folders >= 0.5 become links (the note is listed there too)
//            The note is shown either as title + tags (what a folder listing will show of it)
//            or in full. A new folder is named by Haiku from the note's title and tags.
//   orders   two seeded shuffles, and bridges-first (the ambiguous notes seed the folders).
//   quality  against the generation themes: folders, purity, themes split across folders,
//            needless new folders, wrong merges.
//   --read   recall through the grown trees (listing -> full text, as in notes.ts) against the
//            globally grouped tree and flat recall, on all 226 queries.
//
//   batched  the alternative to a Jev judgment per note: Haiku, seeing every folder listing,
//            files 4 notes at a time (tree keys batched/title/<order>/cap8).
//   cap      split-on-overflow, the B-tree move: a folder past 8 notes is split by Haiku, which
//            sees all of its titles at once.
//
//   bun run eval:memory:grow [--fresh] [--verbose] [--read [--trees=a,b] [--report]]
//     growing the trees is ~$0.15 of Jev, --read ~$0.07 per tree plus $0.30 once for the flat baseline
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { folderQuestions, noteListing, truncate, type Turn } from "../../src/memory/judgments.js";
import { MemoryRecaller } from "../../src/memory/recaller.js";
import type { ActiveMemory } from "../../src/memory/store.js";
import { TypeSafeClient, type JevQuestion } from "../../src/memory/typesafe.js";
import { llm, pool } from "./llm.js";
import { evalConfig, f, PRICE_PER_M_INPUT } from "./typesafe.js";

interface Note { id: string; theme: number; themes?: number[]; title: string; basis: string; body: string; tags: string[]; text: string }
type QueryKind = "headline" | "detail_named" | "detail_implicit" | "none";
interface Query { id: string; kind: QueryKind; lang: "en" | "zh"; msg: string; target?: string; detail?: string }

const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname; // generated inputs, committed so the recorded numbers can be reproduced
const BASE_FILE = `${FIXTURES_DIR}notes-data.json`;
const DATA_FILE = `${FIXTURES_DIR}grow-data.json`;
const TREES_FILE = `${FIXTURES_DIR}grow-trees.json`;
const GEN_MODEL = "claude-sonnet-5";
const NAME_MODEL = "claude-haiku-4-5";
const fresh = process.argv.includes("--fresh");

// Theme indexes are those of THEMES in notes.ts.
const THEME_NAMES = ["lancedb", "gpui", "bun", "claude-api", "apple-hardware", "hokkaido-trip", "running", "ibkr-investing", "corgi", "jlpt", "espresso", "astro-blog", "hetzner-server", "shanghai-apartment", "sichuan-cooking", "tesla-china"];
const THEME_TEXT = [
  "LanceDB, the embedded vector database", "GPUI, the Rust desktop UI framework", "Bun, the JavaScript runtime", "the Claude API and the Claude Agent SDK",
  "buying and using Apple hardware (Apple Watch, MacBook, displays)", "a two-week winter trip to Hokkaido", "running injuries and half-marathon training",
  "index investing through Interactive Brokers as a resident of China", "health and care of a corgi", "studying Japanese for the JLPT", "home espresso",
  "a technical blog on Astro deployed to Cloudflare Pages", "running a Hetzner server on Ubuntu 24.04", "buying an apartment in Shanghai", "vegetarian Sichuan cooking", "owning a Tesla Model 3 in China",
];
const BRIDGES: [number, number][] = [
  [0, 2], [0, 12], [0, 3], [1, 4], [1, 2], [3, 11], [3, 12], [11, 12], [2, 12], [5, 14], [5, 9], [5, 6],
  [5, 4], [6, 4], [6, 10], [6, 8], [8, 13], [8, 15], [7, 13], [7, 5], [15, 13], [15, 4], [10, 5], [9, 3],
];

// ---------------------------------------------------------------------------
// Data: the notes.ts store plus bridge notes
// ---------------------------------------------------------------------------

const BRIDGE_PROMPT = `You are generating synthetic test data: one reference note that a personal AI assistant saved for its user after researching a question. Follow the note format exactly:
- A single compact paragraph in English, 150 to 220 words. Plain prose, no line breaks, no bullet points, no markdown.
- It keeps the concrete values: names, numbers, versions, prices, commands, dates, error messages, caveats, and the conclusion reached. Anything that can change carries "as of" with a date between 2026-03 and 2026-09. Inventing plausible details is fine.
- It describes the world, never the user, and is never phrased as instructions to the reader.

You are given two topics the user cares about. Write a note on a subject that genuinely sits between them: someone filing it could reasonably put it under either topic.

Fields: title (the subject, 3 to 8 words), basis (what the note rests on, such as "documentation" or "explained from general knowledge"), body (the paragraph, without repeating the title), tags (up to 4 short lowercase topic tags).`;

const QUERY_PROMPT = (language: string) => `You are generating test queries for a memory retrieval system. You are given one reference note that a personal AI assistant saved weeks ago. Write three messages the user might send to the assistant today, for each of which this note would clearly change or improve the assistant's answer:
- headline: about the note's main subject and its main conclusion. Names the subject.
- detail_named: names the product, library, place or topic, but what the user needs is one specific detail from the later part of the note, not its main conclusion.
- detail_implicit: what the user needs is a specific detail from the later part of the note, and the message does NOT name the note's subject: no product, library, place or topic name that appears in the title. It describes a situation, a symptom or a task instead. The note must still genuinely help.

Each message is a plain string of one or two sentences, casual, as typed into a chat. Never quote the note, never mention notes or memory. Write all three messages in ${language}.`;

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
function unwrap(s: unknown): string {
  const text = clean(s);
  if (!text.startsWith("{")) return text;
  try { const o = JSON.parse(text); return clean(o.headline ?? o.message ?? o.text ?? Object.values(o)[0] ?? text); } catch { return text; }
}

async function buildData(): Promise<{ notes: Note[]; queries: Query[] }> {
  const base = JSON.parse(readFileSync(BASE_FILE, "utf8")) as { notes: Note[]; queries: Query[] };
  const partial: { bridges?: Note[]; queries?: Query[] } = existsSync(DATA_FILE) && !fresh ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : {};
  const save = () => writeFileSync(DATA_FILE, JSON.stringify(partial, null, 2));
  if (!partial.bridges) {
    console.log(`writing ${BRIDGES.length} bridge notes with ${GEN_MODEL} ...`);
    partial.bridges = await pool(BRIDGES, 6, async ([a, b], i): Promise<Note> => {
      const r = await llm(GEN_MODEL, BRIDGE_PROMPT, `Write the note.\nTopic A: ${THEME_TEXT[a]}\nTopic B: ${THEME_TEXT[b]}`, {
        type: "object",
        properties: { title: { type: "string" }, basis: { type: "string" }, body: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
        required: ["title", "basis", "body", "tags"],
        additionalProperties: false,
      });
      const title = clean(r.title), basis = clean(r.basis), body = clean(r.body);
      return { id: `B${String(i).padStart(2, "0")}`, theme: -1, themes: [a, b], title, basis, body, tags: (r.tags ?? []).slice(0, 4).map(clean), text: `${title} (${basis}): ${body}` };
    });
    save();
  }
  if (!partial.queries) {
    console.log(`writing queries for the bridge notes with ${GEN_MODEL} ...`);
    const per = await pool(partial.bridges, 6, async (n, i) => {
      const lang = i % 2 === 0 ? "zh" : "en";
      const r = await llm(GEN_MODEL, QUERY_PROMPT(lang === "zh" ? "Chinese (Simplified), keeping product and library names in their original form" : "English"), `Write the three messages for this note.\nNote:\n${n.text}`, {
        type: "object",
        properties: { headline: { type: "string" }, detail_named: { type: "string" }, detail_implicit: { type: "string" } },
        required: ["headline", "detail_named", "detail_implicit"],
        additionalProperties: false,
      });
      return [
        { id: `${n.id}.h`, kind: "headline", lang, msg: unwrap(r.headline), target: n.id },
        { id: `${n.id}.d`, kind: "detail_named", lang, msg: unwrap(r.detail_named), target: n.id },
        { id: `${n.id}.i`, kind: "detail_implicit", lang, msg: unwrap(r.detail_implicit), target: n.id },
      ] as Query[];
    });
    partial.queries = per.flat();
    save();
  }
  return { notes: [...base.notes, ...partial.bridges], queries: [...base.queries, ...partial.queries] };
}

mkdirSync(RESULTS_DIR, { recursive: true });
const { notes, queries } = await buildData();
const noteById = new Map(notes.map((n) => [n.id, n]));
const themesOf = (n: Note) => n.themes ?? [n.theme];
console.log(`${notes.length} notes (${notes.filter((n) => n.themes).length} bridges), ${queries.length} queries`);

// ---------------------------------------------------------------------------
// Growing a tree
// ---------------------------------------------------------------------------

const cfg = evalConfig();
const client = new TypeSafeClient(cfg);

/** Hundreds of sequential requests meet the odd timeout; one should not cost the run. */
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

type Rule = "choice" | "noul";
type Shown = "title" | "full";
type OrderName = "shuffle-1" | "shuffle-2" | "bridges-first";
interface FilingEvent { id: string; home: string; created: boolean; links: string[]; choice?: string; choiceP?: number; bestNoul?: number; options: number }
interface Tree { key: string; rule: Rule; shown: Shown; order: OrderName; cap?: number; splits?: string[]; home: Record<string, string>; links: Record<string, string[]>; events: FilingEvent[] }

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs], r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function ordered(order: OrderName): Note[] {
  if (order === "shuffle-1") return shuffled(notes, 1);
  if (order === "shuffle-2") return shuffled(notes, 2);
  return [...shuffled(notes.filter((n) => n.themes), 3), ...shuffled(notes.filter((n) => !n.themes), 3)];
}

// The production listing, so what is measured here is what recall sends.
const listing = (name: string, ids: string[]) => noteListing(name, ids.map((id) => noteById.get(id)!.title));
const shownAs = (n: Note, shown: Shown) => (shown === "title" ? `${n.title} (${n.basis}) [${n.tags.join(", ")}]` : `${n.text} [${n.tags.join(", ")}]`);

async function nameFolder(n: Note, existing: string[]): Promise<string> {
  const r = await llm(
    NAME_MODEL,
    `You name folders for a personal assistant's reference notes. A folder is a topic: its name must be broad enough that later notes on the same topic would be filed there too, not a label for this one note. Lowercase kebab-case, one to three words.`,
    `Name a new folder for this note.\nNote: ${n.title} [${n.tags.join(", ")}]\nExisting folders, which the new name must differ from: ${existing.join(", ") || "(none yet)"}`,
    { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
  );
  let name = clean(r.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "folder";
  while (existing.includes(name)) name = `${name}-2`;
  return name;
}

/**
 * The B-tree move: a folder past the cap is split by a model that sees all of its titles at once,
 * which is also the one place a mixed folder (corgis filed under an EV folder) gets pulled apart.
 */
async function splitFolder(name: string, ids: string[], existing: string[]): Promise<{ name: string; ids: string[] }[] | undefined> {
  const r = await llm(
    NAME_MODEL,
    `You reorganize a personal assistant's reference notes. A folder has grown too large. Split its notes into two or three folders by topic, so that notes someone would look for together stay together. Name each folder with the topic it covers: lowercase kebab-case, one to three words, broad enough for later notes on that topic. Assign every note id exactly once.`,
    `Split this folder.\nFolder: ${name}\nNotes:\n${ids.map((id) => `${id}: ${noteById.get(id)!.title} [${noteById.get(id)!.tags.join(", ")}]`).join("\n")}\nNames already taken by other folders: ${existing.filter((x) => x !== name).join(", ") || "(none)"}`,
    { type: "object", properties: { folders: { type: "array", items: { type: "object", properties: { name: { type: "string" }, ids: { type: "array", items: { type: "string" } } }, required: ["name", "ids"], additionalProperties: false } } }, required: ["folders"], additionalProperties: false },
  );
  const taken = new Set(existing.filter((x) => x !== name));
  const seen = new Set<string>();
  const groups: { name: string; ids: string[] }[] = [];
  for (const g of r.folders ?? []) {
    const inside = (g.ids as string[]).filter((id) => ids.includes(id) && !seen.has(id));
    inside.forEach((id) => seen.add(id));
    if (inside.length === 0) continue;
    let folder = clean(g.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "folder";
    while (taken.has(folder)) folder = `${folder}-2`;
    taken.add(folder);
    groups.push({ name: folder, ids: inside });
  }
  const left = ids.filter((id) => !seen.has(id));
  if (groups.length < 2) return undefined;
  groups[0].ids.push(...left);
  return groups;
}

async function grow(rule: Rule, shown: Shown, order: OrderName, cap?: number): Promise<Tree> {
  const members = new Map<string, string[]>(); // folder -> note ids whose home it is
  const tree: Tree = { key: `${rule}/${shown}/${order}${cap ? `/cap${cap}` : ""}`, rule, shown, order, cap, splits: [], home: {}, links: {}, events: [] };
  const unsplittable = new Map<string, number>(); // folder -> size at which a split last failed
  for (const n of ordered(order)) {
    const names = [...members.keys()];
    let home: string | undefined;
    let links: string[] = [];
    const event: Partial<FilingEvent> = { id: n.id, options: names.length };
    if (names.length > 0) {
      const folders: Record<string, string> = {};
      const questions: Record<string, JevQuestion> = {};
      names.forEach((name, i) => {
        folders[`f${i}`] = listing(name, members.get(name)!);
        questions[`fits::f${i}`] = { type: "noul", instructions: `Does \`note\` belong in the folder \`folders.f${i}\`, judging by the folder's name and the notes already in it?` };
      });
      questions.file = {
        type: "choice",
        instructions: "Which entry in `folders` is the right place to file `note`, so that someone looking for it would look there?",
        criteria: { ...Object.fromEntries(names.map((_, i) => [`f${i}`, null])), none: "No folder is about this note's topic; it needs a new folder" },
      };
      const r = await retrying(() => client.ask({ note: shownAs(n, shown), folders }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 }));
      const choice = r.answers.file?.choice ?? "none";
      const nouls = names.map((name, i) => ({ name, p: r.answers[`fits::f${i}`]?.noul ?? 0 })).sort((a, b) => b.p - a.p);
      event.choice = choice === "none" ? "none" : names[Number(choice.slice(1))];
      event.choiceP = r.answers.file?.probabilities?.[choice];
      event.bestNoul = nouls[0].p;
      if (rule === "choice") home = choice === "none" ? undefined : names[Number(choice.slice(1))];
      else {
        home = nouls[0].p >= 0.5 ? nouls[0].name : undefined;
        if (!cap) links = nouls.slice(1).filter((x) => x.p >= 0.5).map((x) => x.name); // links name folders, and a split renames them
      }
    }
    const created = home === undefined;
    if (home === undefined) { home = await nameFolder(n, names); members.set(home, []); }
    members.get(home)!.push(n.id);
    tree.home[n.id] = home;
    if (links.length) tree.links[n.id] = links;
    tree.events.push({ ...(event as FilingEvent), home, created, links });
    const inside = members.get(home)!;
    if (cap && inside.length > cap && inside.length >= (unsplittable.get(home) ?? 0) + 3) {
      const groups = await splitFolder(home, inside, [...members.keys()]);
      if (!groups) unsplittable.set(home, inside.length);
      else {
        members.delete(home);
        for (const g of groups) { members.set(g.name, g.ids); for (const id of g.ids) tree.home[id] = g.name; }
        tree.splits!.push(`${home}(${inside.length}) -> ${groups.map((g) => `${g.name}(${g.ids.length})`).join(" + ")}`);
      }
    }
  }
  return tree;
}

/**
 * The alternative to filing each note by a Jev judgment: notes wait in an inbox (which recall
 * always reads) and a model that sees every folder listing files a few at a time.
 */
const BATCH = 4;
async function growBatched(order: OrderName, cap: number): Promise<Tree> {
  const members = new Map<string, string[]>();
  const tree: Tree = { key: `batched/title/${order}/cap${cap}`, rule: "choice", shown: "title", order, cap, splits: [], home: {}, links: {}, events: [] };
  const stream = ordered(order);
  for (let i = 0; i < stream.length; i += BATCH) {
    const batch = stream.slice(i, i + BATCH);
    const r = await llm(
      NAME_MODEL,
      `You file new reference notes into the folders of a personal assistant's notes. A folder is a topic: a product, a library, a project, a place, a hobby, an area of life. For each new note give the folder it belongs in: the name of an existing folder when one covers its topic, otherwise a new name. Prefer an existing folder. Prefer a broad topic over a narrow one: a folder should be able to take later notes on the same topic. New notes on the same topic go to the same folder. Names are lowercase kebab-case, one to three words. Assign every note id exactly once.`,
      `File these notes.\nExisting folders:\n${[...members.entries()].map(([name, ids]) => listing(name, ids)).join("\n") || "(none yet)"}\n\nNew notes:\n${batch.map((n) => `${n.id}: ${n.title} [${n.tags.join(", ")}]`).join("\n")}`,
      { type: "object", properties: { assignments: { type: "array", items: { type: "object", properties: { id: { type: "string" }, folder: { type: "string" } }, required: ["id", "folder"], additionalProperties: false } } }, required: ["assignments"], additionalProperties: false },
    );
    const placed = new Set<string>();
    const place = (id: string, raw: string) => {
      const name = clean(raw).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unsorted";
      if (!members.has(name)) members.set(name, []);
      members.get(name)!.push(id);
      tree.home[id] = name;
      placed.add(id);
    };
    for (const a of r.assignments ?? []) if (batch.some((n) => n.id === a.id) && !placed.has(a.id)) place(a.id, a.folder);
    for (const n of batch) if (!placed.has(n.id)) place(n.id, "unsorted");
    for (const [name, inside] of [...members.entries()]) {
      if (inside.length <= cap) continue;
      const groups = await splitFolder(name, inside, [...members.keys()]);
      if (!groups) continue;
      members.delete(name);
      for (const g of groups) { members.set(g.name, g.ids); for (const id of g.ids) tree.home[id] = g.name; }
      tree.splits!.push(`${name}(${inside.length}) -> ${groups.map((g) => `${g.name}(${g.ids.length})`).join(" + ")}`);
    }
  }
  return tree;
}

const RULES: Rule[] = ["choice", "noul"];
const SHOWN: Shown[] = ["title", "full"];
const ORDERS: OrderName[] = ["shuffle-1", "shuffle-2", "bridges-first"];
const trees: Record<string, Tree> = existsSync(TREES_FILE) && !fresh ? JSON.parse(readFileSync(TREES_FILE, "utf8")) : {};
const CAP = 8;
const wanted: { rule: Rule; shown: Shown; order: OrderName; cap?: number; key: string }[] = [
  ...RULES.flatMap((rule) => SHOWN.flatMap((shown) => ORDERS.map((order) => ({ rule, shown, order, key: `${rule}/${shown}/${order}` })))),
  ...RULES.flatMap((rule) => ORDERS.map((order) => ({ rule, shown: "title" as Shown, order, cap: CAP, key: `${rule}/title/${order}/cap${CAP}` }))),
];
const batchedWanted = ORDERS.map((order) => ({ order, key: `batched/title/${order}/cap${CAP}` }));
const missingBatched = batchedWanted.filter((w) => !trees[w.key]);
if (missingBatched.length) {
  console.log(`growing ${missingBatched.length} batch-filed trees (${BATCH} notes per batch, filed by ${NAME_MODEL}) ...`);
  await pool(missingBatched, 3, async (w) => {
    trees[w.key] = await growBatched(w.order, CAP);
    writeFileSync(TREES_FILE, JSON.stringify(trees, null, 2));
    console.log(`  ${w.key}: ${new Set(Object.values(trees[w.key].home)).size} folders`);
  });
}
for (const w of batchedWanted) wanted.push({ rule: "choice", shown: "title", order: w.order, cap: CAP, key: w.key });
const missing = wanted.filter((w) => !trees[w.key]);
if (missing.length) {
  console.log(`growing ${missing.length} trees, ${notes.length} notes each ...`);
  await pool(missing, 6, async (w) => {
    trees[w.key] = await grow(w.rule, w.shown, w.order, w.cap);
    writeFileSync(TREES_FILE, JSON.stringify(trees, null, 2));
    console.log(`  ${w.key}: ${new Set(Object.values(trees[w.key].home)).size} folders`);
  });
}

// ---------------------------------------------------------------------------
// Tree quality, against the generation themes
// ---------------------------------------------------------------------------

function quality(tree: Tree) {
  const folders = new Map<string, Note[]>();
  for (const n of notes) folders.set(tree.home[n.id], [...(folders.get(tree.home[n.id]) ?? []), n]);
  // A folder's theme is the majority theme of the plain notes in it; a bridge-only folder takes its first note's.
  const themeOf = new Map<string, number>();
  for (const [name, inside] of folders) {
    const counts = new Map<number, number>();
    for (const n of inside.filter((n) => !n.themes)) counts.set(n.theme, (counts.get(n.theme) ?? 0) + 1);
    themeOf.set(name, counts.size ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : -1);
  }
  let misfiled = 0;
  const misfiledList: string[] = [];
  for (const [name, inside] of folders) for (const n of inside) {
    const t = themeOf.get(name)!;
    if (t !== -1 && !themesOf(n).includes(t)) { misfiled++; misfiledList.push(`${n.id}(${themesOf(n).map((x) => THEME_NAMES[x]).join("+")})->${name}`); }
  }
  // Themes whose plain notes ended up in more than one folder.
  const split: string[] = [];
  for (let t = 0; t < THEME_NAMES.length; t++) {
    const homes = new Set(notes.filter((n) => !n.themes && n.theme === t).map((n) => tree.home[n.id]));
    if (homes.size > 1) split.push(`${THEME_NAMES[t]}:${[...homes].join("|")}`);
  }
  const bridgeOnly = [...folders.entries()].filter(([, inside]) => inside.every((n) => n.themes)).map(([name, inside]) => `${name}(${inside.length})`);
  const sizes = [...folders.values()].map((x) => x.length);
  return { folders: folders.size, largest: Math.max(...sizes), singletons: sizes.filter((s) => s === 1).length, misfiled, misfiledList, split, bridgeOnly, linked: Object.keys(tree.links).length };
}

console.log(`\n== grown trees (ideal: 16 theme folders, every theme in one folder, nothing misfiled)`);
console.log(`   ${"rule/shown/order".padEnd(30)}${"folders".padEnd(9)}${"largest".padEnd(9)}${"single".padEnd(8)}${"themes split".padEnd(14)}${"misfiled".padEnd(10)}${"bridge-only folders".padEnd(21)}linked notes`);
for (const w of wanted) {
  const q = quality(trees[w.key]);
  console.log(`   ${w.key.padEnd(30)}${String(q.folders).padEnd(9)}${String(q.largest).padEnd(9)}${String(q.singletons).padEnd(8)}${String(q.split.length).padEnd(14)}${String(q.misfiled).padEnd(10)}${String(q.bridgeOnly.length).padEnd(21)}${q.linked}`);
}
for (const w of wanted) {
  const q = quality(trees[w.key]);
  if (process.argv.includes("--verbose") && (q.split.length || q.misfiled || q.bridgeOnly.length)) console.log(`\n   ${w.key}\n      split: ${q.split.join("  ") || "-"}\n      misfiled: ${q.misfiledList.join("  ") || "-"}\n      bridge-only: ${q.bridgeOnly.join("  ") || "-"}`);
  if (trees[w.key].splits?.length) console.log(`\n   ${w.key}: ${trees[w.key].splits!.length} splits\n      ${trees[w.key].splits!.join("\n      ")}`);
}
const showTree = trees[`noul/title/shuffle-1/cap${CAP}`];
console.log(`\nfolders of ${showTree.key}:`);
for (const name of [...new Set(Object.values(showTree.home))]) console.log(`   ${listing(name, notes.filter((n) => showTree.home[n.id] === name).map((n) => n.id)).slice(0, 220)}`);

if (!process.argv.includes("--read")) process.exit(0);

// ---------------------------------------------------------------------------
// --read: recall through the grown trees
// ---------------------------------------------------------------------------

const now = Date.now();
const memory = (n: Note): ActiveMemory => ({ id: n.id, text: n.text, tags: n.tags, source: "auto", created_at: now, updated_at: now, kind: "knowledge" });
const recaller = new MemoryRecaller(client, { ...cfg, maxRecalled: 110, maxShards: 50 });
interface Judged { picked: string[]; tokens: number; ms: number }
async function judge(msg: string, ids: string[]): Promise<Judged> {
  if (ids.length === 0) return { picked: [], tokens: 0, ms: 0 };
  return retrying(async () => {
    const outcome = await recaller.recall([{ role: "user", text: msg }], ids.map((id) => memory(noteById.get(id)!)));
    if (outcome.status !== "ok") throw new Error(`recall ${outcome.status}: ${outcome.reason}`);
    return { picked: outcome.picked.map((m) => m.id), tokens: outcome.tokens, ms: outcome.ms };
  });
}

/** folder -> the ids listed in it: the notes whose home it is, plus linked notes when `withLinks`. */
function foldersOf(tree: { home: Record<string, string>; links?: Record<string, string[]> }, withLinks: boolean): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of notes) {
    for (const name of [tree.home[n.id], ...(withLinks ? tree.links?.[n.id] ?? [] : [])]) out.set(name, [...(out.get(name) ?? []), n.id]);
  }
  return out;
}

const OPEN_AT = 0.15;
async function throughTree(msg: string, folders: Map<string, string[]>): Promise<Judged & { opened: number; read: number }> {
  const names = [...folders.keys()];
  const conversation: Turn[] = [{ role: "user", text: msg }];
  const state: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  names.forEach((name, i) => {
    state[`c${i}`] = listing(name, folders.get(name)!);
    Object.assign(questions, folderQuestions("notes", [`c${i}`]));
  });
  const r = await retrying(() => client.ask({ conversation, cards: state }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 }));
  const open = names.filter((_, i) => (r.answers[`open::c${i}`]?.noul ?? 0) >= OPEN_AT);
  const ids = [...new Set(open.flatMap((name) => folders.get(name)!))];
  const j = await judge(msg, ids);
  return { picked: j.picked, tokens: r.usage.input_tokens + j.tokens, ms: r.ms + j.ms, opened: open.length, read: ids.length };
}

// The reference tree: one global grouping of all titles, as notes.ts did.
const GLOBAL_FILE = `${FIXTURES_DIR}grow-global.json`;
let globalHome: Record<string, string>;
if (existsSync(GLOBAL_FILE) && !fresh) globalHome = JSON.parse(readFileSync(GLOBAL_FILE, "utf8"));
else {
  console.log(`\ngrouping all ${notes.length} notes in one pass with ${GEN_MODEL} (the reference tree) ...`);
  const r = await llm(GEN_MODEL, `You organize a personal assistant's reference notes into folders. You are given each note's id, title and tags. Group notes on the same topic into one folder: a folder holds between 3 and 10 notes, and its name is lowercase kebab-case, such as home-garden. Assign every note id exactly once.`, `Notes:\n${notes.map((n) => `${n.id}: ${n.title} [${n.tags.join(", ")}]`).join("\n")}`, {
    type: "object",
    properties: { assignments: { type: "array", items: { type: "object", properties: { id: { type: "string" }, folder: { type: "string" } }, required: ["id", "folder"], additionalProperties: false } } },
    required: ["assignments"],
    additionalProperties: false,
  });
  globalHome = {};
  for (const a of r.assignments ?? []) if (noteById.has(a.id) && !globalHome[a.id]) globalHome[a.id] = clean(a.folder).toLowerCase();
  for (const n of notes) globalHome[n.id] ??= "unsorted";
  writeFileSync(GLOBAL_FILE, JSON.stringify(globalHome, null, 2));
}

const READ: { name: string; folders: Map<string, string[]> }[] = [
  { name: "global grouping (reference)", folders: foldersOf({ home: globalHome }, false) },
  ...(process.argv.find((a) => a.startsWith("--trees="))?.slice(8).split(",") ?? ["noul/title/shuffle-1", "noul/title/shuffle-2", "noul/title/bridges-first", "choice/title/shuffle-1", "noul/full/shuffle-1"]).flatMap((key) => {
    const out = [{ name: key, folders: foldersOf(trees[key], false) }];
    if (Object.keys(trees[key].links).length) out.push({ name: `${key} + links`, folders: foldersOf(trees[key], true) });
    return out;
  }),
];

const FLAT_FILE = `${RESULTS_DIR}grow-flat.json`;
const flat: Record<string, Judged> = existsSync(FLAT_FILE) && !fresh ? JSON.parse(readFileSync(FLAT_FILE, "utf8")) : {};
const todo = queries.filter((q) => !flat[q.id]);
if (todo.length) {
  console.log(`\nflat baseline for ${todo.length} queries over ${notes.length} notes ...`);
  await pool(todo, 4, async (q) => { flat[q.id] = await judge(q.msg, notes.map((n) => n.id)); });
  writeFileSync(FLAT_FILE, JSON.stringify(flat));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
const fair = queries.filter((q) => q.target && flat[q.id].picked.includes(q.target));
const plain = fair.filter((q) => !noteById.get(q.target!)!.themes);
const bridge = fair.filter((q) => noteById.get(q.target!)!.themes);
console.log(`\n== recall through each tree: folder listings, open at ${OPEN_AT}, then the full text of the notes inside`);
console.log(`   flat recalls the target for ${fair.length}/${queries.filter((q) => q.target).length} queries (${plain.length} on plain notes, ${bridge.length} on bridge notes); the rest are left out`);
console.log(`   ${"tree".padEnd(34)}${"folders".padEnd(9)}${"plain".padEnd(10)}${"bridge".padEnd(9)}${"opened".padEnd(8)}${"read".padEnd(7)}${"picked".padEnd(8)}${"tokens".padEnd(8)}$/turn     median ms`);
const flatTokens = mean(queries.map((q) => flat[q.id].tokens));
console.log(`   ${"flat (production)".padEnd(34)}${"-".padEnd(9)}${`${plain.length}/${plain.length}`.padEnd(10)}${`${bridge.length}/${bridge.length}`.padEnd(9)}${"-".padEnd(8)}${String(notes.length).padEnd(7)}${f(mean(fair.map((q) => flat[q.id].picked.length)), 1).padEnd(8)}${String(Math.round(flatTokens)).padEnd(8)}${((flatTokens / 1e6) * PRICE_PER_M_INPUT).toFixed(5).padEnd(10)}${Math.round(median(queries.map((q) => flat[q.id].ms)))}`);
// --report reprints the table from the saved rows of the last --read, without calling Jev.
const READ_FILE = `${RESULTS_DIR}grow-read.json`;
const saved: Record<string, ({ id: string } & Awaited<ReturnType<typeof throughTree>>)[]> = process.argv.includes("--report") ? JSON.parse(readFileSync(READ_FILE, "utf8")) : {};
const dump: Record<string, unknown> = {};
for (const t of READ) {
  const rows = saved[t.name]
    ? queries.flatMap((q) => { const r = saved[t.name].find((x) => x.id === q.id); return r ? [{ q, r }] : []; })
    : await pool(queries, 5, async (q) => ({ q, r: await throughTree(q.msg, t.folders) }));
  const byId = new Map(rows.map((x) => [x.q.id, x.r]));
  const got = (qs: Query[]) => qs.filter((q) => byId.get(q.id)!.picked.includes(q.target!)).length;
  const tokens = mean(rows.map((x) => x.r.tokens));
  console.log(`   ${t.name.padEnd(34)}${String(t.folders.size).padEnd(9)}${`${got(plain)}/${plain.length}`.padEnd(10)}${`${got(bridge)}/${bridge.length}`.padEnd(9)}${f(mean(fair.map((q) => byId.get(q.id)!.opened)), 1).padEnd(8)}${f(mean(fair.map((q) => byId.get(q.id)!.read)), 1).padEnd(7)}${f(mean(fair.map((q) => byId.get(q.id)!.picked.length)), 1).padEnd(8)}${String(Math.round(tokens)).padEnd(8)}${((tokens / 1e6) * PRICE_PER_M_INPUT).toFixed(5).padEnd(10)}${Math.round(median(rows.map((x) => x.r.ms)))}`);
  const missed = fair.filter((q) => !byId.get(q.id)!.picked.includes(q.target!));
  if (missed.length) console.log(`      missed: ${missed.map((q) => `${q.id}(${t.folders.size ? [...t.folders.entries()].find(([, ids]) => ids.includes(q.target!))?.[0] : ""})`).join(" ")}`);
  dump[t.name] = rows.map((x) => ({ id: x.q.id, ...x.r }));
}
if (!process.argv.includes("--report")) writeFileSync(READ_FILE, JSON.stringify(dump));
console.log(`\nraw results: ${READ_FILE}`);
