import { FILEABLE_FACT_CHARS, noteListing, noteTitle, trackOf, type Track } from "./judgments.js";
import type { ActiveMemory } from "./store.js";
import type { TreeConfig } from "./types.js";
import type { FilingItem, MemoryFilingWriter } from "./writer.js";

// ---------------------------------------------------------------------------
// Filing: which folder recall looks in for a memory.
//
// A new memory starts unfiled, where recall judges it directly every turn. Once
// a batch has gathered, a model that is shown every folder files the batch at
// once, and a folder that outgrows its cap is split. Filing one memory at a
// time, by a judgment on each, was measured too: the first memory on a subject
// names its folder too narrowly, the next ones do not fit, and the store ends
// up as folders of one (evals/memory/README.md).
//
// Nothing here can lose a memory. Recall sees a folder as a listing of what it
// holds, so a memory filed badly is still found; filing only moves what a turn
// costs. And it writes one column: never a memory's text, kind or status. The
// two tracks are filed apart, so text that came from a web page is never shown
// next to, or filed among, what the user said.
// ---------------------------------------------------------------------------

export interface FolderStore {
  listActive(): Promise<ActiveMemory[]>;
  setFolders(assignments: { id: string; folder: string }[]): Promise<number>;
}

/** After a failed call the inbox simply stays as it is, which recall handles; no need to hammer the writer. */
const RETRY_AFTER_MS = 15 * 60_000;
/** The filing model is shown a fact folder by its first few facts; the full listing is what recall gets. */
const FACTS_SHOWN_PER_FOLDER = 6;
/** A folder the model would not split is left alone until it has grown by this much. */
const SPLIT_RETRY_GROWTH = 3;

export type FilingWork =
  | { type: "file"; track: Track; batch: ActiveMemory[] }
  | { type: "split"; track: Track; folder: string; members: ActiveMemory[] };

const oldestFirst = (a: ActiveMemory, b: ActiveMemory) => a.created_at - b.created_at;
const fileable = (track: Track, m: ActiveMemory) => track === "notes" || m.text.length <= FILEABLE_FACT_CHARS;

/** Unfiled memories of a track, oldest first. A fact too long to list is never filed. */
export function inboxOf(active: ActiveMemory[], track: Track): ActiveMemory[] {
  return active.filter((m) => trackOf(m.kind) === track && !m.folder && fileable(track, m)).sort(oldestFirst);
}

export function foldersOf(active: ActiveMemory[], track: Track): Map<string, ActiveMemory[]> {
  const folders = new Map<string, ActiveMemory[]>();
  for (const m of [...active].sort(oldestFirst)) {
    if (trackOf(m.kind) !== track || !m.folder) continue;
    folders.set(m.folder, [...(folders.get(m.folder) ?? []), m]);
  }
  return folders;
}

const splitKey = (track: Track, folder: string) => `${track}:${folder}`;

/** One model call's worth: a batch of facts, else a batch of notes, else one folder to split. */
export function nextWork(active: ActiveMemory[], cfg: TreeConfig, unsplittable: ReadonlyMap<string, number> = new Map()): FilingWork | undefined {
  for (const track of ["facts", "notes"] as const) {
    const size = track === "facts" ? cfg.factBatch : cfg.noteBatch;
    const inbox = inboxOf(active, track);
    if (inbox.length >= size) return { type: "file", track, batch: inbox.slice(0, size) };
  }
  for (const track of ["facts", "notes"] as const) {
    const cap = track === "facts" ? cfg.factCap : cfg.noteCap;
    for (const [folder, members] of foldersOf(active, track)) {
      if (members.length > cap && members.length >= (unsplittable.get(splitKey(track, folder)) ?? 0) + SPLIT_RETRY_GROWTH) return { type: "split", track, folder, members };
    }
  }
  return undefined;
}

