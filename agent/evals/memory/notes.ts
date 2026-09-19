// Experiment G: progressive disclosure for REFERENCE NOTES, the part of the store that grows.
// A note is a paragraph (hundreds of tokens), and today every note is sent to Jev in full on
// every turn. Can Jev pick the right note from a short index card instead, and only then read
// the text? The risk is the detail buried mid-paragraph that no summary mentions.
//
//   notes    16 themes x 5 sibling notes in the production note format (Sonnet). Siblings share
//            vocabulary on purpose: their cards look alike, which is what a real store does.
//   cards    one per note (Haiku, the production writer model): holds / matters_when / details.
//   queries  for 48 target notes (a short, a medium and the long one per theme), three messages
//            each (Sonnet, shown the note only, never the cards): headline, a buried detail with
//            the subject named, and a buried detail with the subject NOT named. Half in Chinese.
//            Plus hand-written messages no note helps with.
//   hop 1    one Noul per card. Variants: title+tags (free: the writer already produces both) /
//            card / card+details / title+details.
//   flat     production MemoryRecaller over the full notes (the baseline).
//   two-hop  cards -> full text of the opened notes, judged by the production recaller.
//   folders  (--folders) the level above: notes grouped into folders from titles and tags alone
//            (Sonnet). Folder card = "listing" (folder name + the titles inside, no LLM text) or
//            "summary" (Haiku). Then either the full text of every note in the opened folders,
//            or note cards first.
//
//   bun run eval:memory:notes [--fresh] [--data-only] [--folders]
//     a full pass is about $0.50 of Jev, --folders about $0.05 (it reuses the flat baseline of a
//     full pass); rebuilding the data is ~170 LLM calls
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { folderQuestions, noteListing, truncate, type Turn } from "../../src/memory/judgments.js";
import { MemoryRecaller } from "../../src/memory/recaller.js";
import type { ActiveMemory } from "../../src/memory/store.js";
import { TypeSafeClient, type JevQuestion } from "../../src/memory/typesafe.js";
import { llm, pool } from "./llm.js";
import { evalConfig, f, PRICE_PER_M_INPUT } from "./typesafe.js";

const THEMES = [
  "LanceDB: how-tos and internals of the embedded vector database",
  "GPUI, the Rust desktop UI framework from the Zed editor",
  "Bun: the JavaScript runtime, package manager and test runner",
  "The Claude API and the Claude Agent SDK",
  "Buying Apple hardware: Apple Watch, MacBook, displays",
  "Planning a two-week winter trip to Hokkaido",
  "Running injuries and half-marathon training",
  "Index investing through Interactive Brokers for a resident of China",
  "Health and care of a corgi",
  "Studying Japanese for the JLPT",
  "Home espresso: machines, grinders, milk alternatives",
  "A technical blog on Astro deployed to Cloudflare Pages",
  "Running a Hetzner server on Ubuntu 24.04",
  "Buying an apartment in Shanghai",
  "Vegetarian Sichuan cooking",
  "Owning a Tesla Model 3 in China",
];

// No note helps with these. Written before any note existed.
const NONE_QUERIES = [
  "What's the difference between a mutex and a semaphore?",
  "lol ok, thanks",
  "What's the capital of Canada?",
  "Write a haiku about autumn.",
  "Translate 'good morning' into French.",
  "What's 17% of 2,340?",
  "Explain how a bloom filter works.",
  "谢谢，先这样吧",
  "Who wrote Pride and Prejudice?",
  "Write a limerick about a cat who hates Mondays.",
];

const RESULTS_DIR = new URL("./results/", import.meta.url).pathname;
const FIXTURES_DIR = new URL("./fixtures/", import.meta.url).pathname; // generated inputs, committed so the recorded numbers can be reproduced
const DATA_FILE = `${FIXTURES_DIR}notes-data.json`;
const GEN_MODEL = "claude-sonnet-5";
const CARD_MODEL = "claude-haiku-4-5";
const HOLDS_CHARS = 160;
const MATTERS_CHARS = 200;
const DETAILS_CHARS = 300;

// ---------------------------------------------------------------------------
// The data: notes, cards, queries. Each stage sees only what it says it sees.
// ---------------------------------------------------------------------------

