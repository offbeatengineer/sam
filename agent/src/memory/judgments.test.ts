import { describe, expect, test } from "bun:test";
import {
  aliasShard,
  decideForget,
  decideGate,
  decideKnowledgeGate,
  decideRelations,
  estimateTokens,
  knowledgeGateState,
  pickRecalled,
  recallQuestions,
  shardMemories,
  shortlistFromStage1,
} from "./judgments.js";
import { formatMemoryContext } from "./recaller.js";
import { isMemoryId } from "./store.js";

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

  test("long memories are truncated", () => {
    const { memories } = aliasShard([{ id: uuid(1), text: "x".repeat(2000) }]);
    expect(memories.m0.length).toBeLessThanOrEqual(400);
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
    expect(d).toEqual({ supersede: [uuid(0)], flagged: [uuid(1)], duplicates: [uuid(2)], isInstruction: false, profileScope: true, aboutUser: false });
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

  test("oversized context is cut but stays well-formed", () => {
    const recalled = Array.from({ length: 80 }, (_, i) => ({ id: uuid(i), text: "User ".padEnd(300, "x"), kind: "situational" as const, p: 0.9, created_at: 0 }));
    const text = formatMemoryContext({ recalled })!;
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text.endsWith("</memory_context>")).toBe(true);
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
