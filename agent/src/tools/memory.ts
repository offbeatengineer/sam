import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { jsonResult, errorResult } from "./util.js";
import { MemoryStore } from "../memory/store.js";
import type { MemoryConfig } from "../memory/types.js";

// ---------------------------------------------------------------------------
// memory_save
// ---------------------------------------------------------------------------

const SaveParams = Type.Object({
  text: Type.String({ description: "The information to remember. Should be a concise, standalone statement." }),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "Descriptive tags for categorization (e.g. ['preference', 'project'])" }),
  ),
  source: Type.Optional(
    Type.String({ description: "Source of the memory: 'user' (told by user), 'observation' (inferred), 'agent' (self-generated)" }),
  ),
});

type SaveParamsT = Static<typeof SaveParams>;

export function createMemorySaveTool(config?: MemoryConfig): AgentTool {
  return {
    name: "memory_save",
    label: "Memory Save",
    description:
      "Save a piece of information to long-term memory. Use this to remember user preferences, " +
      "important facts, decisions, project details, or anything worth recalling later. " +
      "Write concise, standalone statements that will make sense out of context.",
    parameters: SaveParams,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as SaveParamsT;
      try {
        const store = await MemoryStore.getInstance(config);
        const id = await store.save(params.text, params.tags, params.source);
        return jsonResult({
          saved: true,
          id,
          text: params.text,
          tags: params.tags ?? [],
        });
      } catch (err) {
        return errorResult(
          `Failed to save memory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// memory_recall
// ---------------------------------------------------------------------------

const RecallParams = Type.Object({
  query: Type.String({ description: "Natural language query to search memories by semantic similarity" }),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of results (1-20)", minimum: 1, maximum: 20, default: 5 }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "Filter results to only memories with ALL of these tags" }),
  ),
});

type RecallParamsT = Static<typeof RecallParams>;

export function createMemoryRecallTool(config?: MemoryConfig): AgentTool {
  return {
    name: "memory_recall",
    label: "Memory Recall",
    description:
      "Search long-term memory by semantic similarity. Use this to recall user preferences, " +
      "past decisions, project details, or any previously saved information. " +
      "Use at the start of conversations or before answering contextual questions.",
    parameters: RecallParams,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as RecallParamsT;
      try {
        const store = await MemoryStore.getInstance(config);
        const results = await store.recall({
          query: params.query,
          limit: params.limit,
          tags: params.tags,
        });
        return jsonResult({
          results,
          count: results.length,
        });
      } catch (err) {
        return errorResult(
          `Failed to recall memories: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// memory_update
// ---------------------------------------------------------------------------

const UpdateParams = Type.Object({
  id: Type.String({ description: "The ID of the memory to update (from a previous recall result)" }),
  text: Type.String({ description: "The new text content for this memory" }),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "New tags to replace existing ones" }),
  ),
});

type UpdateParamsT = Static<typeof UpdateParams>;

export function createMemoryUpdateTool(config?: MemoryConfig): AgentTool {
  return {
    name: "memory_update",
    label: "Memory Update",
    description:
      "Update an existing memory's text and tags. Use this when information needs to be corrected " +
      "or refined rather than deleted and recreated. Get the ID from a memory_recall result first.",
    parameters: UpdateParams,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as UpdateParamsT;
      try {
        const store = await MemoryStore.getInstance(config);
        const updated = await store.update(params.id, params.text, params.tags);
        if (updated) {
          return jsonResult({ updated: true, id: params.id, text: params.text, tags: params.tags ?? [] });
        } else {
          return errorResult(`Memory with id '${params.id}' not found.`);
        }
      } catch (err) {
        return errorResult(
          `Failed to update memory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// memory_forget
// ---------------------------------------------------------------------------

const ForgetParams = Type.Object({
  id: Type.String({ description: "The ID of the memory to delete (from a previous recall result)" }),
});

type ForgetParamsT = Static<typeof ForgetParams>;

export function createMemoryForgetTool(config?: MemoryConfig): AgentTool {
  return {
    name: "memory_forget",
    label: "Memory Forget",
    description:
      "Delete a specific memory by ID. Use this when information is outdated, incorrect, " +
      "or when the user asks you to forget something. Get the ID from a memory_recall result first.",
    parameters: ForgetParams,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as ForgetParamsT;
      try {
        const store = await MemoryStore.getInstance(config);
        const forgotten = await store.forget(params.id);
        if (forgotten) {
          return jsonResult({ forgotten: true, id: params.id });
        } else {
          return errorResult(`Memory with id '${params.id}' not found.`);
        }
      } catch (err) {
        return errorResult(
          `Failed to forget memory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
