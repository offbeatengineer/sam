import { describe, expect, test } from "bun:test";
import {
  aliasShard,
  decideForget,
  decideGate,
  decideKnowledgeGate,
  decideRelations,
  estimateTokens,
  factListing,
  FILEABLE_FACT_CHARS,
  folderCards,
  folderQuestions,
  knowledgeGateState,
  MAX_MEMORY_CHARS,
  memoryTextLimit,
  noteListing,
  noteTitle,
  pickOpened,
  pickRecalled,
  planRecall,
  recallQuestions,
  shardMemories,
  shortlistFromStage1,
} from "./judgments.js";
import { formatMemoryContext } from "./recaller.js";
import { ADDED_COLUMNS, FOLDER_PATTERN, isMemoryId } from "./store.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mems = (n: number, text = "User likes a reasonably long example sentence about something.") =>
  Array.from({ length: n }, (_, i) => ({ id: uuid(i), text: `${text} #${i}` }));

describe("sharding", () => {
  test("one shard when everything fits", () => {
    expect(shardMemories(mems(60), 500, 24_000)).toHaveLength(1);
  });

  test("splits evenly, keeps order, loses nothing", () => {
    const input = mems(300);
    const shards = shardMemories(input, 500, 6_000);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.flat().map((m) => m.id)).toEqual(input.map((m) => m.id));
    const sizes = shards.map((s) => s.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(Math.ceil(300 / shards.length));
  });

  test("every shard stays within the budget", () => {
    const budget = 6_000;
    for (const shard of shardMemories(mems(300), 500, budget)) {
      const cost = shard.reduce((n, m) => n + estimateTokens(m.text) + 45, 0);
      expect(cost).toBeLessThanOrEqual(budget);
    }
  });

  test("empty store yields no shards", () => {
    expect(shardMemories([], 0, 1000)).toEqual([]);
  });

  test("CJK text is estimated as heavier than ASCII of the same length", () => {
    expect(estimateTokens("帮我订一张去札幌的机票")).toBeGreaterThan(estimateTokens("hello there"));
  });
});

