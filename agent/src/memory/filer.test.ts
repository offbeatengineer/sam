import { describe, expect, test } from "bun:test";
import { foldersOf, inboxOf, MemoryFiler, nextWork, renderFolderLine } from "./filer.js";
import { FILEABLE_FACT_CHARS } from "./judgments.js";
import type { ActiveMemory } from "./store.js";
import {
  normalizeFiling,
  normalizeSplit,
  renderFilingRequest,
  slugFolder,
  type FilingAssignment,
  type FilingRequest,
  type MemoryFilingWriter,
  type SplitGroup,
  type SplitRequest,
} from "./writer.js";

// Filing against fakes. What matters: it only ever writes folders, only for the
// memories it was asked about, never across the two tracks, and a failure leaves
// the store exactly as it was.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cfg = { enabled: true, minFlatTokens: 12_000, factFolderThreshold: 0.3, noteFolderThreshold: 0.15, factBatch: 3, noteBatch: 2, factCap: 4, noteCap: 3 };
const fact = (n: number, text: string, folder = ""): ActiveMemory => ({ id: uuid(n), text, tags: [], source: "auto", created_at: n, updated_at: n, kind: "situational", folder });
const note = (n: number, title: string, folder = ""): ActiveMemory => ({ ...fact(n, `${title} (documentation): the findings.`, folder), kind: "knowledge", tags: ["docs"] });

class FakeStore {
  writes: { id: string; folder: string }[][] = [];
  constructor(public rows: ActiveMemory[]) {}
  async listActive() {
    return this.rows;
  }
  async setFolders(assignments: { id: string; folder: string }[]) {
    this.writes.push(assignments);
    for (const a of assignments) {
      const row = this.rows.find((r) => r.id === a.id);
      if (row) row.folder = a.folder;
    }
    return assignments.length;
  }
}