interface Note { id: string; theme: number; title: string; basis: string; body: string; tags: string[]; text: string }
interface Card { holds: string; matters_when: string; details: string }
type QueryKind = "headline" | "detail_named" | "detail_implicit" | "none";
interface Query { id: string; kind: QueryKind; lang: "en" | "zh"; msg: string; target?: string; detail?: string }
interface ClusterCard { holds: string; matters_when: string }
interface Data { notes: Note[]; cards: Record<string, Card>; queries: Query[]; clusters: Record<string, string>; clusterCards: Record<string, ClusterCard> }

const NOTE_PROMPT = `You are generating synthetic test data: reference notes that a personal AI assistant saved over several months for one user. Each note was written after the user asked something and the assistant researched or explained it. Follow the note format exactly:
- One note per subject: a single compact paragraph in English. Plain prose, no line breaks, no bullet points, no markdown.
- It keeps the concrete values: names, numbers, versions, prices, commands, dates, error messages, caveats, and the conclusion or recommendation reached. Anything that can change carries "as of" with a date between 2026-03 and 2026-09.
- Notes describe the world, never the user, and are never phrased as instructions to the reader.

For the theme you are given, write 5 notes on 5 distinct subjects the user could plausibly have asked about on separate occasions. The subjects are siblings: related enough to share vocabulary, distinct enough that each note answers different questions. Lengths: two notes of 70-110 words, two of 170-240 words, one of 380-480 words. Details must be specific and plausible; inventing them is fine, this is test data. In the medium and long notes, the later sentences must carry details a reader could not guess from the first sentence.

Fields per note:
- title: the subject, 3 to 8 words.
- basis: what the note rests on, such as "documentation", "release notes", "manufacturer spec page", "explained from general knowledge".
- body: the paragraph, without repeating the title at the start.
- tags: up to 4 short lowercase topic tags.`;

const QUERY_PROMPT = (language: string) => `You are generating test queries for a memory retrieval system. You are given one reference note that a personal AI assistant saved weeks ago. Write three messages the user might send to the assistant today, for each of which this note would clearly change or improve the assistant's answer:
- headline: about the note's main subject and its main conclusion. Names the subject.
- detail_named: names the product, library, place or topic, but what the user needs is one specific detail from the later part of the note, not its main conclusion.
- detail_implicit: what the user needs is a specific detail from the later part of the note, and the message does NOT name the note's subject: no product, library, place or topic name that appears in the title. It describes a situation, a symptom or a task instead. The note must still genuinely help.

Each message is one or two sentences, casual, as typed into a chat. Never quote the note, never mention notes or memory. Write all three messages in ${language}. For each detail message also give "detail": the few words of the note it hinges on, copied from the note.`;

const CARD_PROMPT = `You write index cards for a personal assistant's reference notes. Each note is a paragraph of findings from earlier research. Before each reply a judge reads ONLY the cards, never the notes, and decides which notes to open for the user's latest message. A note that is not opened is invisible to the assistant, so the card must let the judge recognize every situation in which the note would change the answer, including a question about one specific detail inside it.

Write three fields, in English:
- holds: the subject and the conclusion or main findings, at most ${HOLDS_CHARS} characters.
- matters_when: tasks, requests, or situations in which this note would change the assistant's answer, including indirect ones where the user would not mention the subject by name. At most ${MATTERS_CHARS} characters, comma-separated phrases.
- details: the specific names, numbers, versions, commands, error messages and caveats that appear in the note, especially those a reader would not guess from the subject. At most ${DETAILS_CHARS} characters, comma-separated, no sentences.`;

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** The generator sometimes returns the headline as a JSON object in a string. */
function unwrap(s: unknown): string {
  const text = clean(s);
  if (!text.startsWith("{")) return text;
  try { const o = JSON.parse(text); return clean(o.headline ?? o.message ?? text); } catch { return text; }
}
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const lengthClass = (n: Note) => (words(n.body) < 140 ? "short" : words(n.body) < 320 ? "medium" : "long");

async function writeNotes(): Promise<Note[]> {
  console.log(`writing ${THEMES.length * 5} notes with ${GEN_MODEL} ...`);
  const perTheme = await pool(THEMES, 4, async (theme, t) => {
    const r = await llm(GEN_MODEL, NOTE_PROMPT, `Write the 5 notes for this theme.\nTheme: ${theme}`, {
      type: "object",
      properties: {
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, basis: { type: "string" }, body: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
            required: ["title", "basis", "body", "tags"],
            additionalProperties: false,
          },
        },
      },
      required: ["notes"],
      additionalProperties: false,
    });
    return (r.notes as any[]).slice(0, 5).map((n, i): Note => {
      const title = clean(n.title), basis = clean(n.basis), body = clean(n.body);
      return { id: `N${String(t * 5 + i).padStart(2, "0")}`, theme: t, title, basis, body, tags: (n.tags ?? []).slice(0, 4).map(clean), text: `${title} (${basis}): ${body}` };
    });
  });
  return perTheme.flat();
}

