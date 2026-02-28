import { WebSocketServer, type WebSocket } from "ws";
import type { SessionRegistry } from "../session-registry.js";
import type { AppRequest, AppResponse } from "../protocol.js";
import type { SessionKey } from "../types.js";
import { MemoryStore } from "../memory/store.js";
import type { MemoryConfig } from "../memory/types.js";

interface AppChannelOptions {
  port: number;
  host?: string;
  registry: SessionRegistry;
  memoryConfig?: MemoryConfig;
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
        this.sendTo(ws, {
          type: "tool_end",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          result: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? ""),
          isError: event.isError ?? false,
        });
        return;
      }
    });
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
