import { describe, expect, test } from "bun:test";
import { MemoryRecaller } from "./recaller.js";
import type { ActiveMemory } from "./store.js";
import { TypeSafeRequestError } from "./typesafe.js";

// The recaller against a fake Jev: no network. What is under test is the routing:
// which memories are judged directly, which only after their folder opens, and
// what a failure in either hop leaves the turn with.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tree = { enabled: true, minFlatTokens: 0, factFolderThreshold: 0.3, noteFolderThreshold: 0.15, factBatch: 12, noteBatch: 4, factCap: 16, noteCap: 8 };
const cfg = (over: Record<string, unknown> = {}) =>
  ({ timeoutMs: 2500, recallThreshold: 0.5, maxRecalled: 8, shardTokenBudget: 24_000, maxShards: 4, knowledgeNoteChars: 4000, tree, ...over }) as any;

const fact = (n: number, text: string, folder = ""): ActiveMemory => ({ id: uuid(n), text, tags: [], source: "auto", created_at: n, updated_at: n, kind: "situational", folder });
const note = (n: number, text: string, folder = ""): ActiveMemory => ({ ...fact(n, text, folder), kind: "knowledge" });

interface Script {
  /** p for a folder card whose listing contains this. */
  open?: Record<string, number>;
  /** p for a memory whose text contains this. */
  relevant?: Record<string, number>;
  /** Runs before a request is answered; may throw or wait. */
  before?: (state: any) => Promise<void> | void;
}

function fakeClient(script: Script) {
  const asked: { state: any; keys: string[] }[] = [];
  const match = (table: Record<string, number> | undefined, text: string) => Object.entries(table ?? {}).find(([needle]) => text.includes(needle))?.[1];
  return {
    asked,
    available: true,
    async ask(state: any, questions: Record<string, unknown>) {
      asked.push({ state, keys: Object.keys(questions) });
      await script.before?.(state);
      const answers: Record<string, any> = {};
      for (const key of Object.keys(questions)) {
        if (key.startsWith("open::")) {
          const alias = key.slice(6);
          answers[key] = { noul: match(script.open, (state.subjects ?? state.cards)[alias]) ?? 0 };
        } else answers[key] = { noul: match(script.relevant, state.memories[key.slice(5)]) ?? 0 };
      }
      return { answers, usage: { input_tokens: 100 }, ms: 1, model: "fake" };
    },
  };
}

const conversation = [{ role: "user" as const, text: "Recommend a dessert for tonight." }];
const memoriesSent = (asked: { state: any }[]) => asked.flatMap((a) => Object.values(a.state.memories ?? {}) as string[]);

const STORE = [
  fact(1, "User is vegetarian.", "food"),
  fact(2, "User is lactose intolerant.", "food"),
  fact(3, "User drives a Tesla Model 3.", "car"),
  fact(4, "User just adopted a corgi."), // unfiled
  note(11, "LanceDB compaction (documentation): small files raise S3 request costs.", "lancedb"),
  note(12, "Dairy-free desserts (explained from general knowledge): coconut cream whips like dairy cream.", "cooking"),
];

describe("flat recall", () => {
  test("a store below minFlatTokens is judged exactly as before: one request, every memory, no folders", async () => {
    const client = fakeClient({ relevant: { "lactose": 0.9 } });
    const outcome = await new MemoryRecaller(client as any, cfg({ tree: { ...tree, minFlatTokens: 12_000 } })).recall(conversation, STORE);
    expect(client.asked).toHaveLength(1);
    expect(Object.keys(client.asked[0].state).sort()).toEqual(["conversation", "memories"]);
    expect(client.asked[0].keys).toEqual(STORE.map((_, i) => `rel::m${i}`));
    expect(outcome).toMatchObject({ status: "ok", shards: 1 });
    expect(outcome.routing).toBeUndefined();
    expect(outcome.picked.map((m) => m.id)).toEqual([uuid(2)]);
  });

  test("memories without a folder, as the evals pass them, take the flat path even with the tree on", async () => {
    const client = fakeClient({});
    const rows = STORE.map(({ folder: _folder, ...m }) => m);
    await new MemoryRecaller(client as any, cfg()).recall(conversation, rows);
    expect(client.asked).toHaveLength(1);
    expect(client.asked[0].state.memories).toBeDefined();
  });
});

