import { WebSocketServer, type WebSocket } from "ws";
import type { SessionRegistry } from "../session-registry.js";
import type { AppRequest, AppResponse, SessionInfoDTO } from "../protocol.js";
import type { SessionKey } from "../types.js";
import { MemoryStore } from "../memory/store.js";
import type { MemoryConfig } from "../memory/types.js";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { readdirSync, statSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";

interface AppChannelOptions {
  port: number;
  host?: string;
  registry: SessionRegistry;
  memoryConfig?: MemoryConfig;
  sessionsDir: string;
}

/**
 * WebSocket server channel for the desktop app.
 *
 * Unlike Discord (which uses the text-only Dispatcher pattern), AppChannel
 * manages its own session interaction to forward rich streaming events
 * (thinking, tool calls, etc.) directly to the connected client.
 */
export class AppChannel {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  /** Maps conversationId → the WebSocket client that owns it */
  private conversationOwners = new Map<string, WebSocket>();
  /** Maps conversationId → current requestId */
  private activeRequests = new Map<string, string>();
  /** Tracks which sessions already have subscriptions */
  private subscriptions = new Set<string>();

  constructor(private options: AppChannelOptions) {}

  async start(): Promise<void> {
    const { port, host } = this.options;
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host: host ?? "127.0.0.1" }, () => {
        console.log(`App channel listening on ${host ?? "127.0.0.1"}:${port}`);
        resolve();
      });

      this.wss.on("error", (err) => {
        console.error("App channel server error:", err);
        reject(err);
      });

      this.wss.on("connection", (ws) => {
        this.clients.add(ws);
        console.log(`App client connected (${this.clients.size} total)`);

        ws.on("message", (data) => {
          try {
            const request = JSON.parse(data.toString()) as AppRequest;
            this.handleRequest(ws, request);
          } catch (err) {
            this.sendTo(ws, { type: "error", error: `Invalid message: ${err}` });
          }
        });

        ws.on("close", () => {
          this.clients.delete(ws);
          // Clean up conversation ownership for this client
          for (const [convId, owner] of this.conversationOwners) {
            if (owner === ws) {
              this.conversationOwners.delete(convId);
              this.activeRequests.delete(convId);
            }
          }
          console.log(`App client disconnected (${this.clients.size} remaining)`);
        });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) return;
    for (const ws of this.clients) {
      ws.close();
    }
    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Request handling
  // ---------------------------------------------------------------------------

  private async handleRequest(ws: WebSocket, request: AppRequest): Promise<void> {
    switch (request.type) {
      case "chat":
        return this.handleChat(ws, request);
      case "abort":
        return this.handleAbort(request.conversationId);
      case "close_session":
        return this.handleCloseSession(ws, request.conversationId);
      case "list_sessions":
        return this.handleListSessions(ws, request);
      case "get_session_entries":
        return this.handleGetSessionEntries(ws, request);
      case "rename_session":
        return this.handleRenameSession(ws, request);
      case "memory_list":
      case "memory_search":
      case "memory_save":
      case "memory_update":
      case "memory_delete":
        return this.handleMemoryRequest(ws, request);
      default:
        this.sendTo(ws, { type: "error", error: `Unknown request type: ${(request as any).type}` });
    }
  }

  private async handleChat(
    ws: WebSocket,
    request: Extract<AppRequest, { type: "chat" }>,
  ): Promise<void> {
    const { conversationId, requestId, text } = request;
    const registry = this.options.registry;
    const sessionKey: SessionKey = { channelId: "app", conversationId };

    this.conversationOwners.set(conversationId, ws);
    this.activeRequests.set(conversationId, requestId);

    try {
      const isNew = !registry.has(sessionKey);
      const session = await registry.getOrCreate(sessionKey);

      if (isNew) {
        this.sendTo(ws, { type: "session_created", conversationId });
      }

      this.ensureSubscription(conversationId, session);

      this.sendTo(ws, { type: "turn_start", conversationId, requestId });

      await session.prompt(text, { streamingBehavior: "followUp" } as any);

      this.sendTo(ws, { type: "turn_end", conversationId, requestId });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      console.error(`App channel error [${conversationId}]:`, errorText);
      this.sendTo(ws, { type: "error", conversationId, error: errorText });
    }
  }

  private async handleAbort(conversationId: string): Promise<void> {
    const registry = this.options.registry;
    const sessionKey: SessionKey = { channelId: "app", conversationId };

    if (!registry.has(sessionKey)) return;

    const session = await registry.getOrCreate(sessionKey);
    session.abort();

    const ws = this.conversationOwners.get(conversationId);
    if (ws) {
      this.sendTo(ws, { type: "aborted", conversationId });
    }
  }

  private async handleCloseSession(ws: WebSocket, conversationId: string): Promise<void> {
    const registry = this.options.registry;
    const sessionKey: SessionKey = { channelId: "app", conversationId };

    registry.dispose(sessionKey);
    this.conversationOwners.delete(conversationId);
    this.activeRequests.delete(conversationId);
    this.subscriptions.delete(conversationId);

    this.sendTo(ws, { type: "session_closed", conversationId });
  }

  // ---------------------------------------------------------------------------
  // Session browsing
  // ---------------------------------------------------------------------------

  private async handleListSessions(
    ws: WebSocket,
    request: Extract<AppRequest, { type: "list_sessions" }>,
  ): Promise<void> {
    const { requestId } = request;
    const sessionsDir = this.options.sessionsDir;

    try {
      const sessions: SessionInfoDTO[] = [];

      // Walk {sessionsDir}/{channelId}/{conversationId}/ for .jsonl files
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
        channelDirs = [];
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

          if (jsonlFiles.length === 0) continue;

          // Find most recently modified .jsonl file
          let mostRecent = jsonlFiles[0];
          let mostRecentMtime = 0;
          for (const f of jsonlFiles) {
            try {
              const st = statSync(resolve(convPath, f));
              if (st.mtimeMs > mostRecentMtime) {
                mostRecentMtime = st.mtimeMs;
                mostRecent = f;
              }
            } catch {
              // skip
            }
          }

          const sessionPath = resolve(convPath, mostRecent);
          try {
            const sm = SessionManager.open(sessionPath, convPath);
            const header = sm.getHeader();
            const entries = sm.getEntries();

            // Count message entries and find first user message
            let messageCount = 0;
            let firstMessage = "";
            for (const entry of entries) {
              if (entry.type === "message") {
                messageCount++;
                if (!firstMessage && (entry as any).message?.role === "user") {
                  const msg = (entry as any).message;
                  if (typeof msg.content === "string") {
                    firstMessage = msg.content.substring(0, 200);
                  } else if (Array.isArray(msg.content)) {
                    const textPart = msg.content.find((c: any) => c.type === "text");
                    if (textPart) firstMessage = textPart.text.substring(0, 200);
                  }
                }
              }
            }

            const fileStat = statSync(sessionPath);

            sessions.push({
              path: sessionPath,
              id: header?.id ?? basename(mostRecent, ".jsonl"),
              channelId,
              conversationId,
              cwd: header?.cwd ?? "",
              name: sm.getSessionName(),
              created: header?.timestamp ?? fileStat.birthtime.toISOString(),
              modified: fileStat.mtime.toISOString(),
              messageCount,
              firstMessage,
            });
          } catch (err) {
            console.warn(`Failed to read session ${sessionPath}:`, err);
          }
        }
      }

      // Sort by modified time descending
      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      this.sendTo(ws, { type: "sessions_list", requestId, sessions });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to list sessions: ${errorText}` });
    }
  }

  private async handleGetSessionEntries(
    ws: WebSocket,
    request: Extract<AppRequest, { type: "get_session_entries" }>,
  ): Promise<void> {
    const { requestId, sessionPath } = request;

    try {
      const sessionDir = dirname(sessionPath);
      const sm = SessionManager.open(sessionPath, sessionDir);
      const header = sm.getHeader();
      const entries = sm.getEntries();

      this.sendTo(ws, {
        type: "session_entries",
        requestId,
        header: header as object | null,
        entries: entries as object[],
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to read session entries: ${errorText}` });
    }
  }

  private async handleRenameSession(
    ws: WebSocket,
    request: Extract<AppRequest, { type: "rename_session" }>,
  ): Promise<void> {
    const { requestId, sessionPath, name } = request;

    try {
      const sessionDir = dirname(sessionPath);
      const sm = SessionManager.open(sessionPath, sessionDir);
      sm.appendSessionInfo(name);
      this.sendTo(ws, { type: "rename_session_result", requestId, success: true });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to rename session: ${errorText}` });
    }
  }

  // ---------------------------------------------------------------------------
  // Memory request handling
  // ---------------------------------------------------------------------------

  private async handleMemoryRequest(
    ws: WebSocket,
    request: Extract<AppRequest, { type: `memory_${string}` }>,
  ): Promise<void> {
    const requestId = (request as any).requestId as string;
    const memoryConfig = this.options.memoryConfig;

    if (!memoryConfig?.enabled) {
      this.sendTo(ws, { type: "memory_error", requestId, error: "Memory system is not enabled" });
      return;
    }

    try {
      const store = await MemoryStore.getInstance(memoryConfig);

      switch (request.type) {
        case "memory_list": {
          const { memories, total } = await store.list({
            limit: request.limit,
            offset: request.offset,
          });
          this.sendTo(ws, { type: "memory_list_result", requestId, memories, total });
          break;
        }

        case "memory_search": {
          const results = await store.recall({
            query: request.query,
            limit: request.limit,
            tags: request.tags,
          });
          this.sendTo(ws, { type: "memory_search_result", requestId, memories: results, count: results.length });
          break;
        }

        case "memory_save": {
          const id = await store.save(request.text, request.tags, request.source);
          this.sendTo(ws, {
            type: "memory_save_result",
            requestId,
            id,
            text: request.text,
            tags: request.tags ?? [],
          });
          break;
        }

        case "memory_update": {
          const success = await store.update(request.id, request.text, request.tags);
          this.sendTo(ws, { type: "memory_update_result", requestId, success });
          break;
        }

        case "memory_delete": {
          const success = await store.forget(request.id);
          this.sendTo(ws, { type: "memory_delete_result", requestId, success });
          break;
        }
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "memory_error", requestId, error: errorText });
    }
  }

  // ---------------------------------------------------------------------------
  // Event subscription — translates AgentEvent → AppResponse
  // ---------------------------------------------------------------------------

  private ensureSubscription(conversationId: string, session: any): void {
    if (this.subscriptions.has(conversationId)) return;
    this.subscriptions.add(conversationId);

    let contentIndex = 0;

    session.subscribe((event: any) => {
      const ws = this.conversationOwners.get(conversationId);
      if (!ws) return;

      if (event.type === "turn_start") {
        contentIndex = 0;
        return;
      }

      if (event.type === "message_update") {
        const e = event.assistantMessageEvent;
        if (!e) return;

        switch (e.type) {
          case "text_delta":
            this.sendTo(ws, {
              type: "text_delta",
              conversationId,
              delta: e.delta,
              contentIndex,
            });
            break;

          case "text_start":
            contentIndex++;
            break;

          case "thinking_delta":
            this.sendTo(ws, {
              type: "thinking_delta",
              conversationId,
              delta: e.delta,
              contentIndex,
            });
            break;

          case "thinking_end":
            this.sendTo(ws, {
              type: "thinking_end",
              conversationId,
              contentIndex,
            });
            break;
        }
        return;
      }

      if (event.type === "tool_execution_start") {
        this.sendTo(ws, {
          type: "tool_start",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          args: event.args ?? {},
        });
        return;
      }

      if (event.type === "tool_execution_update") {
        this.sendTo(ws, {
          type: "tool_update",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          partialResult: event.partialResult ?? "",
        });
        return;
      }

      if (event.type === "tool_execution_end") {
        const resultObj = event.result;
        const details = resultObj && typeof resultObj === "object" && "details" in resultObj
          ? (resultObj as any).details
          : undefined;
        const resultText = typeof resultObj === "string"
          ? resultObj
          : resultObj && typeof resultObj === "object" && "content" in resultObj
            ? JSON.stringify(resultObj)
            : JSON.stringify(resultObj ?? "");
        this.sendTo(ws, {
          type: "tool_end",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          result: resultText,
          isError: event.isError ?? false,
          ...(details !== undefined ? { details } : {}),
        });
        return;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Broadcast to all connected clients
  // ---------------------------------------------------------------------------

  broadcastArtifactsChanged(event: string, path: string): void {
    const msg: AppResponse = { type: "artifacts_changed", event, path };
    for (const ws of this.clients) {
      this.sendTo(ws, msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private sendTo(ws: WebSocket, response: AppResponse): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }
}
