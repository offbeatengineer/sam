import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { jsonResult, errorResult } from "./util.js";
import { SessionSearchStore } from "../session-search/store.js";
import type { MemoryConfig } from "../memory/types.js";

const Params = Type.Object({
  query: Type.String({ description: "Natural language query to search past conversations" }),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of results (1-20)", minimum: 1, maximum: 20, default: 5 }),
  ),
  role: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("assistant")], {
      description: "Filter to only user or assistant messages",
    }),
  ),
});

type ParamsT = Static<typeof Params>;

export function createSessionSearchTool(config?: MemoryConfig): AgentTool {
  return {
    name: "session_search",
    label: "Session Search",
    description:
      "Search past conversation messages by semantic similarity. Use this to find what was discussed " +
      "in previous sessions — decisions, code snippets, topics, or any past conversation context. " +
      "Returns matching message snippets with session metadata.",
    parameters: Params,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as ParamsT;
      try {
        const store = await SessionSearchStore.getInstance(config);
        const results = await store.search(params.query, params.limit, {
          role: params.role,
        });
        return jsonResult({
          results: results.map((r) => ({
            text: r.text,
            role: r.role,
            score: r.score,
            session_name: r.session_name,
            conversation_id: r.conversation_id,
            channel_id: r.channel_id,
            timestamp: r.timestamp,
          })),
          count: results.length,
        });
      } catch (err) {
        return errorResult(
          `Failed to search sessions: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