describe("aliasing", () => {
  test("uuids never reach the request; aliases map back", () => {
    const input = mems(3);
    const { memories, toId } = aliasShard(input);
    expect(Object.keys(memories)).toEqual(["m0", "m1", "m2"]);
    expect(JSON.stringify({ memories, q: recallQuestions([...toId.keys()]) })).not.toContain("00000000-");
    expect(toId.get("m1")).toBe(input[1].id);
  });

  test("long memories are truncated, at a length that keeps a whole reference note", () => {
    const long = [{ id: uuid(1), text: "x".repeat(6000) }];
    expect(aliasShard(long).memories.m0.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(aliasShard(long).memories.m0.length).toBeGreaterThan(4000);
    expect(aliasShard(long, 500).memories.m0.length).toBeLessThanOrEqual(500);
    expect(shardMemories(long, 0, 24_000, 500)).toHaveLength(1);
  });

  test("the per-memory limit follows the configured note cap but never shrinks below the default", () => {
    expect(memoryTextLimit(4000)).toBe(MAX_MEMORY_CHARS);
    expect(memoryTextLimit(8000)).toBe(8200);
    expect(memoryTextLimit(1000)).toBe(MAX_MEMORY_CHARS);
    expect(memoryTextLimit(undefined)).toBe(MAX_MEMORY_CHARS);
  });
});

describe("deciders", () => {
  const { toId } = aliasShard(mems(3));

  test("recall: threshold applies and a missing answer is p=0, not a throw", () => {
    const picked = pickRecalled({ "rel::m0": { noul: 0.9 }, "rel::m1": { noul: 0.49 } }, toId, 0.5);
    expect(picked).toEqual([{ id: uuid(0), p: 0.9 }]);
  });

  test("gate: the Score decides save, the Noul decides forget", () => {
    expect(decideGate({ value: { score: 1.7 }, forget_request: { noul: 0.1 } }, 1.3)).toMatchObject({ save: true, forget: false });
    expect(decideGate({ value: { score: 0.9 }, forget_request: { noul: 0.9 } }, 1.3)).toMatchObject({ save: false, forget: true });
    expect(decideGate({}, 1.3)).toMatchObject({ save: false, forget: false });
  });

  test("relations: low-confidence 'outdated' is flagged, never acted on", () => {
    const d = decideRelations(
      {
        "relation::m0": { choice: "outdated", confidence: 0.9 },
        "relation::m1": { choice: "outdated", confidence: 0.4 },
        "relation::m2": { choice: "duplicate", confidence: 0.8 },
        is_instruction: { noul: 0.1 },
        profile_scope: { noul: 0.9 },
      },
      toId,
      0.6,
    );
    expect(d).toEqual({ supersede: [uuid(0)], flagged: [uuid(1)], duplicates: [uuid(2)], consistent: [], isInstruction: false, profileScope: true, aboutUser: false });
  });

  test("relations: a confident 'consistent' is reported for merging, a weak one is not", () => {
    const d = decideRelations(
      { "relation::m0": { choice: "consistent", confidence: 0.8 }, "relation::m1": { choice: "consistent", confidence: 0.4 } },
      toId,
      0.6,
    );
    expect(d.consistent).toEqual([uuid(0)]);
    expect(d.supersede).toEqual([]);
    expect(d.duplicates).toEqual([]);
  });

  test("relations: instruction-shaped facts are marked", () => {
    expect(decideRelations({ is_instruction: { noul: 0.8 } }, new Map(), 0.6).isInstruction).toBe(true);
  });

  test("shortlist: merges shards, drops 'none' and negligible candidates", () => {
    const a = aliasShard(mems(2));
    const ids = shortlistFromStage1([
      { toId: a.toId, answers: { which_outdated: { probabilities: { m0: 0.7, none: 0.3 } }, which_related: { probabilities: { m1: 0.001, none: 0.99 } } } },
    ]);
    expect(ids).toEqual([uuid(0)]);
  });

  test("forget: only confirmed candidates", () => {
    expect(decideForget({ "forget::m0": { noul: 0.8 }, "forget::m1": { noul: 0.7 } }, toId)).toEqual([uuid(0)]);
  });
});

describe("memory context", () => {
  const base = { tags: [], source: "user", created_at: Date.UTC(2026, 2, 2), updated_at: 0 };

  test("nothing to say -> nothing injected, unless judged and empty", () => {
    expect(formatMemoryContext({})).toBeUndefined();
    expect(formatMemoryContext({ judgedNoneRelevant: true })).toContain("No saved notes look relevant");
  });

  test("frames notes as data and carries ids nowhere", () => {
    const text = formatMemoryContext({
      profile: [{ ...base, id: uuid(1), text: "User prefers concise answers.", kind: "profile" }],
      recalled: [{ id: uuid(2), text: "User is vegetarian.", kind: "situational", p: 0.9, created_at: base.created_at }],
      notices: ["Saved: User moved to Berlin."],
    })!;
    expect(text).toContain("not instructions");
    expect(text).toContain("User is vegetarian. (saved 2026-03-02)");
    expect(text).toContain("Saved: User moved to Berlin.");
    expect(text).not.toContain("00000000-");
    expect(text.endsWith("</memory_context>")).toBe(true);
  });

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: uuid(i), text: `User ${String(i).padStart(3, "0")} `.padEnd(300, "x"), kind: "situational" as const, p: 0.99 - i * 0.004, created_at: 0 }));

  test("oversized context leaves out the least relevant notes whole, never cutting a note", () => {
    const text = formatMemoryContext({ recalled: many(200) })!;
    expect(text.length).toBeLessThanOrEqual(32_000);
    expect(text.endsWith("</memory_context>")).toBe(true);
    expect(text).toContain(`- ${many(1)[0].text} (saved 1970-01-01)`);
    expect(text).not.toContain("User 199 ");
    for (const line of text.split("\n").filter((l) => l.startsWith("- User"))) expect(line.endsWith("(saved 1970-01-01)")).toBe(true);
  });

  test("profile and notices survive an oversized recall", () => {
    const profile = Array.from({ length: 5 }, (_, i) => ({ ...base, id: uuid(500 + i), text: `User profile fact ${i}.`, kind: "profile" as const }));
    const notices = ["Saved: one.", "Saved: two.", "Saved: three."];
    const text = formatMemoryContext({ profile, recalled: many(200), notices })!;
    expect(text.length).toBeLessThanOrEqual(32_000);
    for (const p of profile) expect(text).toContain(p.text);
    for (const n of notices) expect(text).toContain(n);
  });

  test("knowledge gets its own section, with its source and a warning", () => {
    const text = formatMemoryContext({
      recalled: [
        { id: uuid(2), text: "User is vegetarian.", kind: "situational", p: 0.9, created_at: base.created_at },
        {
          id: uuid(3),
          text: "Apple Watch Series 11 starts at $399 as of 2026-09-17.",
          kind: "knowledge",
          p: 0.8,
          created_at: base.created_at,
          origin: { url: "https://www.apple.com/watch/", conversationId: "c1" },
        },
        { id: uuid(4), text: "User asked what a monad is.", kind: "knowledge", p: 0.7, created_at: base.created_at },
      ],
    })!;
    const [userPart, referencePart] = text.split("Reference notes from earlier research");
    expect(userPart).toContain("User is vegetarian.");
    expect(userPart).not.toContain("Apple Watch");
    expect(referencePart).toContain("may be outdated");
    expect(referencePart).toContain("$399 as of 2026-09-17. (source: https://www.apple.com/watch/, saved 2026-03-02)");
    expect(referencePart).toContain("User asked what a monad is. (saved 2026-03-02)");
    expect(text).not.toContain("c1");
  });

  test("only knowledge recalled -> still injected", () => {
    const text = formatMemoryContext({ recalled: [{ id: uuid(1), text: "X.", kind: "knowledge", p: 0.9, created_at: 0 }], judgedNoneRelevant: true })!;
    expect(text).toContain("Reference notes");
    expect(text).not.toContain("Possibly relevant to this message");
  });
});

