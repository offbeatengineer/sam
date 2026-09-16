import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lazyImport } from "./lazy-install.js";
import { getSharedEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import type { MemoryConfig, MemoryKind, MemoryStatus } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(__dirname, "..", "..");

const TABLE_NAME = "memories";

export interface Memory {
  id: string;
  text: string;
  vector: number[];
  tags: string;
  source: string;
  created_at: number;
  /** "profile" memories apply to every turn; "situational" ones are judged per turn. */
  kind: string;
  /** Memories are superseded or forgotten, not deleted, so a wrong judgment is recoverable. */
  status: string;
  /** Id of the memory that replaced this one; "" when none. */
  superseded_by: string;
  updated_at: number;
}

export interface RecallResult {
  id: string;
  text: string;
  tags: string[];
  source: string;
  created_at: number;
  score: number;
  kind: MemoryKind;
  status: MemoryStatus;
  superseded_by: string;
  updated_at: number;
}

/** What the automatic-memory judgments work on: every active memory, without vectors. */
export type ActiveMemory = Omit<RecallResult, "score" | "status" | "superseded_by">;

/** Columns added after the first release, with the SQL that backfills existing rows. */
const ADDED_COLUMNS = [
  { name: "kind", valueSql: "'situational'" },
  { name: "status", valueSql: "'active'" },
  // '' rather than NULL: an all-null column breaks Arrow type inference on JS inserts.
  { name: "superseded_by", valueSql: "''" },
  { name: "updated_at", valueSql: "created_at" },
];

/** Everything except `vector`, which is 1.5 KB per row and only needed for search. */
const READ_COLUMNS = ["id", "text", "tags", "source", "created_at", "kind", "status", "superseded_by", "updated_at"];

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids reach the store from clients and from the model, so never trust their shape. */
export function isMemoryId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** `,` delimits the stored tag list and `%` is a LIKE wildcard; neither may appear in a tag. */
function cleanTags(tags?: string[]): string[] {
  return (tags ?? []).map((t) => t.replace(/[,%']/g, "").trim()).filter((t) => t.length > 0);
}

function encodeTags(tags?: string[]): string {
  const clean = cleanTags(tags);
  return clean.length > 0 ? `,${clean.join(",")},` : "";
}

function toResult(r: any, score: number): RecallResult {
  return {
    id: r.id,
    text: r.text,
    tags: r.tags ? r.tags.split(",").filter((t: string) => t.length > 0) : [],
    source: r.source,
    created_at: r.created_at,
    score,
    kind: r.kind === "profile" ? "profile" : "situational",
    status: r.status === "superseded" || r.status === "forgotten" ? r.status : "active",
    superseded_by: r.superseded_by ?? "",
    updated_at: r.updated_at ?? r.created_at,
  };
}

export class MemoryStore {
  private static instance: MemoryStore | null = null;
  private static initPromise: Promise<MemoryStore> | null = null;

  private db: any;
  private table: any;
  private embedder: EmbeddingProvider;
  private activeCache: ActiveMemory[] | null = null;

  private constructor(db: any, table: any, embedder: EmbeddingProvider) {
    this.db = db;
    this.table = table;
    this.embedder = embedder;
  }

  static async getInstance(config?: MemoryConfig): Promise<MemoryStore> {
    if (MemoryStore.instance) return MemoryStore.instance;
    if (MemoryStore.initPromise) return MemoryStore.initPromise;

    if (!config) {
      throw new Error("[memory] MemoryConfig is required for first initialization");
    }

    MemoryStore.initPromise = MemoryStore.init(config);

    try {
      MemoryStore.instance = await MemoryStore.initPromise;
      return MemoryStore.instance;
    } catch (err) {
      // Reset so retries work
      MemoryStore.initPromise = null;
      throw err;
    }
  }

  private static async init(config: MemoryConfig): Promise<MemoryStore> {
    const lancedb = await lazyImport<any>("@lancedb/lancedb", AGENT_DIR);
    const embedder = await getSharedEmbeddingProvider(config);

    console.log(`[memory] Opening database at ${config.storagePath}`);
    const db = await lancedb.connect(config.storagePath);

    const tableNames: string[] = await db.tableNames();
    let table: any;

    if (tableNames.includes(TABLE_NAME)) {
      table = await db.openTable(TABLE_NAME);
      await MemoryStore.migrate(table);
    } else {
      console.log(`[memory] Creating memories table...`);
      // Seed-record approach: insert one record to infer schema, then delete it
      const seedId = "__seed__";
      const dimensions = config.embeddingDimensions ?? 384;
      const seedVector = new Array(dimensions).fill(0);
      const seedRecord: Memory = {
        id: seedId,
        text: "",
        vector: seedVector,
        tags: "",
        source: "",
        created_at: 0,
        kind: "",
        status: "",
        superseded_by: "",
        updated_at: 0,
      };

      table = await db.createTable(TABLE_NAME, [seedRecord]);
      await table.delete(`id = ${sqlStr(seedId)}`);

      // Create FTS index on text column
      try {
        await table.createIndex("text", { config: lancedb.Index.fts() });
      } catch (err) {
        console.warn(`[memory] FTS index creation failed (non-fatal):`, err);
      }
    }

    console.log(`[memory] Memory system ready.`);
    return new MemoryStore(db, table, embedder);
  }

  /** Idempotent: adds whichever columns an older table lacks and backfills them. */
  private static async migrate(table: any): Promise<void> {
    const have = new Set<string>((await table.schema()).fields.map((f: any) => f.name));
    const missing = ADDED_COLUMNS.filter((c) => !have.has(c.name));
    if (missing.length === 0) return;

    // The version is the rollback point (LanceDB keeps old versions for time travel).
    const version = await table.version();
    console.log(`[memory] Migrating schema from table version ${version}: adding ${missing.map((c) => c.name).join(", ")}`);
    await table.addColumns(missing);
  }

  async save(text: string, tags?: string[], source?: string, opts?: { kind?: MemoryKind }): Promise<string> {
    const id = randomUUID();
    const vector = await this.embedder.embed(text);
    const now = Date.now();

    const record: Memory = {
      id,
      text,
      vector,
      tags: encodeTags(tags),
      source: source ?? "observation",
      created_at: now,
      kind: opts?.kind ?? "situational",
      status: "active",
      superseded_by: "",
      updated_at: now,
    };

    await this.table.add([record]);
    this.activeCache = null;
    return id;
  }

  async recall(options: {
    query: string;
    limit?: number;
    tags?: string[];
  }): Promise<RecallResult[]> {
    const { query, limit = 5, tags } = options;
    const vector = await this.embedder.embed(query);

    const conditions = ["status = 'active'", ...cleanTags(tags).map((t) => `tags LIKE ${sqlStr(`%,${t},%`)}`)];
    const results = await this.table.search(vector).where(conditions.join(" AND ")).limit(limit).toArray();

    return results.map((r: any) => toResult(r, r._distance != null ? 1 - r._distance : r._relevance_score ?? 0));
  }

  /** Every active memory, newest first. Cached: automatic recall reads this on every turn. */
  async listActive(): Promise<ActiveMemory[]> {
    if (!this.activeCache) {
      const rows = await this.table.query().where("status = 'active'").select(READ_COLUMNS).toArray();
      this.activeCache = rows
        .map((r: any) => {
          const { score: _score, status: _status, superseded_by: _by, ...active } = toResult(r, 0);
          return active;
        })
        .sort((a: ActiveMemory, b: ActiveMemory) => b.updated_at - a.updated_at);
    }
    return this.activeCache!;
  }

  async get(id: string): Promise<RecallResult | undefined> {
    if (!isMemoryId(id)) return undefined;
    const rows = await this.table.query().where(`id = ${sqlStr(id)}`).select(READ_COLUMNS).limit(1).toArray();
    return rows.length > 0 ? toResult(rows[0], 0) : undefined;
  }

  /** Hard delete. Automatic memory never calls this; it is the UI's "delete permanently". */
  async forget(id: string): Promise<boolean> {
    if (!isMemoryId(id)) return false;
    try {
      const where = `id = ${sqlStr(id)}`;
      if ((await this.table.countRows(where)) === 0) return false;
      await this.table.delete(where);
      this.activeCache = null;
      return true;
    } catch {
      return false;
    }
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    /** Defaults to "active" so clients that predate statuses never see replaced memories. */
    status?: "active" | "all";
  }): Promise<{ memories: RecallResult[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let query = this.table.query().select(READ_COLUMNS);
    if (options?.status !== "all") query = query.where("status = 'active'");

    // Storage order is arbitrary, so sort before paginating.
    const rows: RecallResult[] = (await query.toArray()).map((r: any) => toResult(r, 0));
    rows.sort((a, b) => b.updated_at - a.updated_at);

    return { memories: rows.slice(offset, offset + limit), total: rows.length };
  }

  /** In place. Re-embeds only when the text changes. */
  async update(id: string, patch: { text?: string; tags?: string[]; kind?: MemoryKind }): Promise<boolean> {
    if (!isMemoryId(id)) return false;
    try {
      const values: Record<string, unknown> = { updated_at: Date.now() };
      if (patch.text !== undefined) {
        values.text = patch.text;
        values.vector = await this.embedder.embed(patch.text);
      }
      if (patch.tags !== undefined) values.tags = encodeTags(patch.tags);
      if (patch.kind !== undefined) values.kind = patch.kind;
      return await this.applyUpdate(id, values);
    } catch {
      return false;
    }
  }

  /** Mark `oldId` as replaced by `newId`. The old text stays readable and restorable. */
  async supersede(oldId: string, newId: string): Promise<boolean> {
    if (!isMemoryId(oldId) || !isMemoryId(newId)) return false;
    return this.applyUpdate(oldId, { status: "superseded", superseded_by: newId, updated_at: Date.now() });
  }

  async setStatus(id: string, status: MemoryStatus): Promise<boolean> {
    if (!isMemoryId(id)) return false;
    const values: Record<string, unknown> = { status, updated_at: Date.now() };
    if (status === "active") values.superseded_by = "";
    return this.applyUpdate(id, values);
  }

  /** Bump recency when the user restates something already known. */
  async touch(id: string): Promise<boolean> {
    if (!isMemoryId(id)) return false;
    return this.applyUpdate(id, { updated_at: Date.now() });
  }

  private async applyUpdate(id: string, values: Record<string, unknown>): Promise<boolean> {
    const result = await this.table.update({ where: `id = ${sqlStr(id)}`, values });
    this.activeCache = null;
    return (result?.rowsUpdated ?? 0) > 0;
  }

  async count(): Promise<number> {
    const result = await this.table.countRows();
    return result;
  }
}
