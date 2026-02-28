import { sendRaw, generateRequestId } from "./tauri";

export function listMemories(limit?: number, offset?: number): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_list", requestId, limit, offset });
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
  text: string,
  tags?: string[],
): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_update", requestId, id, text, tags });
  return requestId;
}

export function deleteMemory(id: string): string {
  const requestId = generateRequestId();
  sendRaw({ type: "memory_delete", requestId, id });
  return requestId;
}
