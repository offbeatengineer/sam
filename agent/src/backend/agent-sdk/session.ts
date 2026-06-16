import { resolve } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  AgentSessionEvent,
  PromptOptions,
} from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  StopReason,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import { type SamConfig } from "../../config.js";
import type { SessionKey } from "../../types.js";
import type { KitsServer } from "../../kits-server.js";
import { buildCustomTools, buildSystemPromptText } from "../../agent-factory.js";
import type { SamAgentSession } from "../types.js";
import {
  buildToolBridge,
  isMcpToolWireName,
  MCP_SERVER_NAME,
  stripMcpPrefix,
  type ToolBridge,
} from "./tool-bridge.js";

type Listener = (event: AgentSessionEvent) => void;

/** Map sam's thinking level onto the SDK's effort knob. */
function effortForThinking(
  level: string | undefined,
): Options["effort"] | undefined {
  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
    default:
      return undefined; // "off" / unknown -> let the model decide
  }
}

function mapStopReason(s: unknown): StopReason {
  switch (s) {
    case "tool_use":
      return "toolUse";
    case "max_tokens":
      return "length";
    case "end_turn":
    case "stop_sequence":
    default:
      return "stop";
  }
}

function mapUsage(u: any, finalOutput?: number): Usage {
  const input = u?.input_tokens ?? 0;
  // The complete assistant frame carries the message_start usage snapshot
  // (tiny output_tokens). The real total arrives in the message_delta event.
  const output = finalOutput ?? u?.output_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

// Normalize an SDK tool_result `content` (string | block[]) to pi content.
function toPiToolContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) {
    return [{ type: "text", text: JSON.stringify(content ?? "") }];
  }
  return content.map((c: any) => {
    if (c?.type === "image") {
      const data = c.data ?? c.source?.data ?? "";
      const mimeType = c.mimeType ?? c.source?.media_type ?? "image/png";
      return { type: "image", data, mimeType };
    }
    return {
      type: "text",
      text: typeof c?.text === "string" ? c.text : JSON.stringify(c ?? ""),
    };
  });
}

// A single user message carrying optional image content (for image prompts).
async function* singleUserMessage(
  text: string,
  images: Array<{ data: string; mimeType: string }>,
): AsyncGenerator<any> {
  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  for (const img of images) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.data },
    });
  }
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content },
  };
}

interface TurnAccumulator {
  blockTypes: Map<number, string>;
  /** Final output_tokens for the in-flight request, from its message_delta event. */
  requestFinalOutput?: number;
  /**
   * Assistant messages for the in-flight request, buffered until the request
   * ends. The per-block assistant frames only carry the message_start usage
   * snapshot (tiny output_tokens); the real total arrives later in
   * message_delta. flushPending() stamps it and writes the JSONL. Flushed on
   * the next message_start, when tool results arrive, and at turn end.
   */
  pendingAssistants: AssistantMessage[];
}

class AgentSdkSession implements SamAgentSession {
  private readonly listeners = new Set<Listener>();
  private readonly bridge: ToolBridge;
  private readonly baseOptions: Options;
  private readonly mappingPath: string;

  /** SDK session id for resume; captured from the init message. */
  private sdkSessionId: string | undefined;
  private currentAbort: AbortController | undefined;
  private turnRunning = false;

  /** tool_use id -> call info, rebuilt each turn from assistant messages. */
  private readonly idToCall = new Map<
    string,
    { name: string; rawName: string }
  >();