describe("recall through folders", () => {
  test("each track's folders are judged in their own request, under the track's own key", async () => {
    const client = fakeClient({});
    await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    const hop1 = client.asked.filter((a) => a.keys[0].startsWith("open::"));
    expect(hop1.map((a) => Object.keys(a.state).sort())).toEqual([["conversation", "subjects"], ["cards", "conversation"]]);
    expect(Object.values(hop1[0].state.subjects)).toEqual(["food/ holds 2 memories: User is vegetarian. | User is lactose intolerant.", "car/ holds 1 memory: User drives a Tesla Model 3."]);
    expect(Object.values(hop1[1].state.cards)).toEqual(["lancedb/ holds 1 note: LanceDB compaction", "cooking/ holds 1 note: Dairy-free desserts"]);
  });

  test("only what is in an opened folder is sent, and the unfiled memory always is", async () => {
    const client = fakeClient({ open: { "food/": 0.8, "cooking/": 0.2, "car/": 0.29, "lancedb/": 0.1 }, relevant: { lactose: 0.9, "Dairy-free": 0.7, corgi: 0.1 } });
    const outcome = await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    const sent = memoriesSent(client.asked);
    expect(sent.sort()).toEqual([STORE[0].text, STORE[1].text, STORE[3].text, STORE[5].text].sort());
    expect(sent).not.toContain(STORE[2].text); // car: 0.29 is under the facts threshold
    expect(sent).not.toContain(STORE[4].text); // lancedb: 0.1 is under the notes threshold
    expect(outcome.status).toBe("ok");
    expect(outcome.picked.map((m) => m.id)).toEqual([uuid(2), uuid(12)]);
    expect(outcome.routing).toMatchObject({ folders: 4, judged: 4, opened: [{ track: "facts", folder: "food", p: 0.8 }, { track: "notes", folder: "cooking", p: 0.2 }] });
    expect(outcome.shards).toBe(4); // unfiled + two folder requests + the opened folders
  });

  test("the notes threshold is lower than the facts threshold", async () => {
    const client = fakeClient({ open: { "car/": 0.2, "lancedb/": 0.2 } });
    await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    const sent = memoriesSent(client.asked);
    expect(sent).toContain(STORE[4].text);
    expect(sent).not.toContain(STORE[2].text);
  });

  test("when no folder opens there is no second hop", async () => {
    const client = fakeClient({ relevant: { corgi: 0.8 } });
    const outcome = await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    expect(client.asked).toHaveLength(3); // the unfiled memory and one request per track
    expect(outcome).toMatchObject({ status: "ok", routing: { opened: [], judged: 1 } });
    expect(outcome.picked.map((m) => m.id)).toEqual([uuid(4)]);
  });

  test("the unfiled memories are judged while the folders are being chosen, not after", async () => {
    const order: string[] = [];
    const client = fakeClient({
      open: { "food/": 0.9 },
      before: async (state) => {
        order.push(state.memories ? `memories:${Object.keys(state.memories).length}` : "folders");
        if (!state.memories) await new Promise((r) => setTimeout(r, 20));
      },
    });
    await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    expect(order.slice(0, 3).sort()).toEqual(["folders", "folders", "memories:1"]);
    expect(order[3]).toBe("memories:2");
  });

  test("a track whose folders cannot be judged costs only that track: the rest is used and the outcome says degraded", async () => {
    const client = fakeClient({
      open: { "cooking/": 0.9 },
      relevant: { corgi: 0.8, "Dairy-free": 0.7 },
      before: (state) => {
        if (state.subjects) throw new Error("boom");
      },
    });
    const outcome = await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("error");
    expect(outcome.picked.map((m) => m.id).sort()).toEqual([uuid(4), uuid(12)].sort());
  });

  test("when nothing could be judged the outcome is degraded and empty", async () => {
    const client = fakeClient({ before: () => { throw new Error("down"); } });
    const outcome = await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    expect(outcome).toMatchObject({ status: "degraded", reason: "error", picked: [] });
  });

  test("with too little time left the second hop is not sent", async () => {
    const client = fakeClient({
      open: { "food/": 0.9 },
      relevant: { corgi: 0.8, lactose: 0.9 },
      before: async (state) => {
        if (!state.memories) await new Promise((r) => setTimeout(r, 120));
      },
    });
    const outcome = await new MemoryRecaller(client as any, cfg({ timeoutMs: 450 })).recall(conversation, STORE);
    expect(client.asked.filter((a) => a.state.memories)).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "degraded", reason: "timeout" });
    expect(outcome.picked.map((m) => m.id)).toEqual([uuid(4)]);
  });

  test("a folder request rejected as too large is halved once", async () => {
    let rejected = false;
    const client = fakeClient({
      open: { "food/": 0.9, "car/": 0.9 },
      before: (state) => {
        if (state.subjects && Object.keys(state.subjects).length > 1 && !rejected) {
          rejected = true;
          throw new TypeSafeRequestError(413, "too large");
        }
      },
    });
    const outcome = await new MemoryRecaller(client as any, cfg()).recall(conversation, STORE);
    expect(outcome.status).toBe("ok");
    expect(outcome.routing?.opened.map((f) => f.folder).sort()).toEqual(["car", "food"]);
  });

  test("the likeliest folders are judged first, and the best picks of both hops are kept", async () => {
    const many = Array.from({ length: 12 }, (_, i) => fact(100 + i, `User likes thing number ${i}.`, i < 6 ? "likes-a" : "likes-b"));
    const client = fakeClient({ open: { "likes-a/": 0.4, "likes-b/": 0.9 }, relevant: { "thing number": 0.6, corgi: 0.95 } });
    const outcome = await new MemoryRecaller(client as any, cfg({ maxRecalled: 5 })).recall(conversation, [...many, STORE[3]]);
    const hop2 = client.asked.find((a) => a.state.memories && Object.keys(a.state.memories).length > 1)!;
    expect(Object.values(hop2.state.memories)[0]).toBe("User likes thing number 6.");
    expect(outcome.picked).toHaveLength(5);
    expect(outcome.picked[0].id).toBe(uuid(4));
  });
});