async function writeCards(notes: Note[]): Promise<Record<string, Card>> {
  console.log(`writing ${notes.length} cards with ${CARD_MODEL} ...`);
  const cards = await pool(notes, 6, async (n) => {
    const r = await llm(CARD_MODEL, CARD_PROMPT, `Write the card for this note.\nNote:\n${n.text}`, {
      type: "object",
      properties: { holds: { type: "string" }, matters_when: { type: "string" }, details: { type: "string" } },
      required: ["holds", "matters_when", "details"],
      additionalProperties: false,
    });
    return [n.id, { holds: truncate(clean(r.holds), HOLDS_CHARS), matters_when: truncate(clean(r.matters_when), MATTERS_CHARS), details: truncate(clean(r.details), DETAILS_CHARS) }] as const;
  });
  return Object.fromEntries(cards);
}

/** Per theme: a short note, a medium one, and the long one, so the results split by how much a card has to leave out. */
function targets(notes: Note[]): Note[] {
  const out: Note[] = [];
  for (let t = 0; t < THEMES.length; t++) {
    const byLength = notes.filter((n) => n.theme === t).sort((a, b) => words(a.body) - words(b.body));
    out.push(byLength[0], byLength[Math.floor(byLength.length / 2)], byLength[byLength.length - 1]);
  }
  return out;
}

async function writeQueries(notes: Note[]): Promise<Query[]> {
  const picked = targets(notes);
  console.log(`writing queries for ${picked.length} target notes with ${GEN_MODEL} ...`);
  const perNote = await pool(picked, 6, async (n, i) => {
    const lang = i % 2 === 0 ? "zh" : "en";
    const r = await llm(GEN_MODEL, QUERY_PROMPT(lang === "zh" ? "Chinese (Simplified), keeping product and library names in their original form" : "English"), `Write the three messages for this note.\nNote:\n${n.text}`, {
      type: "object",
      properties: {
        headline: { type: "string" },
        detail_named: { type: "object", properties: { message: { type: "string" }, detail: { type: "string" } }, required: ["message", "detail"], additionalProperties: false },
        detail_implicit: { type: "object", properties: { message: { type: "string" }, detail: { type: "string" } }, required: ["message", "detail"], additionalProperties: false },
      },
      required: ["headline", "detail_named", "detail_implicit"],
      additionalProperties: false,
    });
    return [
      { id: `${n.id}.h`, kind: "headline", lang, msg: unwrap(r.headline), target: n.id },
      { id: `${n.id}.d`, kind: "detail_named", lang, msg: clean(r.detail_named.message), detail: clean(r.detail_named.detail), target: n.id },
      { id: `${n.id}.i`, kind: "detail_implicit", lang, msg: clean(r.detail_implicit.message), detail: clean(r.detail_implicit.detail), target: n.id },
    ] as Query[];
  });
  const none = NONE_QUERIES.map((msg, i): Query => ({ id: `Z${i}`, kind: "none", lang: /[一-鿿]/.test(msg) ? "zh" : "en", msg }));
  return [...perNote.flat(), ...none];
}

const CLUSTER_PROMPT = `You organize a personal assistant's reference notes into folders. You are given each note's id, title and tags. Group notes on the same topic into one folder: a folder holds between 3 and 10 notes, and its name is lowercase kebab-case, such as home-garden. Assign every note id exactly once.`;

const CLUSTER_CARD_PROMPT = `You write index cards for folders of a personal assistant's reference notes. Before each reply a judge reads ONLY the folder cards and decides which folders to open for the user's latest message. A folder that is not opened is invisible to the assistant, so the card must let the judge recognize every situation in which a note inside would change the answer.

Write two fields, in English:
- holds: what the notes in this folder cover, at most 240 characters.
- matters_when: tasks, requests, or situations in which a note in this folder would change the assistant's answer, including indirect ones where the user would not mention the topic by name. At most 200 characters, comma-separated phrases.`;

