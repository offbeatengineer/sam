// Edge probes: conversational context, cross-lingual recall, and the write path (select vs generate).
import { ask, f, type Q } from "./typesafe";
import { MEMORIES } from "./data";

const ids = Object.keys(MEMORIES);
const noulQ: Record<string, Q> = Object.fromEntries(
  ids.map((id) => [`rel::${id}`, { type: "noul", instructions: `Would \`memories.${id}\` change or improve the assistant's next response in \`conversation\`?` } as Q]),
);

const CONV: { id: string; expect: string[]; conversation: { role: string; text: string }[] }[] = [
  { id: "C1 multi-turn", expect: ["M03", "M04"], conversation: [
    { role: "user", text: "I'm thinking about plans for Friday night." },
    { role: "assistant", text: "Nice. Any occasion?" },
    { role: "user", text: "Just a date night with Lin. Go ahead and pick somewhere." } ] },
  { id: "C2 anaphora", expect: ["M08"], conversation: [
    { role: "user", text: "Should I switch editors?" },
    { role: "assistant", text: "What's bothering you about the current one?" },
    { role: "user", text: "It keeps crashing." } ] },
  { id: "C3 chinese", expect: ["M18", "M45", "M46"], conversation: [{ role: "user", text: "帮我订一张去札幌的机票。" }] },
  { id: "C4 chinese", expect: ["M03", "M04"], conversation: [{ role: "user", text: "周五晚上想和Lin出去吃饭，帮我找个地方。" }] },
  { id: "C5 topic shift", expect: [], conversation: [
    { role: "user", text: "Can you find a nice place for dinner with Lin on Friday?" },
    { role: "assistant", text: "Booked: a vegetarian-friendly Sichuan place in Jing'an, 7pm, no shellfish dishes." },
    { role: "user", text: "Great. Unrelated: how do I squash the last three commits?" } ] },
];

console.log("=== conversational / cross-lingual recall ===");
for (const c of CONV) {
  const r = await ask({ conversation: c.conversation, memories: MEMORIES }, noulQ);
  const picked = ids.map((id) => ({ id, p: r.answers[`rel::${id}`].noul as number })).filter((x) => x.p >= 0.5).sort((a, b) => b.p - a.p);
  console.log(`${c.id}: expect ${c.expect.join(",") || "-"}  ->  ${picked.map((x) => `${x.id}(${f(x.p)})`).join(" ") || "-"}   ${f(r.ms, 0)}ms`);
}

// ---- write path: Jev cannot write a memory, only judge candidate text ----
console.log("\n=== write path: can a verbatim span be stored as-is? ===");
const SPANS = [
  { text: "I moved to Berlin last month.", standalone: true },
  { text: "Yeah, the second one.", standalone: false },
  { text: "She's allergic to shellfish.", standalone: false },
  { text: "We decided to drop Discord support in Sam because nobody uses it.", standalone: true },
  { text: "It keeps crashing.", standalone: false },
  { text: "My manager Priya runs our 1:1 on Tuesdays at 10am.", standalone: true },
  { text: "Let's go with that for the blog too.", standalone: false },
];
for (const s of SPANS) {
  const r = await ask({ sentence: s.text }, {
    standalone: {
      type: "noul",
      instructions: "Could a reader who has not seen the rest of the conversation fully understand who and what `sentence` refers to?",
      criteria: { true: "Every person, thing, and choice it mentions is named or otherwise identifiable from the sentence alone", false: "It relies on pronouns or references ('she', 'it', 'that', 'the second one') whose meaning is only clear from earlier context" },
    },
  });
  const p = r.answers.standalone.noul as number;
  console.log(`  ${(p >= 0.5) === s.standalone ? "ok" : "XX"}  standalone=${f(p)}  (gold ${s.standalone})  "${s.text}"`);
}