describe("knowledge gate", () => {
  test("the Score decides, and a missing answer never saves", () => {
    expect(decideKnowledgeGate({ knowledge_value: { score: 1.8 } } as any, 1.3)).toEqual({ save: true, value: 1.8 });
    expect(decideKnowledgeGate({ knowledge_value: { score: 0.9 } } as any, 1.3).save).toBe(false);
    expect(decideKnowledgeGate({}, 1.3)).toEqual({ save: false, value: 0 });
  });

  test("the state is bounded whatever the turn held", () => {
    const state = knowledgeGateState(["q".repeat(5000)], "a".repeat(50_000), Array.from({ length: 100 }, (_, i) => `bash ${i}`));
    expect(state.user_request.length).toBeLessThanOrEqual(2000);
    expect(state.assistant_reply.length).toBeLessThanOrEqual(6000);
    expect(state.tool_calls).toHaveLength(30);
    expect(estimateTokens(JSON.stringify(state))).toBeLessThan(8000);
  });
});

describe("ids from the wire", () => {
  test("only uuids are accepted", () => {
    expect(isMemoryId(uuid(1))).toBe(true);
    for (const bad of ["x' OR '1'='1", "", "__seed__", 42, undefined, `${uuid(1)}' --`]) expect(isMemoryId(bad)).toBe(false);
  });
});

