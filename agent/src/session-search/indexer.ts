import { SessionSearchStore, type SessionMessage } from "./store.js";
import { extractMessages } from "./extract.js";
import type { MemoryConfig } from "../memory/types.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";

const BATCH_SIZE = 10;

export class SessionIndexer {
  private config: MemoryConfig;
  private sessionsDir: string;
  private indexedCounts = new Map<string, number>();

  constructor(config: MemoryConfig, sessionsDir: string) {
    this.config = config;
    this.sessionsDir = sessionsDir;
  }

  async indexAll(): Promise<void> {
    const store = await SessionSearchStore.getInstance(this.config);
    const alreadyIndexed = await store.getIndexedSessionIds();

    const sessionFiles = this.discoverSessionFiles();
    const unindexed = sessionFiles.filter((s) => !alreadyIndexed.has(s.sessionId));

    if (unindexed.length === 0) {
      console.log(`[session-search] All ${sessionFiles.length} sessions already indexed.`);
      return;
    }

    console.log(`[session-search] Indexing ${unindexed.length} sessions...`);

    let totalMessages = 0;
    let totalSessions = 0;

    for (let i = 0; i < unindexed.length; i += BATCH_SIZE) {
      const batch = unindexed.slice(i, i + BATCH_SIZE);

      for (const info of batch) {
        try {
          const count = await this.indexSession(store, info);
          totalMessages += count;
          totalSessions++;
        } catch (err) {
          console.warn(`[session-search] Failed to index ${info.sessionPath}:`, err);
        }
      }

      // Yield to event loop between batches
      if (i + BATCH_SIZE < unindexed.length) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    console.log(`[session-search] Indexed ${totalSessions} sessions (${totalMessages} messages)`);
  }

  async indexLatest(
    sessionPath: string,
    conversationId: string,
    channelId: string,
  ): Promise<void> {
    const store = await SessionSearchStore.getInstance(this.config);

    const sm = SessionManager.open(sessionPath, resolve(sessionPath, ".."));
    const header = sm.getHeader();
    const sessionId = header?.id ?? basename(sessionPath, ".jsonl");
    const entries = sm.getEntries();
    const messages = extractMessages(entries);

    const prevCount = this.indexedCounts.get(sessionId) ?? 0;
    if (messages.length <= prevCount) return;

    const newMessages = messages.slice(prevCount);
    const sessionName = sm.getSessionName() ?? "";

    const texts = newMessages.map((m) => m.text);
    const vectors = await store.embedBatch(texts);

    const records: SessionMessage[] = newMessages.map((m, i) => ({
      id: `${sessionId}:${m.entryId}`,
      session_id: sessionId,
      session_path: sessionPath,
      conversation_id: conversationId,
      channel_id: channelId,
      role: m.role,
      text: m.text,
      vector: vectors[i],
      timestamp: m.timestamp,
      session_name: sessionName,
    }));

    await store.addMessages(records);
    this.indexedCounts.set(sessionId, messages.length);
  }

  private async indexSession(
    store: SessionSearchStore,
    info: SessionFileInfo,
  ): Promise<number> {
    const sm = SessionManager.open(info.sessionPath, resolve(info.sessionPath, ".."));
    const header = sm.getHeader();
    const sessionId = header?.id ?? basename(info.sessionPath, ".jsonl");
    const entries = sm.getEntries();
    const messages = extractMessages(entries);

    if (messages.length === 0) {
      this.indexedCounts.set(sessionId, 0);
      return 0;
    }

    const sessionName = sm.getSessionName() ?? "";
    const texts = messages.map((m) => m.text);
    const vectors = await store.embedBatch(texts);

    const records: SessionMessage[] = messages.map((m, i) => ({
      id: `${sessionId}:${m.entryId}`,
      session_id: sessionId,
      session_path: info.sessionPath,
      conversation_id: info.conversationId,
      channel_id: info.channelId,
      role: m.role,
      text: m.text,
      vector: vectors[i],
      timestamp: m.timestamp,
      session_name: sessionName,
    }));

    await store.addMessages(records);
    this.indexedCounts.set(sessionId, messages.length);
    return messages.length;
  }

  private discoverSessionFiles(): SessionFileInfo[] {
    const results: SessionFileInfo[] = [];
    const sessionsDir = this.sessionsDir;

    let channelDirs: string[];
    try {
      channelDirs = readdirSync(sessionsDir).filter((name) => {
        try {
          return statSync(resolve(sessionsDir, name)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      return results;
    }

    for (const channelId of channelDirs) {
      const channelPath = resolve(sessionsDir, channelId);
      let convDirs: string[];
      try {
        convDirs = readdirSync(channelPath).filter((name) => {
          try {
            return statSync(resolve(channelPath, name)).isDirectory();
          } catch {
            return false;
          }
        });
      } catch {
        continue;
      }

      for (const conversationId of convDirs) {
        const convPath = resolve(channelPath, conversationId);
        let jsonlFiles: string[];
        try {
          jsonlFiles = readdirSync(convPath).filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }

        for (const file of jsonlFiles) {
          const sessionPath = resolve(convPath, file);
          const header = this.readSessionHeader(sessionPath);
          const sessionId = header?.id ?? basename(file, ".jsonl");

          results.push({
            sessionPath,
            sessionId,
            conversationId,
            channelId,
          });
        }
      }
    }

    return results;
  }

  private readSessionHeader(sessionPath: string): { id?: string } | null {
    try {
      const sm = SessionManager.open(sessionPath, resolve(sessionPath, ".."));
      return sm.getHeader();
    } catch {
      return null;
    }
  }
}

interface SessionFileInfo {
  sessionPath: string;
  sessionId: string;
  conversationId: string;
  channelId: string;
}
