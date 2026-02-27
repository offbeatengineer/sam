import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lazyImport } from "./lazy-install.js";
import { LocalEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import type { MemoryConfig } from "./types.js";

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
}

export interface RecallResult {
  id: string;
  text: string;
  tags: string[];
  source: string;
  created_at: number;
  score: number;
}

export class MemoryStore {
  private static instance: MemoryStore | null = null;
  private static initPromise: Promise<MemoryStore> | null = null;

  private db: any;
  private table: any;
  private embedder: EmbeddingProvider;

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
    const embedder = await LocalEmbeddingProvider.create(config);

    console.log(`[memory] Opening database at ${config.storagePath}`);
    const db = await lancedb.connect(config.storagePath);

    const tableNames: string[] = await db.tableNames();
    let table: any;

    if (tableNames.includes(TABLE_NAME)) {
      table = await db.openTable(TABLE_NAME);
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
      };

      table = await db.createTable(TABLE_NAME, [seedRecord]);
      await table.delete(`id = '${seedId}'`);

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

  async save(text: string, tags?: string[], source?: string): Promise<string> {
    const id = randomUUID();
    const vector = await this.embedder.embed(text);
    const tagStr = tags && tags.length > 0 ? `,${tags.join(",")},` : "";

    const record: Memory = {
      id,
      text,
      vector,
      tags: tagStr,
      source: source ?? "observation",
      created_at: Date.now(),
    };

    await this.table.add([record]);
    return id;
  }

  async recall(options: {
    query: string;
    limit?: number;
    tags?: string[];
  }): Promise<RecallResult[]> {
    const { query, limit = 5, tags } = options;
    const vector = await this.embedder.embed(query);

    let search = this.table.search(vector).limit(limit);

    if (tags && tags.length > 0) {
      const conditions = tags.map((t) => `tags LIKE '%,${t},%'`);
      search = search.where(conditions.join(" AND "));
    }

    const results = await search.toArray();

    return results.map((r: any) => ({
      id: r.id,
      text: r.text,
      tags: r.tags
        ? r.tags
            .split(",")
            .filter((t: string) => t.length > 0)
        : [],
      source: r.source,
      created_at: r.created_at,
      score: r._distance != null ? 1 - r._distance : r._relevance_score ?? 0,
    }));
  }

  async forget(id: string): Promise<boolean> {
    try {
      await this.table.delete(`id = '${id}'`);
      return true;
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    const result = await this.table.countRows();
    return result;
  }
}