  constructor(
    private readonly config: SamConfig,
    private readonly cwd: string,
    sessionDir: string,
    public readonly sessionManager: SessionManager,
    piTools: any[],
    systemPrompt: string,
  ) {
    this.bridge = buildToolBridge(piTools, () => this.currentAbort?.signal);
    this.mappingPath = resolve(sessionDir, "sdk-session.json");
    this.sdkSessionId = this.loadMapping();

    this.baseOptions = {
      cwd,
      model: config.model.id,
      systemPrompt,
      mcpServers: { [MCP_SERVER_NAME]: this.bridge.server },
      // Use the SDK's genuine file tools; sam-specific tools come via MCP.
      tools: ["Read", "Edit", "Write", "Glob", "Grep"],
      allowedTools: [
        ...this.bridge.wireToolNames,
        "Read",
        "Edit",
        "Write",
        "Glob",
        "Grep",
      ],
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Don't load ~/.claude settings/CLAUDE.md — sam owns its config.
      settingSources: [],
      env: { ...process.env },
      executable: "bun",
    };
    if (config.model.thinking === "off") {
      this.baseOptions.thinking = { type: "disabled" };
    } else {
      // Summarized thinking so readable reasoning both streams (thinking_delta)
      // and persists in the assistant message — the default is redacted/encrypted
      // thinking with no plaintext content.
      this.baseOptions.thinking = { type: "adaptive", display: "summarized" };
      const effort = effortForThinking(config.model.thinking);
      if (effort) this.baseOptions.effort = effort;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: any): void {
    for (const l of this.listeners) {
      try {
        l(event as AgentSessionEvent);
      } catch (err) {
        console.error("[agent-sdk] listener error:", err);
      }
    }
  }

  abort(): void {
    this.currentAbort?.abort();
  }

  dispose(): void {
    this.currentAbort?.abort();
    this.listeners.clear();
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    if (this.turnRunning) {
      throw new Error(
        "A turn is already in progress for this conversation (agent-sdk backend serializes turns).",
      );
    }
    this.turnRunning = true;
    const abort = new AbortController();
    this.currentAbort = abort;
    this.idToCall.clear();
    const acc: TurnAccumulator = { blockTypes: new Map(), pendingAssistants: [] };

    try {
      this.sessionManager.appendMessage({
        role: "user",
        content: text,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("[agent-sdk] failed to persist user message:", err);
    }

    this.emit({ type: "turn_start" });

    const images = (options as any)?.images ?? [];
    const promptArg =
      images.length > 0 ? singleUserMessage(text, images) : text;

    const queryOptions: Options = {
      ...this.baseOptions,
      abortController: abort,
      ...(this.sdkSessionId ? { resume: this.sdkSessionId } : {}),
    };

    let errored: Error | undefined;
    try {
      const q = query({ prompt: promptArg as any, options: queryOptions });
      for await (const msg of q as AsyncIterable<any>) {
        try {
          this.handleSdkMessage(msg, acc);
        } catch (err) {
          console.error("[agent-sdk] message handler error:", err);
        }
        if (msg?.type === "result" && msg.subtype !== "success") {
          const detail = Array.isArray(msg.errors) && msg.errors.length
            ? ` — ${msg.errors.join("; ")}`
            : "";
          errored = new Error(`Agent SDK turn failed: ${msg.subtype}${detail}`);
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        errored = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      this.flushPending(acc); // persist the final request's assistant messages
      this.turnRunning = false;
      this.currentAbort = undefined;
    }

    if (errored && !abort.signal.aborted) throw errored;
  }

  // -------------------------------------------------------------------------
  // SDK message -> pi event translation + JSONL persistence
  // -------------------------------------------------------------------------

  private handleSdkMessage(msg: any, acc: TurnAccumulator): void {
    switch (msg?.type) {
      case "system":
        if (msg.subtype === "init") {
          if (msg.session_id) {
            this.sdkSessionId = msg.session_id;
            this.saveMapping(msg.session_id);
          }
          console.log(
            `[agent-sdk] auth=${msg.apiKeySource} model=${msg.model} session=${msg.session_id}`,
          );
        }
        break;
      case "stream_event":
        this.handleStreamEvent(msg.event, acc);
        break;
      case "assistant":
        this.handleAssistant(msg, acc);
        break;
      case "user":
        this.handleUser(msg, acc);
        break;
      case "result":
        this.handleResult(msg);
        break;
    }
  }

  private handleStreamEvent(event: any, acc: TurnAccumulator): void {
    switch (event?.type) {
      case "message_start":
        // New request begins — persist the previous request's buffered
        // assistant messages before resetting the per-request output counter.
        this.flushPending(acc);
        acc.blockTypes.clear();
        acc.requestFinalOutput = undefined;
        break;
      case "message_delta": {
        const out = event.usage?.output_tokens;
        if (typeof out === "number") acc.requestFinalOutput = out;
        break;
      }
      case "content_block_start": {
        const cb = event.content_block;
        acc.blockTypes.set(event.index, cb?.type);
        if (cb?.type === "text") {
          this.emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_start" },
          });
        }
        break;
      }
      case "content_block_delta": {
        const d = event.delta;
        if (d?.type === "text_delta") {
          this.emit({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: d.text },
          });
        } else if (d?.type === "thinking_delta") {
          this.emit({
            type: "message_update",
            assistantMessageEvent: { type: "thinking_delta", delta: d.thinking },
          });
        }
        break;
      }
      case "content_block_stop": {
        if (acc.blockTypes.get(event.index) === "thinking") {
          this.emit({
            type: "message_update",
            assistantMessageEvent: { type: "thinking_end" },
          });
        }
        break;
      }
    }
  }

  private handleAssistant(msg: any, acc: TurnAccumulator): void {
    const blocks: any[] = msg.message?.content ?? [];
    const piContent: any[] = [];

    for (const b of blocks) {
      if (b?.type === "text") {
        piContent.push({ type: "text", text: b.text ?? "" });
      } else if (b?.type === "thinking") {
        piContent.push({
          type: "thinking",
          thinking: b.thinking ?? "",
          thinkingSignature: b.signature,
        });
      } else if (b?.type === "tool_use") {
        const rawName: string = b.name;
        const name = stripMcpPrefix(rawName);
        this.idToCall.set(b.id, { name, rawName });
        piContent.push({
          type: "toolCall",
          id: b.id,
          name,
          arguments: b.input ?? {},
        });
        this.emit({
          type: "tool_execution_start",
          toolCallId: b.id,
          toolName: name,
          args: b.input ?? {},
        });
      }
    }

    const assistantMsg: AssistantMessage = {
      role: "assistant",
      content: piContent,
      api: "anthropic-messages",
      provider: "anthropic",
      model: msg.message?.model ?? this.config.model.id,
      usage: mapUsage(msg.message?.usage, acc.requestFinalOutput),
      stopReason: mapStopReason(msg.message?.stop_reason),
      timestamp: Date.now(),
    };

    // Buffer rather than persist now: the correct output_tokens for this
    // request only arrives later (message_delta). flushPending() stamps it and
    // writes the JSONL once the request ends.
    acc.pendingAssistants.push(assistantMsg);
    this.emit({ type: "message_end", message: assistantMsg });
  }

  /** Stamp the final output_tokens onto buffered assistant messages and persist them. */
  private flushPending(acc: TurnAccumulator): void {
    if (acc.pendingAssistants.length === 0) return;
    const finalOutput = acc.requestFinalOutput;
    for (const msg of acc.pendingAssistants) {
      if (typeof finalOutput === "number") {
        msg.usage.output = finalOutput;
        msg.usage.totalTokens =
          msg.usage.input +
          msg.usage.output +
          msg.usage.cacheRead +
          msg.usage.cacheWrite;
      }
      try {
        this.sessionManager.appendMessage(msg);
      } catch (err) {
        console.error("[agent-sdk] failed to persist assistant message:", err);
      }
    }
    acc.pendingAssistants = [];
  }

  private handleUser(msg: any, acc: TurnAccumulator): void {
    // Persist buffered assistant messages before their tool results so the
    // JSONL stays correctly ordered (assistant turn, then its tool results).
    this.flushPending(acc);
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;

    for (const b of content) {
      if (b?.type !== "tool_result") continue;
      const call = this.idToCall.get(b.tool_use_id);
      const toolName = call?.name ?? "";
      const isError = b.is_error === true;
      const piResultContent = toPiToolContent(b.content);
      const details =
        call && isMcpToolWireName(call.rawName)
          ? this.bridge.takeDetails(call.rawName)
          : undefined;

      this.emit({
        type: "tool_execution_end",
        toolCallId: b.tool_use_id,
        toolName,
        result: { content: piResultContent, details },
        isError,
      });

      const toolResultMsg: ToolResultMessage = {
        role: "toolResult",
        toolCallId: b.tool_use_id,
        toolName,
        content: piResultContent as any,
        details,
        isError,
        timestamp: Date.now(),
      };
      try {
        this.sessionManager.appendMessage(toolResultMsg);
      } catch (err) {
        console.error("[agent-sdk] failed to persist tool result:", err);
      }
    }
  }

  private handleResult(msg: any): void {
    if (msg.subtype === "success") {
      const cost =
        typeof msg.total_cost_usd === "number"
          ? `$${msg.total_cost_usd.toFixed(4)}`
          : "n/a";
      console.log(
        `[agent-sdk] turn complete: cost=${cost} turns=${msg.num_turns}`,
      );
    } else {
      console.warn(`[agent-sdk] turn ended: ${msg.subtype}`);
    }
  }

  // -------------------------------------------------------------------------
  // conversationId <-> SDK session id mapping (for resume across turns)
  // -------------------------------------------------------------------------

  private loadMapping(): string | undefined {
    try {
      if (existsSync(this.mappingPath)) {
        const data = JSON.parse(readFileSync(this.mappingPath, "utf-8"));
        return typeof data?.sdkSessionId === "string"
          ? data.sdkSessionId
          : undefined;
      }
    } catch (err) {
      console.error("[agent-sdk] failed to read session mapping:", err);
    }
    return undefined;
  }

  private saveMapping(sdkSessionId: string): void {
    try {
      writeFileSync(
        this.mappingPath,
        JSON.stringify({ sdkSessionId, lastUpdated: Date.now() }),
      );
    } catch (err) {
      console.error("[agent-sdk] failed to write session mapping:", err);
    }
  }
}

export async function createAgentSdkSession(
  config: SamConfig,
  key: SessionKey,
  kitsServer?: KitsServer,
): Promise<SamAgentSession> {
  const cwd = config.workspace;
  const sessionDir = resolve(config.sessions, key.channelId, key.conversationId);
  mkdirSync(sessionDir, { recursive: true });

  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  const piTools = buildCustomTools(config, cwd, kitsServer);
  const systemPrompt = buildSystemPromptText(config);

  return new AgentSdkSession(
    config,
    cwd,
    sessionDir,
    sessionManager,
    piTools,
    systemPrompt,
  );
}