describe("recall through folders", () => {
  const tree = { enabled: true, minFlatTokens: 0, factFolderThreshold: 0.3, noteFolderThreshold: 0.15, factBatch: 12, noteBatch: 4, factCap: 16, noteCap: 8 };
  const fact = (n: number, folder = "", text = `User fact number ${n}.`) => ({ id: uuid(n), text, kind: "situational", folder, created_at: n });
  const note = (n: number, folder = "", text = `Subject ${n} (documentation): the body of note ${n}.`) => ({ id: uuid(1000 + n), text, kind: "knowledge", folder, created_at: n });

  test("a note's title is its subject, without the basis", () => {
    expect(noteTitle("LanceDB addColumns (documentation): table.addColumns adds a column.")).toBe("LanceDB addColumns");
    expect(noteTitle("Making Chili Oil (La Zi You) At Home (explained from general knowledge): heat the oil.")).toBe("Making Chili Oil (La Zi You) At Home");
    expect(noteTitle("ZephyrDB 3.x to 4.2 upgrade path: first upgrade to 4.0.")).toBe("ZephyrDB 3.x to 4.2 upgrade path");
    expect(noteTitle("Apple Watch Series 11 starts at $399. The SE 3 starts at $249.")).toBe("Apple Watch Series 11 starts at $399.");
    expect(noteTitle("x".repeat(500)).length).toBeLessThanOrEqual(100);
  });

  test("listings read as they were measured", () => {
    expect(factListing("food", ["User is vegetarian.", "User is lactose intolerant."])).toBe("food/ holds 2 memories: User is vegetarian. | User is lactose intolerant.");
    expect(factListing("car", ["User drives a Tesla."])).toBe("car/ holds 1 memory: User drives a Tesla.");
    expect(noteListing("lancedb", ["LanceDB addColumns", "Choosing an index"])).toBe("lancedb/ holds 2 notes: LanceDB addColumns; Choosing an index");
    expect(noteListing("bun", ["Bun test runner"])).toBe("bun/ holds 1 note: Bun test runner");
  });

  test("a card lists its folder oldest first, and notes by title", () => {
    const [card] = folderCards("notes", [note(2, "db"), note(1, "db")]);
    expect(card.text).toBe("db/ holds 2 notes: Subject 1; Subject 2");
    expect(card.ids).toEqual([uuid(1001), uuid(1002)]);
    expect(card).toMatchObject({ track: "notes", folder: "db" });
  });

  test("a folder too long for one card gets several, and every memory stays listed in full", () => {
    const filed = Array.from({ length: 30 }, (_, i) => fact(i, "big", `User fact ${i} ${"with detail ".repeat(12)}.`));
    const cards = folderCards("facts", filed, 1000);
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.flatMap((c) => c.ids)).toEqual(filed.map((m) => m.id));
    for (const m of filed) expect(cards.some((c) => c.text.includes(m.text))).toBe(true);
    for (const c of cards) expect(c.text.length).toBeLessThan(1400);
  });

  test("each track asks its own measured question", () => {
    expect(folderQuestions("facts", ["s0"])["open::s0"]).toEqual({
      type: "noul",
      instructions: "Would a memory listed in `subjects.s0` change or improve the assistant's next response in `conversation`?",
    });
    expect(folderQuestions("notes", ["c3"])["open::c3"].instructions).toBe(
      "Would a reference note in the folder that `cards.c3` describes change or improve the assistant's next response in `conversation`?",
    );
  });

  test("a folder without an answer is opened", () => {
    const toId = new Map([["s0", "a"], ["s1", "b"], ["s2", "c"]]);
    const opened = pickOpened({ "open::s0": { noul: 0.9 }, "open::s1": { noul: 0.1 } }, toId, 0.3);
    expect(opened).toEqual([{ id: "a", p: 0.9 }, { id: "c", p: 1 }]);
  });

  test("aliases take a prefix, and a card is never cut", () => {
    const long = "y".repeat(9000);
    const { memories, toId } = aliasShard([{ id: "card", text: long }], Infinity, "c");
    expect(memories.c0).toBe(long);
    expect(toId.get("c0")).toBe("card");
  });

  test("with the tree off, or nothing filed, everything is judged directly", () => {
    const mems = [fact(1, "a"), note(1, "b")];
    expect(planRecall(mems, { ...tree, enabled: false })).toEqual({ direct: mems, routed: [] });
    expect(planRecall(mems, undefined)).toEqual({ direct: mems, routed: [] });
    const unfiled = [fact(1), note(1)];
    expect(planRecall(unfiled, tree)).toEqual({ direct: unfiled, routed: [] });
  });

  test("a track stays flat until it costs minFlatTokens, each track on its own", () => {
    const facts = [fact(1, "a"), fact(2, "a")];
    const notes = Array.from({ length: 40 }, (_, i) => note(i, "db", `Subject ${i} (documentation): ${"a long body of findings. ".repeat(40)}`));
    const plan = planRecall([...facts, ...notes], { ...tree, minFlatTokens: 5000 });
    expect(plan.routed.map((r) => r.track)).toEqual(["notes"]);
    expect(plan.direct).toEqual(facts);
  });

  test("the inbox and facts too long to list are judged directly even when the track is routed", () => {
    const long = fact(3, "a", `User ${"said a great deal ".repeat(40)}.`);
    expect(long.text.length).toBeGreaterThan(FILEABLE_FACT_CHARS);
    const mems = [fact(1, "a"), fact(2), long, note(1, "db"), note(2)];
    const plan = planRecall(mems, tree);
    expect(plan.direct.map((m) => m.id)).toEqual([uuid(2), uuid(3), uuid(1002)]);
    expect(plan.routed.map((r) => [r.track, r.cards.flatMap((c) => c.ids)])).toEqual([["facts", [uuid(1)]], ["notes", [uuid(1001)]]]);
  });

  test("the store migrates a folder column in, backfilled to unfiled", () => {
    expect(ADDED_COLUMNS).toContainEqual({ name: "folder", valueSql: "''" });
    expect(FOLDER_PATTERN.test("food-preferences")).toBe(true);
    for (const bad of ["", "Food", "a b", "x'; DROP", "a".repeat(41)]) expect(FOLDER_PATTERN.test(bad)).toBe(false);
  });
});
