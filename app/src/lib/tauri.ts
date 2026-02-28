import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppResponse } from "@/types/chat";

// Request ID counter for correlation
let requestCounter = 0;

/**
 * Generate a unique request ID for correlating requests with responses
 */
export function generateRequestId(): string {
  return `req_${++requestCounter}_${Date.now()}`;
}

// IPC command wrappers

/**
 * Connect to a running sam instance via WebSocket
 */
export async function connectToSam(url: string): Promise<void> {
  return invoke("connect_to_sam", { url });
}

/**
 * Disconnect from sam
 */
export async function disconnectFromSam(): Promise<void> {
  return invoke("disconnect_from_sam");
}

/**
 * Check if connected to sam
 */
export async function isConnected(): Promise<boolean> {
  return invoke("is_connected");
}

/**
 * Send a chat message to sam for a specific task.
 * Returns the requestId for correlating responses.
 */
export async function sendChat(
  taskId: string,
  message: string,
): Promise<string> {
  const requestId = generateRequestId();
  await invoke("send_chat", { taskId, message, requestId });
  return requestId;
}

/**
 * Close the session for a specific task
 */
export async function closeSession(taskId: string): Promise<void> {
  return invoke("close_session", { taskId });
}

/**
 * Abort the current turn for a specific task
 */
export async function abortTurn(taskId: string): Promise<void> {
  return invoke("abort_turn", { taskId });
}

/**
 * Send a raw JSON request to sam (for non-chat protocol messages like memory operations)
 */
export async function sendRaw(request: Record<string, unknown>): Promise<void> {
  return invoke("send_raw", { request });
}

// Event listener types
export type AppResponseHandler = (response: AppResponse) => void;

/**
 * Listen for app response events from sam via Tauri
 */
export async function onAppResponse(
  handler: AppResponseHandler
): Promise<UnlistenFn> {
  return listen<AppResponse>("app-response", (event) => {
    handler(event.payload);
  });
}
