import { z } from "zod";
import {
  tool,
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Bridges sam's pi-coding-agent custom tools into an in-process Claude Agent
 * SDK MCP server. Each pi `AgentTool` becomes an SDK `tool()` whose handler
 * runs in this same process and calls the existing `tool.execute(...)`.
 *
 * Tool-call lifecycle events (`tool_execution_start`/`end`) are NOT emitted
 * here — the streaming adapter derives them from the SDK message stream so
 * they carry the SDK's real `tool_use` ids (needed for correct correlation in
 * the session JSONL). The one thing the stream can't see is sam's per-tool
 * `details` (e.g. the artifact card payload), so each handler pushes its
 * `details` onto a per-tool FIFO queue that the adapter drains in tool-result
 * order via `takeDetails`.
 */

export const MCP_SERVER_NAME = "sam";

/** Wire name the SDK exposes an MCP tool under, e.g. `mcp__sam__bash`. */
export const mcpToolWireName = (name: string): string =>
  `mcp__${MCP_SERVER_NAME}__${name}`;

export const isMcpToolWireName = (wireName: string): boolean =>
  wireName.startsWith(`mcp__${MCP_SERVER_NAME}__`);

/** Strip the `mcp__sam__` prefix so clients render the bare tool name. */
export const stripMcpPrefix = (wireName: string): string =>
  isMcpToolWireName(wireName)
    ? wireName.slice(`mcp__${MCP_SERVER_NAME}__`.length)
    : wireName;

// pi tool result content (TextContent | ImageContent)[] -> MCP content blocks
function toMcpContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [{ type: "text", text: String(content ?? "") }];
  }
  return content.map((c: any) => {
    if (c?.type === "image") {
      return { type: "image", data: c.data, mimeType: c.mimeType };
    }
    return {
      type: "text",
      text: typeof c?.text === "string" ? c.text : JSON.stringify(c ?? ""),
    };
  });
}

// ---------------------------------------------------------------------------
// JSON Schema (pi tools use TypeBox) -> Zod raw shape (what SDK `tool()` wants)
// ---------------------------------------------------------------------------

function jsonSchemaToZodType(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();

  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every((v: unknown) => typeof v === "string")
  ) {
    const t = z.enum(schema.enum as [string, ...string[]]);
    return schema.description ? t.describe(schema.description) : t;
  }

  let t: z.ZodTypeAny;
  switch (schema.type) {
    case "string":
      t = z.string();
      break;
    case "number":
    case "integer":
      t = z.number();
      break;
    case "boolean":
      t = z.boolean();
      break;
    case "array":
      t = z.array(schema.items ? jsonSchemaToZodType(schema.items) : z.any());
      break;
    case "object":
      t = z.object(jsonSchemaToZodShape(schema));
      break;
    default:
      t = z.any();
  }
  return schema.description ? t.describe(schema.description) : t;
}

/** Convert a JSON-Schema object node into a Zod raw shape (`{ key: ZodType }`). */
export function jsonSchemaToZodShape(
  schema: any,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = schema?.properties ?? {};
  const required: string[] = Array.isArray(schema?.required)
    ? schema.required
    : [];
  for (const [key, propSchema] of Object.entries(props)) {
    let zt = jsonSchemaToZodType(propSchema);
    if (!required.includes(key)) zt = zt.optional();
    shape[key] = zt;
  }
  return shape;
}

export interface ToolBridge {
  /** MCP server config to pass as `options.mcpServers.sam`. */
  server: McpSdkServerConfigWithInstance;
  /** Wire names (`mcp__sam__*`) for `allowedTools`. */
  wireToolNames: string[];
  /**
   * Drain the next `details` for a bridged tool, in tool-result arrival order.
   * Called by the adapter when it sees the matching `tool_result`.
   */
  takeDetails(wireName: string): unknown | undefined;
}

/**
 * @param piTools  sam's custom tools (from `buildCustomTools`)
 * @param getSignal returns the current turn's AbortSignal so tool execution
 *                  cancels on abort
 */
export function buildToolBridge(
  piTools: any[],
  getSignal: () => AbortSignal | undefined,
): ToolBridge {
  const detailsQueues = new Map<string, unknown[]>();

  const sdkTools = piTools.map((pt) => {
    const wire = mcpToolWireName(pt.name);
    const shape = jsonSchemaToZodShape(pt.parameters ?? {});
    const description = [pt.description, pt.promptSnippet]
      .filter(Boolean)
      .join("\n\n");

    return tool(
      pt.name,
      description,
      shape as any,
      async (args: any): Promise<any> => {
        let result: any;
        try {
          result = await pt.execute(
            `sam-${pt.name}-${Date.now()}`,
            args,
            getSignal(),
          );
        } catch (err) {
          // Keep queue 1:1 with tool_result arrivals.
          pushDetails(detailsQueues, wire, undefined);
          return {
            content: [
              {
                type: "text",
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
        pushDetails(detailsQueues, wire, result?.details);
        return {
          content: toMcpContent(result?.content ?? []),
          isError: result?.isError ?? false,
        };
      },
    );
  });

  const server = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "1.0.0",
    tools: sdkTools as any,
  });

  return {
    server,
    wireToolNames: piTools.map((pt) => mcpToolWireName(pt.name)),
    takeDetails: (wireName: string) => {
      const q = detailsQueues.get(wireName);
      return q && q.length > 0 ? q.shift() : undefined;
    },
  };
}

function pushDetails(
  queues: Map<string, unknown[]>,
  wire: string,
  details: unknown,
): void {
  const q = queues.get(wire);
  if (q) q.push(details);
  else queues.set(wire, [details]);
}
