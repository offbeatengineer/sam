import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lazyImport } from "../memory/lazy-install.js";
import { getSharedEmbeddingProvider, type EmbeddingProvider } from "../memory/embeddings.js";
import type { MemoryConfig } from "../memory/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(__dirname, "..", "..");

const TABLE_NAME = "session_messages";

export interface SessionMessage {
  id: string;              // "{sessionId}:{entryId}"
  session_id: string;
  session_path: string;
  conversation_id: string;
  channel_id: string;
  role: string;
  text: string;
  vector: number[];
  timestamp: number;
  session_name: string;
}

export interface SessionSearchResult {
  text: string;
  role: string;
  score: number;
  session_name: string;
  conversation_id: string;
  channel_id: string;
  timestamp: number;
}

export class SessionSearchStore {
  private static instance: SessionSearchStore | null = null;
  private static initPromise: Promise<SessionSearchStore> | null = null;

  private db: any;
  private table: any;
  private embedder: EmbeddingProvider;

  private constructor(db: any, table: any, embedder: EmbeddingProvider) {
    this.db = db;
    this.table = table;
    this.embedder = embedder;
  }

  static async getInstance(config?: MemoryConfig): Promise<SessionSearchStore> {
    if (SessionSearchStore.instance) return SessionSearchStore.instance;
    if (SessionSearchStore.initPromise) return SessionSearchStore.initPromise;

    if (!config) {
      throw new Error("[session-search] MemoryConfig is required for first initialization");
    }

    SessionSearchStore.initPromise = SessionSearchStore.init(config);

    try {
      SessionSearchStore.instance = await SessionSearchStore.initPromise;
      return SessionSearchStore.instance;
    } catch (err) {
      SessionSearchStore.initPromise = null;
      throw err;
    }
  }

  private static async init(config: MemoryConfig): Promise<SessionSearchStore> {
    const lancedb = await lazyImport<any>("@lancedb/lancedb", AGENT_DIR);
    const embedder = await getSharedEmbeddingProvider(config);

    console.log(`[session-search] Opening database at ${config.storagePath}`);
    const db = await lancedb.connect(config.storagePath);

    const tableNames: string[] = await db.tableNames();
    let table: any;

    if (tableNames.includes(TABLE_NAME)) {
      table = await db.openTable(TABLE_NAME);
    } else {
      console.log(`[session-search] Creating session_messages table...`);
      const seedId = "__seed__";
      const dimensions = config.embeddingDimensions ?? 384;
      const seedVector = new Array(dimensions).fill(0);
      const seedRecord: SessionMessage = {
        id: seedId,
        session_id: "",
        session_path: "",
        conversation_id: "",
        channel_id: "",
        role: "",
        text: "",
        vector: seedVector,
        timestamp: 0,
        session_name: "",
      };

      table = await db.createTable(TABLE_NAME, [seedRecord]);
      await table.delete(`id = '${seedId}'`);
    }

    console.log(`[session-search] Session search ready.`);
    return new SessionSearchStore(db, table, embedder);
  }

  async addMessages(records: SessionMessage[]): Promise<void> {
    if (records.length === 0) return;
    await this.table.add(records);
  }

  async search(
    query: string,
    limit = 5,
    filters?: { channelId?: string; role?: string },
  ): Promise<SessionSearchResult[]> {
    const vector = await this.embedder.embed(query);

    let search = this.table.search(vector).limit(limit);

    const conditions: string[] = [];
    if (filters?.channelId) {
      conditions.push(`channel_id = '${filters.channelId}'`);
    }
    if (filters?.role) {
      conditions.push(`role = '${filters.role}'`);
    }
    if (conditions.length > 0) {
      search = search.where(conditions.join(" AND "));
    }

    const results = await search.toArray();

    return results.map((r: any) => ({
      text: r.text,
      role: r.role,
      score: r._distance != null ? 1 - r._distance : r._relevance_score ?? 0,
      session_name: r.session_name,
      conversation_id: r.conversation_id,
      channel_id: r.channel_id,
      timestamp: r.timestamp,
    }));
  }

  async getIndexedSessionIds(): Promise<Set<string>> {
    const rows = await this.table.query().select(["session_id"]).toArray();
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.session_id) ids.add(r.session_id);
    }
    return ids;
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    await this.table.delete(`session_id = '${sessionId}'`);
  }

  async count(): Promise<number> {
    return this.table.countRows();
  }

  async embedText(text: string): Promise<number[]> {
    return this.embedder.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedder.embedBatch(texts);
  }

  async getSessionPath(conversationId: string): Promise<string | null> {
    const rows = await this.table
      .query()
      .select(["session_path"])
      .where(`conversation_id = '${conversationId}'`)
      .limit(1)
      .toArray();
    return rows.length > 0 ? rows[0].session_path : null;
  }

  async getSessionName(conversationId: string): Promise<string> {
    const rows = await this.table
      .query()
      .select(["session_name"])
      .where(`conversation_id = '${conversationId}'`)
      .limit(1)
      .toArray();
    return rows.length > 0 ? (rows[0].session_name || "") : "";
  }
}
