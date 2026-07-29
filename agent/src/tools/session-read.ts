import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { jsonResult, errorResult } from "./util.js";
import { SessionSearchStore } from "../session-search/store.js";
import { extractMessages } from "../session-search/extract.js";
import type { MemoryConfig } from "../memory/types.js";

const Params = Type.Object({
  conversation_id: Type.String({ description: "Conversation ID from session_search results" }),
  around_timestamp: Type.Optional(
    Type.Number({ description: "Center the reading window around this timestamp (ms since epoch)" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Number of messages to return (1-50)", minimum: 1, maximum: 50, default: 20 }),
  ),
});

type ParamsT = Static<typeof Params>;

export function createSessionReadTool(config?: MemoryConfig): AgentTool {
  return {
    name: "session_read",
    label: "Session Read",
    description:
      "Read messages from a specific past session by conversation ID. Use after session_search " +
      "to get full context around a relevant result. Returns a window of messages from the session.",
    parameters: Params,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as ParamsT;
      const limit = params.limit ?? 20;

      try {
        const store = await SessionSearchStore.getInstance(config);
        const sessionPath = await store.getSessionPath(params.conversation_id);

        if (!sessionPath) {
          return errorResult(`No indexed session found for conversation_id: ${params.conversation_id}`);
        }

        const sessionDir = dirname(sessionPath);
        const sm = SessionManager.open(sessionPath, sessionDir);
        const entries = sm.getEntries();
        const sessionName = sm.getSessionName() ?? "";
        const allMessages = extractMessages(entries);

        if (allMessages.length === 0) {
          return jsonResult({
            session_name: sessionName,
            conversation_id: params.conversation_id,
            messages: [],
            total_messages: 0,
          });
        }

        let selected: typeof allMessages;

        if (params.around_timestamp != null) {
          // Find closest message to the target timestamp
          let closestIdx = 0;
          let closestDist = Math.abs(allMessages[0].timestamp - params.around_timestamp);
          for (let i = 1; i < allMessages.length; i++) {
            const dist = Math.abs(allMessages[i].timestamp - params.around_timestamp);
            if (dist < closestDist) {
              closestDist = dist;
              closestIdx = i;
            }
          }

          const half = Math.floor(limit / 2);
          let start = Math.max(0, closestIdx - half);
          let end = Math.min(allMessages.length, start + limit);
          // Adjust start if we're near the end
          if (end - start < limit) {
            start = Math.max(0, end - limit);
          }
          selected = allMessages.slice(start, end);
        } else {
          // Return the last `limit` messages
          selected = allMessages.slice(-limit);
        }

        return jsonResult({
          session_name: sessionName,
          conversation_id: params.conversation_id,
          messages: selected.map((m) => ({
            role: m.role,
            text: m.text,
            timestamp: m.timestamp,
          })),
          total_messages: allMessages.length,
        });
      } catch (err) {
        return errorResult(
          `Failed to read session: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
