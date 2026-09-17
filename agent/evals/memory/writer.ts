// Live check of the note writer itself, the part no Jev eval covers: one note per
// subject, in English, on one line, within the cap; a revision when a known note
// covers the subject, folded into it by the merge writer; no merge across subjects. It runs the production
// writer (Claude Haiku on the agent-sdk backend, else the `memory.writer` model),
// so it costs a few cents and its output varies: the hard checks are shape and
// behavior, the rest is printed for a human to read.   bun run eval:memory:writer
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { truncate } from "../../src/memory/judgments.js";
import { DEFAULT_KNOWLEDGE_NOTE_CHARS } from "../../src/memory/types.js";
import { createFactWriter, type CandidateFact, type KnownNote } from "../../src/memory/writer.js";
import { KNOWLEDGE } from "./data.js";

const config = loadConfig();
const writer = createFactWriter(config);
const maxChars = config.memory?.typesafe?.knowledgeNoteChars ?? DEFAULT_KNOWLEDGE_NOTE_CHARS;
const today = new Date().toISOString().slice(0, 10);
const KNOWN_ID = "00000000-0000-4000-8000-000000000001";

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const cjkShare = (t: string) => (t.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g) ?? []).length / Math.max(1, t.replace(/\s/g, "").length);
const shape = (n: CandidateFact) => `${words(n.text)} words, ${n.text.length} chars${n.revises ? ", revises" : ""}`;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};
const results: Record<string, unknown> = {};

console.log(`writer: ${writer.name}, cap ${maxChars} chars, today ${today}\n`);

// --- one note per subject ---
const byCase: Record<string, CandidateFact[]> = {};
for (const c of KNOWLEDGE.filter((k) => k.save)) {
  const notes = await writer.writeKnowledge({ userMessages: [c.request], assistantReply: c.reply, sources: [], maxChars, today });
  byCase[c.id] = notes;
  results[c.id] = notes;
  console.log(`${c.id}  ${c.note}: ${notes.length} note${notes.length === 1 ? "" : "s"}  [${notes.map(shape).join(" | ")}]`);
  for (const n of notes) console.log(`      ${truncate(n.text, 140)}`);
  if (notes.length !== 1) console.log(`  note: one subject, expected one note, got ${notes.length}`);
  for (const n of notes) {
    if (n.text.includes("\n")) fail(`${c.id}: a note has a line break`);
    if (n.text.length > maxChars) fail(`${c.id}: a note is over the cap`);
    if (cjkShare(n.text) > 0.1) fail(`${c.id}: a note is not in English`);
    if (n.revises) fail(`${c.id}: revises with no known notes`);
    if (words(n.text) < 40) console.log(`  note: ${c.id} is short for a paragraph note (${words(n.text)} words)`);
  }
}

// --- revising a known note ---
const k01 = byCase.K01?.[0];
if (!k01) fail("K01 produced no note, so the revision and merge checks were skipped");
else {
  const known: KnownNote[] = [{ id: KNOWN_ID, text: k01.text }];
  const notes = await writer.writeKnowledge({
    userMessages: ["How do the batteries compare between the Series 11 and the Ultra 3, and does either support fast charging?"],
    assistantReply:
      "The Series 11 is rated for 24 hours, about 36 in Low Power Mode, and the Ultra 3 for 42 hours, up to 72 in Low Power Mode. Both support fast charging: roughly 80% in about 30 minutes with the fast charger. So the Ultra 3 nearly doubles the Series 11 on battery, and neither makes you wait long at the charger.",
    sources: [],
    knownNotes: known,
    maxChars,
    today,
  });
  results.revision = notes;
  console.log(`\nrevision  ${notes.length} note${notes.length === 1 ? "" : "s"}  [${notes.map(shape).join(" | ")}]`);
  for (const n of notes) console.log(`      ${truncate(n.text, 140)}`);
  if (notes.length !== 1) fail(`revision: expected one item, got ${notes.length}`);
  const r = notes[0];
  if (r && r.revises !== KNOWN_ID) fail("revision: the item does not name the known note");
  if (r && !/42/.test(r.text)) fail("revision: the new battery figure is missing");

  // --- folding the revision into the known note, as the pipeline does ---
  if (r) {
    const same = await writer.mergeKnowledge({ existing: k01.text, addition: r.text, maxChars, today });
    results.mergeSame = same;
    console.log(`\nmerge, revision into the known note: merged=${same.merged}${same.merged ? `, ${words(same.text)} words` : ""}`);
    if (same.merged) console.log(`      ${truncate(same.text, 140)}`);
    if (!same.merged) fail("merge: the battery update was not folded into the lineup note");
    if (same.merged && !/42/.test(same.text)) fail("merge: the new battery figure is missing");
    if (same.merged && !same.text.includes("$399")) fail("merge: the existing note's price was dropped");
    if (same.text.includes("\n") || same.text.length > maxChars) fail("merge: shape");
  }

  const other = byCase.K02?.[0];
  if (other) {
    const different = await writer.mergeKnowledge({ existing: k01.text, addition: other.text, maxChars, today });
    results.mergeDifferent = different;
    console.log(`merge, different subjects: merged=${different.merged}`);
    if (different.merged) fail("merge: the Apple Watch note and the CRDT note were merged");
  }
}

// --- a smaller cap changes the guidance and the output ---
const k04 = KNOWLEDGE.find((k) => k.id === "K04")!;
const small = await writer.writeKnowledge({ userMessages: [k04.request], assistantReply: k04.reply, sources: [], maxChars: 1200, today });
results.smallCap = small;
console.log(`\nK04 at a 1200-char cap: [${small.map(shape).join(" | ")}]  (at ${maxChars}: [${(byCase.K04 ?? []).map(shape).join(" | ")}])`);
for (const n of small) if (n.text.length > 1200) fail("small cap: a note is over 1200 chars");

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/writer.json", import.meta.url), JSON.stringify({ writer: writer.name, maxChars, results }, null, 1));
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll writer checks passed.");
