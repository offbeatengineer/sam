import { sendRaw, generateRequestId } from "./tauri";

export function searchSessions(
  query: string,
  limit?: number,
): string {
  const requestId = generateRequestId();
  sendRaw({ type: "session_search", requestId, query, limit });
  return requestId;
}