const labelOf = (track: Track, m: ActiveMemory) => (track === "facts" ? m.text : `${noteTitle(m.text)}${m.tags.length ? ` [${m.tags.join(", ")}]` : ""}`);
const itemsOf = (track: Track, mems: ActiveMemory[]): FilingItem[] => mems.map((m) => ({ id: m.id, label: labelOf(track, m) }));

/** How an existing folder is shown to the filing model, as measured: notes by every title, facts by the first few. */
export function renderFolderLine(track: Track, name: string, members: ActiveMemory[]): string {
  if (track === "notes") return noteListing(name, members.map((m) => noteTitle(m.text)));
  const shown = members.slice(0, FACTS_SHOWN_PER_FOLDER).map((m) => m.text);
  const more = members.length - shown.length;
  return `${name}/ (${members.length}): ${shown.join(" | ")}${more > 0 ? ` | ... and ${more} more` : ""}`;
}

export class MemoryFiler {
  private retryAt = 0;
  /** Folder -> its size when the model last declined to split it. In memory: a restart may ask once more. */
  private readonly unsplittable = new Map<string, number>();

  constructor(
    private readonly store: () => Promise<FolderStore>,
    private readonly writer: MemoryFilingWriter,
    private readonly cfg: TreeConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cheap enough to ask on every turn. */
  due(active: ActiveMemory[]): boolean {
    return this.cfg.enabled && this.now() >= this.retryAt && nextWork(active, this.cfg, this.unsplittable) !== undefined;
  }

  /**
   * At most one model call. True when it did something and there may be more to
   * do, so the caller can let other work in between. Never throws.
   */
  async step(signal?: AbortSignal): Promise<boolean> {
    if (!this.cfg.enabled || this.now() < this.retryAt) return false;
    try {
      const store = await this.store();
      const active = await store.listActive();
      const work = nextWork(active, this.cfg, this.unsplittable);
      if (!work) return false;
      if (work.type === "file") await this.file(store, active, work.track, work.batch, signal);
      else await this.split(store, active, work.track, work.folder, work.members, signal);
      return true;
    } catch (err) {
      this.retryAt = this.now() + RETRY_AFTER_MS;
      if (!signal?.aborted) console.warn(`[memory] filing failed; unfiled memories stay as they are and recall still judges them:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  private async file(store: FolderStore, active: ActiveMemory[], track: Track, batch: ActiveMemory[], signal?: AbortSignal): Promise<void> {
    const folders = foldersOf(active, track);
    const assignments = await this.writer.fileMemories(
      { track, folders: [...folders.entries()].map(([name, members]) => renderFolderLine(track, name, members)), items: itemsOf(track, batch) },
      signal,
    );
    // Only what was asked about: the writer's answer cannot move a memory it was not shown.
    const asked = new Set(batch.map((m) => m.id));
    const valid = assignments.filter((a) => asked.has(a.id));
    await store.setFolders(valid);
    const created = [...new Set(valid.map((a) => a.folder))].filter((name) => !folders.has(name));
    console.log(`[memory] filed ${valid.length} ${track}${created.length ? `; new folder${created.length === 1 ? "" : "s"}: ${created.join(", ")}` : ""}`);
  }

  private async split(store: FolderStore, active: ActiveMemory[], track: Track, folder: string, members: ActiveMemory[], signal?: AbortSignal): Promise<void> {
    const groups = await this.writer.splitFolder({ track, folder, items: itemsOf(track, members), taken: [...foldersOf(active, track).keys()] }, signal);
    const inside = new Set(members.map((m) => m.id));
    const moves = groups.flatMap((g) => g.ids.filter((id) => inside.has(id)).map((id) => ({ id, folder: g.name })));
    if (groups.length < 2 || moves.length !== members.length) {
      this.unsplittable.set(splitKey(track, folder), members.length);
      console.log(`[memory] ${folder}/ (${members.length} ${track}) was not split; leaving it until it grows`);
      return;
    }
    await store.setFolders(moves);
    console.log(`[memory] split ${folder}/ (${members.length} ${track}) into ${groups.map((g) => `${g.name}/ (${g.ids.length})`).join(", ")}`);
  }
}