/** Folders from titles and tags alone, so the grouping sees neither the note bodies nor the queries. */
async function groupNotes(notes: Note[]): Promise<Record<string, string>> {
  console.log(`grouping ${notes.length} notes into folders with ${GEN_MODEL} ...`);
  const r = await llm(GEN_MODEL, CLUSTER_PROMPT, `Notes:\n${notes.map((n) => `${n.id}: ${n.title} [${n.tags.join(", ")}]`).join("\n")}`, {
    type: "object",
    properties: { assignments: { type: "array", items: { type: "object", properties: { id: { type: "string" }, folder: { type: "string" } }, required: ["id", "folder"], additionalProperties: false } } },
    required: ["assignments"],
    additionalProperties: false,
  });
  const out: Record<string, string> = {};
  for (const a of r.assignments ?? []) if (notes.some((n) => n.id === a.id) && !out[a.id]) out[a.id] = clean(a.folder).toLowerCase();
  for (const n of notes) out[n.id] ??= "unsorted";
  return out;
}

async function writeClusterCards(notes: Note[], cards: Record<string, Card>, clusters: Record<string, string>): Promise<Record<string, ClusterCard>> {
  const folders = [...new Set(Object.values(clusters))];
  console.log(`writing ${folders.length} folder cards with ${CARD_MODEL} ...`);
  const out = await pool(folders, 6, async (folder) => {
    const inside = notes.filter((n) => clusters[n.id] === folder);
    const r = await llm(CARD_MODEL, CLUSTER_CARD_PROMPT, `Write the card for this folder.\nFolder: ${folder}\nNotes inside (${inside.length}):\n${inside.map((n) => `- ${n.title}: ${cards[n.id].holds}`).join("\n")}`, {
      type: "object",
      properties: { holds: { type: "string" }, matters_when: { type: "string" } },
      required: ["holds", "matters_when"],
      additionalProperties: false,
    });
    return [folder, { holds: truncate(clean(r.holds), 240), matters_when: truncate(clean(r.matters_when), MATTERS_CHARS) }] as const;
  });
  return Object.fromEntries(out);
}

/** Saved after every stage, so a stage that fails does not cost the ones before it. */
async function buildData(): Promise<Data> {
  const partial: Partial<Data> = existsSync(DATA_FILE) && !process.argv.includes("--fresh") ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : {};
  if (partial.clusterCards) console.log(`data: reusing ${DATA_FILE} (pass --fresh to rebuild)`);
  const save = () => writeFileSync(DATA_FILE, JSON.stringify(partial, null, 2));
  if (!partial.notes) { partial.notes = await writeNotes(); save(); }
  if (!partial.cards) { partial.cards = await writeCards(partial.notes); save(); }
  if (!partial.queries) { partial.queries = await writeQueries(partial.notes); save(); }
  if (!partial.clusters) { partial.clusters = await groupNotes(partial.notes); save(); }
  if (!partial.clusterCards) { partial.clusterCards = await writeClusterCards(partial.notes, partial.cards, partial.clusters); save(); }
  return partial as Data;
}

mkdirSync(RESULTS_DIR, { recursive: true });
mkdirSync(FIXTURES_DIR, { recursive: true });
const data = await buildData();
const { notes, cards, queries, clusters, clusterCards } = data;
const noteById = new Map(notes.map((n) => [n.id, n]));
const chars = notes.map((n) => n.text.length);
console.log(`\n${notes.length} notes: ${Math.round(chars.reduce((a, b) => a + b, 0) / notes.length)} chars on average (${Math.min(...chars)}-${Math.max(...chars)}); ${queries.length} queries, ${queries.filter((q) => q.kind !== "none").length} with a target`);
const sample = notes[notes.length >> 1];
console.log(`\nsample ${sample.id} [${lengthClass(sample)}]: ${truncate(sample.text, 300)}\n  holds:   ${cards[sample.id].holds}\n  when:    ${cards[sample.id].matters_when}\n  details: ${cards[sample.id].details}`);
for (const q of queries.filter((q) => q.target === sample.id)) console.log(`  ${q.kind.padEnd(16)} ${q.msg}${q.detail ? `   <- "${q.detail}"` : ""}`);
if (process.argv.includes("--data-only")) process.exit(0);

// ---------------------------------------------------------------------------
// Hop 1: one Noul per card
// ---------------------------------------------------------------------------

const cfg = evalConfig();
const client = new TypeSafeClient(cfg);