function fakeWriter(script: { file?: (r: FilingRequest) => FilingAssignment[] | Error; split?: (r: SplitRequest) => SplitGroup[] | Error }) {
  const filed: FilingRequest[] = [];
  const splits: SplitRequest[] = [];
  const writer: MemoryFilingWriter = {
    async fileMemories(request) {
      filed.push(request);
      const out = script.file?.(request) ?? request.items.map((item) => ({ id: item.id, folder: "misc" }));
      if (out instanceof Error) throw out;
      return out;
    },
    async splitFolder(request) {
      splits.push(request);
      const out = script.split?.(request) ?? [];
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { writer, filed, splits };
}

describe("what is due", () => {
  test("nothing until a batch has gathered", () => {
    const active = [fact(1, "User is vegetarian."), fact(2, "User has a corgi."), note(11, "LanceDB indexes")];
    expect(nextWork(active, cfg)).toBeUndefined();
    expect(nextWork([...active, fact(3, "User lives in Shanghai.")], cfg)).toMatchObject({ type: "file", track: "facts" });
  });

  test("the oldest unfiled memories go first, and a batch is one track", () => {
    const active = [fact(5, "e"), fact(1, "a"), note(12, "N2"), fact(3, "c"), note(11, "N1"), fact(2, "b")];
    const work = nextWork(active, cfg);
    expect(work).toMatchObject({ type: "file", track: "facts" });
    expect((work as any).batch.map((m: ActiveMemory) => m.text)).toEqual(["a", "b", "c"]);
    expect(inboxOf(active, "notes").map((m) => m.id)).toEqual([uuid(11), uuid(12)]);
  });

  test("a fact too long to list is never filed", () => {
    const long = fact(9, `User ${"went on at length ".repeat(40)}`);
    expect(long.text.length).toBeGreaterThan(FILEABLE_FACT_CHARS);
    expect(inboxOf([long, fact(1, "a")], "facts").map((m) => m.id)).toEqual([uuid(1)]);
  });

  test("profile memories are nobody's to file", () => {
    const profile = { ...fact(1, "User prefers concise answers."), kind: "profile" as const };
    expect(inboxOf([profile], "facts")).toEqual([]);
    expect(foldersOf([{ ...profile, folder: "x" }], "facts").size).toBe(0);
  });

  test("a folder past its cap is split once no batch is waiting", () => {
    const active = Array.from({ length: 5 }, (_, i) => fact(i + 1, `fact ${i}`, "big"));
    expect(nextWork(active, cfg)).toMatchObject({ type: "split", track: "facts", folder: "big" });
    expect(nextWork(active.slice(0, 4), cfg)).toBeUndefined();
  });

  test("fact folders are shown to the filing model by their first few facts, note folders by every title", () => {
    const facts = Array.from({ length: 8 }, (_, i) => fact(i + 1, `Fact ${i + 1}.`, "f"));
    expect(renderFolderLine("facts", "f", facts)).toBe("f/ (8): Fact 1. | Fact 2. | Fact 3. | Fact 4. | Fact 5. | Fact 6. | ... and 2 more");
    expect(renderFolderLine("notes", "db", [note(1, "LanceDB indexes", "db"), note(2, "LanceDB compaction", "db")])).toBe("db/ holds 2 notes: LanceDB indexes; LanceDB compaction");
  });
});

describe("filing a batch", () => {
  test("files the batch, shows the model the existing folders, and leaves everything else alone", async () => {
    const store = new FakeStore([fact(1, "User is vegetarian.", "food"), fact(2, "User has a corgi."), fact(3, "User's corgi is named Mochi."), fact(4, "User is lactose intolerant."), note(11, "LanceDB indexes")]);
    const { writer, filed } = fakeWriter({ file: (r) => r.items.map((item) => ({ id: item.id, folder: item.label.includes("corgi") ? "pets" : "food" })) });
    const filer = new MemoryFiler(async () => store, writer, cfg);
    expect(filer.due(store.rows)).toBe(true);
    expect(await filer.step()).toBe(true);
    expect(filed[0].folders).toEqual(["food/ (1): User is vegetarian."]);
    expect(filed[0].items.map((i) => i.label)).toEqual(["User has a corgi.", "User's corgi is named Mochi.", "User is lactose intolerant."]);
    expect(store.rows.map((r) => r.folder)).toEqual(["food", "pets", "pets", "food", ""]);
    expect(filer.due(store.rows)).toBe(false);
    expect(await filer.step()).toBe(false);
  });

  test("a notes batch never contains a fact, and notes are shown by title and tags", async () => {
    const store = new FakeStore([fact(1, "a"), fact(2, "b"), note(11, "LanceDB indexes"), note(12, "Bun test runner")]);
    const { writer, filed } = fakeWriter({});
    await new MemoryFiler(async () => store, writer, cfg).step();
    expect(filed).toHaveLength(1);
    expect(filed[0].track).toBe("notes");
    expect(filed[0].items.map((i) => i.label)).toEqual(["LanceDB indexes [docs]", "Bun test runner [docs]"]);
    expect(store.rows.filter((r) => r.kind === "situational").every((r) => r.folder === "")).toBe(true);
  });

  test("an answer about a memory that was not in the batch is ignored", async () => {
    const store = new FakeStore([fact(1, "a", "keep"), fact(2, "b"), fact(3, "c"), fact(4, "d")]);
    const { writer } = fakeWriter({ file: (r) => [...r.items.map((item) => ({ id: item.id, folder: "new" })), { id: uuid(1), folder: "stolen" }] });
    await new MemoryFiler(async () => store, writer, cfg).step();
    expect(store.rows[0].folder).toBe("keep");
    expect(store.writes[0].map((w) => w.id)).toEqual([uuid(2), uuid(3), uuid(4)]);
  });

  test("when the writer fails nothing is written, and it is not asked again right away", async () => {
    let now = 1_000_000;
    const store = new FakeStore([fact(1, "a"), fact(2, "b"), fact(3, "c")]);
    const { writer, filed } = fakeWriter({ file: () => new Error("provider down") });
    const filer = new MemoryFiler(async () => store, writer, cfg, () => now);
    expect(await filer.step()).toBe(false);
    expect(store.writes).toEqual([]);
    expect(filer.due(store.rows)).toBe(false);
    expect(await filer.step()).toBe(false);
    expect(filed).toHaveLength(1);
    now += 16 * 60_000;
    expect(filer.due(store.rows)).toBe(true);
  });

  test("with the tree off nothing is filed", async () => {
    const store = new FakeStore([fact(1, "a"), fact(2, "b"), fact(3, "c")]);
    const { writer, filed } = fakeWriter({});
    const filer = new MemoryFiler(async () => store, writer, { ...cfg, enabled: false });
    expect(filer.due(store.rows)).toBe(false);
    expect(await filer.step()).toBe(false);
    expect(filed).toEqual([]);
  });
});

describe("splitting a folder", () => {
  const big = () => Array.from({ length: 5 }, (_, i) => fact(i + 1, i < 3 ? `Tesla fact ${i}` : `Corgi fact ${i}`, "ev-charging"));

  test("moves every member into the new folders", async () => {
    const store = new FakeStore([...big(), fact(9, "x", "other")]);
    const { writer, splits } = fakeWriter({ split: (r) => [{ name: "tesla", ids: r.items.filter((i) => i.label.startsWith("Tesla")).map((i) => i.id) }, { name: "corgi", ids: r.items.filter((i) => i.label.startsWith("Corgi")).map((i) => i.id) }] });
    expect(await new MemoryFiler(async () => store, writer, cfg).step()).toBe(true);
    expect(splits[0].taken.sort()).toEqual(["ev-charging", "other"]);
    expect(store.rows.map((r) => r.folder)).toEqual(["tesla", "tesla", "tesla", "corgi", "corgi", "other"]);
  });

  test("a folder the model would not split is left alone until it has grown by three", async () => {
    const store = new FakeStore(big());
    const { writer, splits } = fakeWriter({ split: () => [] });
    const filer = new MemoryFiler(async () => store, writer, cfg);
    expect(await filer.step()).toBe(true);
    expect(store.writes).toEqual([]);
    expect(filer.due(store.rows)).toBe(false);
    store.rows.push(fact(6, "f", "ev-charging"), fact(7, "g", "ev-charging"));
    expect(filer.due(store.rows)).toBe(false);
    store.rows.push(fact(8, "h", "ev-charging"));
    expect(filer.due(store.rows)).toBe(true);
    expect(splits).toHaveLength(1);
  });

  test("a split that does not cover the folder is not applied", async () => {
    const store = new FakeStore(big());
    const { writer } = fakeWriter({ split: (r) => [{ name: "a", ids: [r.items[0].id] }, { name: "b", ids: [r.items[1].id] }] });
    await new MemoryFiler(async () => store, writer, cfg).step();
    expect(store.writes).toEqual([]);
  });
});

describe("what the writer's answer is turned into", () => {
  const request: FilingRequest = { track: "facts", folders: [], items: [{ id: uuid(1), label: "a" }, { id: uuid(2), label: "b" }, { id: uuid(3), label: "c" }] };

  test("folder names are reduced to a safe alphabet", () => {
    expect(slugFolder("Food & Drink")).toBe("food-drink");
    expect(slugFolder("  health/ ")).toBe("health");
    expect(slugFolder("x'; DROP TABLE memories; --")).toBe("x-drop-table-memories");
    expect(slugFolder("!!!")).toBe("");
    expect(slugFolder("a".repeat(60)).length).toBe(40);
  });

  test("items are asked about by alias, and every one comes back filed", () => {
    expect(renderFilingRequest(request)).toBe("File these facts.\nExisting folders:\n(none yet)\n\nNew facts:\nF1: a\nF2: b\nF3: c");
    const out = normalizeFiling({ assignments: [{ id: "F1", folder: "Food" }, { id: "f1", folder: "again" }, { id: "F9", folder: "ghost" }, { id: "F2", folder: "!!!" }] }, request);
    expect(out).toEqual([{ id: uuid(1), folder: "food" }, { id: uuid(2), folder: "unsorted" }, { id: uuid(3), folder: "unsorted" }]);
    expect(normalizeFiling("not json", request).every((a) => a.folder === "unsorted")).toBe(true);
  });

  test("a split needs two groups, keeps leftovers, and steers clear of names in use", () => {
    const split: SplitRequest = { track: "notes", folder: "dev", taken: ["dev", "bun"], items: request.items };
    expect(normalizeSplit({ folders: [{ name: "only", ids: ["N1", "N2", "N3"] }] }, split)).toEqual([]);
    expect(normalizeSplit({ folders: [{ name: "bun", ids: ["N1"] }, { name: "dev", ids: ["N2", "N2", "N7"] }] }, split)).toEqual([
      { name: "bun-2", ids: [uuid(1), uuid(3)] },
      { name: "dev", ids: [uuid(2)] },
    ]);
  });
});
