import type { AgentToolResult } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// JSON result helper
// ---------------------------------------------------------------------------

export function jsonResult(payload: unknown): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: undefined,
  };
}

export function errorResult(message: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: undefined,
  };
}
