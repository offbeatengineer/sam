import { sendRaw, generateRequestId } from "./tauri";
import type { MemoryKind, MemoryStatus } from "@/types/chat";

/** `status: "all"` includes memories that were replaced or forgotten. */
export function listMemories(limit?: number, offset?: number, status?: "active" | "all"): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_list", requestId, limit, offset, status });
  return requestId;
}

export function searchMemories(
  query: string,
  limit?: number,
  tags?: string[],
): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_search", requestId, query, limit, tags });
  return requestId;
}

export function saveMemory(
  text: string,
  tags?: string[],
  source?: string,
): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_save", requestId, text, tags, source });
  return requestId;
}

export function updateMemory(
  id: string,
  patch: { text?: string; tags?: string[]; kind?: MemoryKind; status?: MemoryStatus },
): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_update", requestId, id, ...patch });
  return requestId;
}

export function deleteMemory(id: string): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_delete", requestId, id });
  return requestId;
}
