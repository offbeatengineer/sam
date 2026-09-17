import { stripMessageHeader } from "../types.js";
import { estimateTokens, truncate } from "./judgments.js";

// ---------------------------------------------------------------------------
// What happened in one turn beyond the user's words: everything the assistant
// said and what its tools returned. Pure, so it is tested on plain entries and
// works on the transcript either backend persists.
// ---------------------------------------------------------------------------

/** One tool result the knowledge writer may read. */
export interface ToolSource {
  /** The tool the content came from; "web_fetch" for a page that was fetched to a file and then read. */
  tool: string;
  /** The call's arguments as compact JSON, for the writer to tell sources apart. */
  args: string;
  /** Set when the call named a URL or read a page web_fetch saved; becomes the memory's citation. */
  url?: string;
  text: string;
  timestamp: number;
}

export interface Exchange {
  userMessages: string[];
  /** Every assistant text segment of the turn, in order. */
  assistantReply: string;
  /** One line per tool call, results not included: all the gate needs. */
  toolCalls: string[];
  sources: ToolSource[];
  /** When the exchange started. */
  timestamp: number;
}

/**
 * Results of these would feed memory back into itself: a recalled note saved
 * again as "knowledge" outlives the note it came from.
 */
const SELF_REFERENTIAL = /^(memory_|session_(search|read)$)/;

const MAX_CALL_ARGS_CHARS = 200;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function compactArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return "";
  }
}

function urlOf(args: unknown): string | undefined {
  const url = (args as any)?.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * The exchange recorded in `entries[fromIndex..]`. `allowedTools` narrows whose
 * results become sources; tool calls are always listed, since the gate only
 * sees their names and arguments.
 */
export function extractExchange(entries: any[], fromIndex: number, allowedTools: "all" | string[] = "all"): Exchange {
  const exchange: Exchange = { userMessages: [], assistantReply: "", toolCalls: [], sources: [], timestamp: 0 };
  const replies: string[] = [];
  const calls = new Map<string, { tool: string; args: unknown }>();
  const allowed = allowedTools === "all" ? undefined : new Set(allowedTools);
  // web_fetch returns only metadata and saves the page to a temp file, which the model then
  // opens with a file tool. The content is web content all the same: it keeps the page's URL
  // and counts as web_fetch for the allowlist.
  const fetchedFiles = new Map<string, string>();

  for (const entry of entries.slice(fromIndex)) {
    if (entry?.type !== "message" || !entry.message) continue;
    const msg = entry.message;
    const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

    if (msg.role === "user") {
      const text = stripMessageHeader(textOf(msg.content).trim());
      if (!text) continue;
      exchange.userMessages.push(text);
      exchange.timestamp ||= timestamp;
    } else if (msg.role === "assistant") {
      const text = textOf(msg.content).trim();
      if (text) replies.push(text);
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type !== "toolCall" || typeof block.name !== "string") continue;
        calls.set(block.id, { tool: block.name, args: block.arguments });
        exchange.toolCalls.push(`${block.name} ${truncate(compactArgs(block.arguments), MAX_CALL_ARGS_CHARS)}`);
      }
    } else if (msg.role === "toolResult") {
      if (msg.isError === true) continue;
      const call = calls.get(msg.toolCallId);
      let tool: string = msg.toolName || call?.tool || "";
      if (!tool || SELF_REFERENTIAL.test(tool)) continue;

      const saved = msg.details?.tmpFile;
      if (typeof saved === "string" && saved) {
        const pageUrl = urlOf(msg.details) ?? urlOf(call?.args);
        if (pageUrl) fetchedFiles.set(saved, pageUrl);
        continue; // metadata only; the content arrives when the file is read
      }

      const args = compactArgs(call?.args);
      let url = urlOf(call?.args);
      if (!url) {
        for (const [file, pageUrl] of fetchedFiles) {
          if (!args.includes(file)) continue;
          url = pageUrl;
          tool = "web_fetch";
          break;
        }
      }
      if (allowed && !allowed.has(tool)) continue;
      const text = textOf(msg.content).trim();
      if (!text) continue;
      exchange.sources.push({ tool, args, url, text, timestamp });
    }
  }

  exchange.assistantReply = replies.join("\n\n");
  return exchange;
}

/**
 * Cut sources down to a shared token budget. Small sources stay whole and the
 * room they leave goes to the large ones, so one huge page cannot crowd out
 * the rest.
 */
export function fitSources(sources: ToolSource[], budgetTokens: number): ToolSource[] {
  const costs = sources.map((s) => estimateTokens(s.text));
  if (costs.reduce((a, b) => a + b, 0) <= budgetTokens) return sources;

  // Water-filling: settle the smallest sources first, then split what is left evenly.
  const order = costs.map((_, i) => i).sort((a, b) => costs[a] - costs[b]);
  const share = new Array<number>(sources.length).fill(0);
  let room = Math.max(0, budgetTokens);
  order.forEach((i, rank) => {
    share[i] = Math.min(costs[i], Math.floor(room / (order.length - rank)));
    room -= share[i];
  });

  return sources.map((s, i) => {
    if (share[i] >= costs[i]) return s;
    // Scale characters by the token ratio, so CJK text is cut as hard as it costs.
    const chars = Math.floor(s.text.length * (share[i] / costs[i]));
    return { ...s, text: `${s.text.slice(0, chars)}\n[... truncated]` };
  });
}