type Variant = "title" | "card" | "card+details" | "title+details";
const VARIANTS: Variant[] = ["title", "card", "card+details", "title+details"];
function cardText(n: Note, v: Variant): string {
  const c = cards[n.id];
  const head = `${n.title} (${n.basis})`;
  if (v === "title") return `${head} [${n.tags.join(", ")}]`;
  if (v === "card") return `${head}. Holds: ${c.holds} Matters when: ${c.matters_when}`;
  if (v === "title+details") return `${head}. Details: ${c.details}`;
  return `${head}. Holds: ${c.holds} Matters when: ${c.matters_when} Details: ${c.details}`;
}

interface Routed { p: Record<string, number>; tokens: number; ms: number }
const NOTE_Q = (a: string) => `Would the reference note that \`cards.${a}\` describes change or improve the assistant's next response in \`conversation\`?`;
const FOLDER_Q = (a: string) => String(folderQuestions("notes", [a])[`open::${a}`].instructions);
async function routeItems(msg: string, items: { id: string; text: string }[], question: (alias: string) => string): Promise<Routed> {
  if (items.length === 0) return { p: {}, tokens: 0, ms: 0 };
  const conversation: Turn[] = [{ role: "user", text: msg }];
  const state: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};
  items.forEach((item, i) => {
    state[`c${i}`] = item.text;
    questions[`open::c${i}`] = { type: "noul", instructions: question(`c${i}`) };
  });
  const r = await client.ask({ conversation, cards: state }, questions, { timeoutMs: cfg.writeTimeoutMs, retries: 4 });
  return { p: Object.fromEntries(items.map((item, i) => [item.id, r.answers[`open::c${i}`]?.noul ?? 0])), tokens: r.usage.input_tokens, ms: r.ms };
}
const route = (msg: string, variant: Variant, subset: Note[] = notes) => routeItems(msg, subset.map((n) => ({ id: n.id, text: cardText(n, variant) })), NOTE_Q);

// Folder cards. "listing" is the directory listing: the folder name and the titles inside, no LLM-written text.
type FolderVariant = "listing" | "summary";
const FOLDER_VARIANTS: FolderVariant[] = ["listing", "summary"];
const folders = [...new Set(Object.values(clusters))];
const inFolder = (folder: string) => notes.filter((n) => clusters[n.id] === folder);
function folderText(folder: string, v: FolderVariant): string {
  if (v === "listing") return noteListing(folder, inFolder(folder).map((n) => n.title));
  return `${folder}/ Holds: ${clusterCards[folder].holds} Matters when: ${clusterCards[folder].matters_when}`;
}
const routeFolders = (msg: string, v: FolderVariant) => routeItems(msg, folders.map((folder) => ({ id: folder, text: folderText(folder, v) })), FOLDER_Q);

// ---------------------------------------------------------------------------
// Full-text judgment: the flat baseline, and hop 2 over the opened notes
// ---------------------------------------------------------------------------

const now = Date.now();
const memory = (n: Note): ActiveMemory => ({ id: n.id, text: n.text, tags: n.tags, source: "auto", created_at: now, updated_at: now, kind: "knowledge" });
const recaller = new MemoryRecaller(client, { ...cfg, maxRecalled: 80, maxShards: 50 });

