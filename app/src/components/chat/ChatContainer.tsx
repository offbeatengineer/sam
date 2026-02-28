import { useCallback } from "react";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { useSessionStore, sessionIdFor } from "@/stores/sessionStore";
import { useTauriEvents } from "@/hooks/useTauriEvents";
import { showTaskNotification } from "@/lib/notifications";
import type { AppResponse } from "@/types/chat";

export function ChatContainer() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);

  const handleAppResponse = useCallback((response: AppResponse) => {
    const store = useSessionStore.getState();

    // Session browsing responses are handled by sessionStore's global listener
    if (response.type === "sessions_list" || response.type === "session_entries") {
      return;
    }

    // Streaming responses use conversationId
    const conversationId = response.conversationId;
    if (!conversationId) return;

    const sessionId = sessionIdFor("app", conversationId);

    switch (response.type) {
      case "turn_start":
        store.beginStreaming(sessionId);
        break;

      case "text_delta":
        if (response.delta) {
          store.appendTextDelta(response.delta);
        }
        break;

      case "thinking_delta":
        if (response.delta) {
          store.appendThinkingDelta(response.delta);
        }
        break;

      case "thinking_end":
        store.completeThinking();
        break;

      case "tool_start":
        if (response.toolCallId && response.toolName) {
          store.addToolStart(
            response.toolCallId,
            response.toolName,
            response.args ?? {},
          );
        }
        break;

      case "tool_update":
        if (response.toolCallId) {
          store.updateTool(response.toolCallId, response.partialResult ?? "");
        }
        break;

      case "tool_end":
        if (response.toolCallId) {
          store.endTool(
            response.toolCallId,
            response.result ?? "",
            response.isError ?? false,
          );
        }
        break;

      case "turn_end":
        store.endStreaming();
        // Show notification if not active session
        if (sessionId !== store.activeSessionId && !document.hasFocus()) {
          showTaskNotification(conversationId);
        }
        break;

      case "error":
        store.endStreaming();
        break;

      case "aborted":
        store.endStreaming();
        break;

      case "session_created":
      case "session_closed":
        break;
    }
  }, []);

  useTauriEvents(handleAppResponse);

  // Determine if input should be disabled (non-app sessions are read-only)
  const activeSession = useSessionStore((state) => state.getActiveSession());
  const isReadOnly = activeSession ? activeSession.channelId !== "app" : false;

  if (!activeSessionId) {
    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        <ChatHeader />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Select or start a session</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <ChatHeader />
      <MessageList />
      {!isReadOnly && <MessageInput />}
      {isReadOnly && (
        <div className="absolute bottom-4 left-0 right-0 z-10 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <span className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
              Read-only session ({activeSession?.channelId})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
