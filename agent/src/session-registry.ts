import type { SamAgentSession } from "./backend/types.js";
import { createSession } from "./agent-factory.js";
import type { SamConfig } from "./config.js";
import type { KitsServer } from "./kits-server.js";
import type { SessionKey } from "./types.js";
import { sessionKeyToString } from "./types.js";

interface SessionEntry {
  session: SamAgentSession;
  lastActivity: number;
}

export class SessionRegistry {
  private sessions = new Map<string, SessionEntry>();
  private creating = new Map<string, Promise<SamAgentSession>>();
  private kitsServer?: KitsServer;

  constructor(private config: SamConfig) {}

  setKitsServer(kitsServer: KitsServer): void {
    this.kitsServer = kitsServer;
  }

  async getOrCreate(key: SessionKey): Promise<SamAgentSession> {
    const id = sessionKeyToString(key);

    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing.session;
    }

    // Prevent concurrent creation for the same key
    const inflight = this.creating.get(id);
    if (inflight) {
      return inflight;
    }

    const promise = createSession(this.config, key, this.kitsServer).then((session) => {
      this.sessions.set(id, { session, lastActivity: Date.now() });
      this.creating.delete(id);
      return session;
    });

    this.creating.set(id, promise);
    return promise;
  }

  has(key: SessionKey): boolean {
    return this.sessions.has(sessionKeyToString(key));
  }

  dispose(key: SessionKey): void {
    const id = sessionKeyToString(key);
    const entry = this.sessions.get(id);
    if (entry) {
      entry.session.dispose();
      this.sessions.delete(id);
    }
  }

  async disposeAll(): Promise<void> {
    for (const [, entry] of this.sessions) {
      entry.session.dispose();
    }
    this.sessions.clear();
  }
}