interface Judged { picked: string[]; tokens: number; ms: number; shards: number }
async function judge(msg: string, ids: string[]): Promise<Judged> {
  if (ids.length === 0) return { picked: [], tokens: 0, ms: 0, shards: 0 };
  const outcome = await recaller.recall([{ role: "user", text: msg }], ids.map((id) => memory(noteById.get(id)!)));
  if (outcome.status !== "ok") throw new Error(`recall ${outcome.status}: ${outcome.reason}`);
  return { picked: outcome.picked.map((m) => m.id), tokens: outcome.tokens, ms: outcome.ms, shards: outcome.shards };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
const KINDS: QueryKind[] = ["headline", "detail_named", "detail_implicit"];
const over = (r: Routed, t: number) => Object.entries(r.p).filter(([, p]) => p >= t).map(([id]) => id);

// --folders: the level above the notes. Reuses the flat results of a full run for the baseline.
if (process.argv.includes("--folders")) {
  const saved: { q: Query; flat: Judged }[] = JSON.parse(readFileSync(`${RESULTS_DIR}notes.json`, "utf8"));
  const flatOf = new Map(saved.map((r) => [r.q.id, r.flat]));
  console.log(`\n${folders.length} folders: ${folders.map((folder) => `${folder} (${inFolder(folder).length})`).join("  ")}`);
  const mixed = folders.filter((folder) => new Set(inFolder(folder).map((n) => n.theme)).size > 1);
  console.log(`folders that mix generation themes: ${mixed.join(", ") || "none"}`);
  console.log(`\nsample listing card: ${folderText(folders[0], "listing")}\nsample summary card: ${folderText(folders[0], "summary")}`);

  const FT = [0.3, 0.15];
  interface FRow { q: Query; flat: Judged; hop: Record<FolderVariant, Routed>; direct: Record<string, Judged>; viaCards: Record<string, { hop2: Routed; judged: Judged }> }
  console.log(`\nrunning ${queries.length} queries through the folder level ...`);
  const frows = await pool(queries, 4, async (q): Promise<FRow> => {
    const routed = await Promise.all(FOLDER_VARIANTS.map((v) => routeFolders(q.msg, v)));
    const hop = Object.fromEntries(FOLDER_VARIANTS.map((v, i) => [v, routed[i]])) as Record<FolderVariant, Routed>;
    const direct: Record<string, Judged> = {};
    const viaCards: FRow["viaCards"] = {};
    await Promise.all(FOLDER_VARIANTS.flatMap((v) => FT.map(async (t) => {
      const inside = notes.filter((n) => over(hop[v], t).includes(clusters[n.id]));
      direct[`${v}@${t}`] = await judge(q.msg, inside.map((n) => n.id));
      if (v === "listing") {
        const hop2 = await route(q.msg, "title+details", inside);
        viaCards[`${v}@${t}`] = { hop2, judged: await judge(q.msg, over(hop2, 0.3)) };
      }
    })));
    return { q, flat: flatOf.get(q.id)!, hop, direct, viaCards };
  });
  const fair = frows.filter((r) => r.q.target && r.flat.picked.includes(r.q.target));
  const none = frows.filter((r) => !r.q.target);
  const folderHit = (rs: FRow[], v: FolderVariant, t: number) => rs.filter((r) => (r.hop[v].p[clusters[r.q.target!]] ?? 0) >= t).length;

  console.log(`\n== folder hop over ${folders.length} folder cards: is the target note's folder opened? (${fair.length} queries)`);
  console.log(`   ${"card".padEnd(10)}${KINDS.map((k) => `${k}@0.3`.padEnd(21)).join("")}${[0.5, 0.3, 0.15].map((t) => `all@${t}`.padEnd(10)).join("")}${"open@0.3".padEnd(10)}${"open@0.15".padEnd(11)}${"none@0.15".padEnd(11)}tokens  ms`);
  for (const v of FOLDER_VARIANTS) {
    const byKind = KINDS.map((k) => { const rs = fair.filter((r) => r.q.kind === k); return `${folderHit(rs, v, 0.3)}/${rs.length}`.padEnd(21); }).join("");
    const open = (t: number, rs: FRow[]) => f(mean(rs.map((r) => over(r.hop[v], t).length)), 1);
    console.log(`   ${v.padEnd(10)}${byKind}${[0.5, 0.3, 0.15].map((t) => `${folderHit(fair, v, t)}/${fair.length}`.padEnd(10)).join("")}${open(0.3, fair).padEnd(10)}${open(0.15, fair).padEnd(11)}${open(0.15, none).padEnd(11)}${String(Math.round(mean(frows.map((r) => r.hop[v].tokens)))).padEnd(8)}${Math.round(median(frows.map((r) => r.hop[v].ms)))}`);
    const misses = fair.filter((r) => (r.hop[v].p[clusters[r.q.target!]] ?? 0) < 0.3).sort((a, b) => a.hop[v].p[clusters[a.q.target!]] - b.hop[v].p[clusters[b.q.target!]]);
    for (const r of misses.slice(0, 8)) console.log(`      ${f(r.hop[v].p[clusters[r.q.target!]] ?? 0)}  ${r.q.id.padEnd(6)} ${clusters[r.q.target!].padEnd(22)} ${truncate(r.q.msg, 80)}`);
  }

  console.log(`\n== end to end through folders (full-text threshold ${cfg.recallThreshold})`);
  const line = (name: string, get: (r: FRow) => { picked: string[]; tokens: number; ms: number; judged: number }) => {
    const got = fair.filter((r) => get(r).picked.includes(r.q.target!)).length;
    const tokens = mean(frows.map((r) => get(r).tokens));
    console.log(`   ${name.padEnd(40)} target ${`${got}/${fair.length}`.padEnd(9)} picked ${f(mean(fair.map((r) => get(r).picked.length)), 1).padStart(4)}  full texts read ${f(mean(fair.map((r) => get(r).judged)), 1).padStart(5)}  ${String(Math.round(tokens)).padStart(6)} tokens  $${((tokens / 1e6) * PRICE_PER_M_INPUT).toFixed(5)}/turn  median ${Math.round(median(frows.map((r) => get(r).ms)))} ms`);
  };
  line("flat (production)", (r) => ({ ...r.flat, judged: notes.length }));
  for (const v of FOLDER_VARIANTS) for (const t of FT) {
    line(`${v}@${t} -> full text`, (r) => { const d = r.direct[`${v}@${t}`]; return { picked: d.picked, tokens: r.hop[v].tokens + d.tokens, ms: r.hop[v].ms + d.ms, judged: notes.filter((n) => over(r.hop[v], t).includes(clusters[n.id])).length }; });
  }
  for (const t of FT) {
    line(`listing@${t} -> note cards@0.3 -> full text`, (r) => { const c = r.viaCards[`listing@${t}`]; return { picked: c.judged.picked, tokens: r.hop.listing.tokens + c.hop2.tokens + c.judged.tokens, ms: r.hop.listing.ms + c.hop2.ms + c.judged.ms, judged: over(c.hop2, 0.3).length }; });
  }
  writeFileSync(`${RESULTS_DIR}notes-folders.json`, JSON.stringify(frows.map((r) => ({ q: r.q, hop: Object.fromEntries(FOLDER_VARIANTS.map((v) => [v, r.hop[v]])), direct: r.direct, viaCards: Object.fromEntries(Object.entries(r.viaCards).map(([k, c]) => [k, c.judged])) })), null, 2));
  console.log(`\nraw results: ${RESULTS_DIR}notes-folders.json`);
  process.exit(0);
}

interface Row { q: Query; flat: Judged; hop1: Record<Variant, Routed>; hop2: Record<string, Judged> }
const HOP2: { variant: Variant; t: number }[] = [
  { variant: "card", t: 0.5 }, { variant: "card", t: 0.3 },
  { variant: "card+details", t: 0.5 }, { variant: "card+details", t: 0.3 },
  { variant: "title+details", t: 0.5 }, { variant: "title+details", t: 0.3 },
];
const opened = (r: Routed, t: number) => Object.entries(r.p).filter(([, p]) => p >= t).map(([id]) => id);

console.log(`\nrunning ${queries.length} queries: flat, ${VARIANTS.length} card variants, ${HOP2.length} two-hop settings ...`);
const rows = await pool(queries, 4, async (q): Promise<Row> => {
  const [flat, ...routed] = await Promise.all([judge(q.msg, notes.map((n) => n.id)), ...VARIANTS.map((v) => route(q.msg, v))]);
  const hop1 = Object.fromEntries(VARIANTS.map((v, i) => [v, routed[i]])) as Record<Variant, Routed>;
  const hop2 = Object.fromEntries(await Promise.all(HOP2.map(async ({ variant, t }) => [`${variant}@${t}`, await judge(q.msg, opened(hop1[variant], t))] as const)));
  return { q, flat, hop1, hop2 };
});

const targeted = rows.filter((r) => r.q.target);
const none = rows.filter((r) => !r.q.target);
// A target the full-text baseline does not pick is a bad query, not a routing loss.
const fair = targeted.filter((r) => r.flat.picked.includes(r.q.target!));
console.log(`\nflat (production, full text): target picked in ${fair.length}/${targeted.length} queries; the ${targeted.length - fair.length} it misses are left out below: ${targeted.filter((r) => !fair.includes(r)).map((r) => r.q.id).join(" ") || "-"}`);

const THRESHOLDS = [0.5, 0.3, 0.15];
const hit = (rs: Row[], v: Variant, t: number) => rs.filter((r) => (r.hop1[v].p[r.q.target!] ?? 0) >= t).length;

console.log(`\n== hop 1 over ${notes.length} cards: is the target note opened? (${fair.length} queries)`);
console.log(`   ${"variant".padEnd(15)}${KINDS.map((k) => `${k}@0.5`.padEnd(21)).join("")}${THRESHOLDS.map((t) => `all@${t}`.padEnd(10)).join("")}${"open@0.5".padEnd(10)}${"open@0.3".padEnd(10)}${"none@0.3".padEnd(10)}tokens  ms`);
for (const v of VARIANTS) {
  const byKind = KINDS.map((k) => { const rs = fair.filter((r) => r.q.kind === k); return `${hit(rs, v, 0.5)}/${rs.length}`.padEnd(21); }).join("");
  const all = THRESHOLDS.map((t) => `${hit(fair, v, t)}/${fair.length}`.padEnd(10)).join("");
  const open = (t: number, rs: Row[]) => f(mean(rs.map((r) => opened(r.hop1[v], t).length)), 1).padEnd(10);
  console.log(`   ${v.padEnd(15)}${byKind}${all}${open(0.5, fair)}${open(0.3, fair)}${open(0.3, none)}${String(Math.round(mean(rows.map((r) => r.hop1[v].tokens)))).padEnd(8)}${Math.round(median(rows.map((r) => r.hop1[v].ms)))}`);
}

console.log(`\n== hop 1 by note length and by language, target opened at 0.5`);
for (const v of VARIANTS) {
  const parts: string[] = [];
  for (const len of ["short", "medium", "long"]) { const rs = fair.filter((r) => lengthClass(noteById.get(r.q.target!)!) === len); parts.push(`${len} ${hit(rs, v, 0.5)}/${rs.length}`); }
  for (const lang of ["en", "zh"]) { const rs = fair.filter((r) => r.q.lang === lang); parts.push(`${lang} ${hit(rs, v, 0.5)}/${rs.length}`); }
  console.log(`   ${v.padEnd(15)}${parts.join("   ")}`);
}

console.log(`\n== misses at 0.5 (target p, then the detail the query hinged on)`);
for (const v of VARIANTS.filter((v) => v !== "title")) {
  const misses = fair.filter((r) => (r.hop1[v].p[r.q.target!] ?? 0) < 0.5).sort((a, b) => a.hop1[v].p[a.q.target!] - b.hop1[v].p[b.q.target!]);
  console.log(`   ${v}: ${misses.length}`);
  for (const r of misses.slice(0, 12)) console.log(`      ${f(r.hop1[v].p[r.q.target!])}  ${r.q.id.padEnd(6)} [${lengthClass(noteById.get(r.q.target!)!)}] ${truncate(r.q.msg, 90)}${r.q.detail ? `   <- "${truncate(r.q.detail, 50)}"` : ""}`);
}

console.log(`\n== end to end (full-text threshold ${cfg.recallThreshold}); "picked" is how many notes reach the model`);
function report(name: string, get: (r: Row) => { picked: string[]; tokens: number; ms: number }) {
  const got = fair.filter((r) => get(r).picked.includes(r.q.target!)).length;
  const tokens = mean(rows.map((r) => get(r).tokens));
  console.log(`   ${name.padEnd(30)} target ${`${got}/${fair.length}`.padEnd(9)} picked ${f(mean(fair.map((r) => get(r).picked.length)), 1).padStart(4)}  on "none" ${f(mean(none.map((r) => get(r).picked.length)), 1)}  ${String(Math.round(tokens)).padStart(6)} tokens  $${((tokens / 1e6) * PRICE_PER_M_INPUT).toFixed(5)}/turn  median ${Math.round(median(rows.map((r) => get(r).ms)))} ms`);
}
report("flat (production)", (r) => r.flat);
for (const { variant, t } of HOP2) {
  report(`two-hop ${variant}@${t}`, (r) => { const h = r.hop2[`${variant}@${t}`]; return { picked: h.picked, tokens: r.hop1[variant].tokens + h.tokens, ms: r.hop1[variant].ms + h.ms }; });
}
for (const v of ["card+details", "title+details"] as Variant[]) {
  report(`card only ${v}@0.5`, (r) => ({ picked: opened(r.hop1[v], 0.5), tokens: r.hop1[v].tokens, ms: r.hop1[v].ms }));
}

writeFileSync(`${RESULTS_DIR}notes.json`, JSON.stringify(rows.map((r) => ({ q: r.q, flat: r.flat, hop1: Object.fromEntries(VARIANTS.map((v) => [v, { tokens: r.hop1[v].tokens, target: r.q.target ? r.hop1[v].p[r.q.target] : null, opened: Object.fromEntries(Object.entries(r.hop1[v].p).filter(([, p]) => p >= 0.15)) }])), hop2: r.hop2 })), null, 2));
console.log(`\nraw results: ${RESULTS_DIR}notes.json`);
