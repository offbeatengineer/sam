import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { Button } from "@/components/ui/button";
import { NewTaskDialog } from "@/components/sidebar/NewTaskDialog";
import { useConversationStore } from "@/stores/conversationStore";
import { useTaskStore } from "@/stores/taskStore";
import { useTauriEvents } from "@/hooks/useTauriEvents";
import { showTaskNotification } from "@/lib/notifications";
import { extractArtifactsFromMessages } from "@/lib/storage";
import type { AppResponse, ToolExecution } from "@/types/chat";

export function ChatContainer() {
  const activeTaskId = useConversationStore((state) => state.activeTaskId);
  const { createNewTask } = useTaskStore();
  const [isNewTaskDialogOpen, setIsNewTaskDialogOpen] = useState(false);

  const handleNewTaskConfirm = (workingDirectory?: string) => {
    createNewTask("New task", workingDirectory);
    setIsNewTaskDialogOpen(false);
  };

  const handleAppResponse = useCallback((response: AppResponse) => {
    const taskId = response.conversationId;

    if (!taskId) {
      console.warn("[ChatContainer] Response has no conversationId, ignoring");
      return;
    }

    const store = useConversationStore.getState();
    const conv = store.conversations.get(taskId);
    const currentActiveTaskId = store.activeTaskId;

    switch (response.type) {
      case "turn_start":
        // A new turn started — create assistant message placeholder
        // (streaming state should already be set by MessageInput)
        break;

      case "text_delta":
        if (response.delta && conv?.lastAssistantMessageId) {
          store.appendToLastTextBlock(taskId, conv.lastAssistantMessageId, response.delta);
          if (taskId !== currentActiveTaskId) {
            store.markAsUnread(taskId);
          }
        }
        break;

      case "thinking_delta":
        if (response.delta && conv?.lastAssistantMessageId) {
          store.appendToLastThinkingBlock(taskId, conv.lastAssistantMessageId, response.delta);
        }
        break;

      case "thinking_end":
        if (conv?.lastAssistantMessageId) {
          store.completeLastThinkingBlock(taskId, conv.lastAssistantMessageId);
        }
        break;

      case "tool_start":
        if (response.toolName && conv?.lastAssistantMessageId) {
          const toolExecution: ToolExecution = {
            id: response.toolCallId || `tool-${Math.random().toString(36).substring(2, 11)}`,
            name: response.toolName,
            status: "running",
            expanded: false,
            input: response.args as Record<string, unknown>,
          };
          store.addToolExecution(taskId, conv.lastAssistantMessageId, toolExecution);
        }
        break;

      case "tool_update":
        if (response.toolCallId && conv?.lastAssistantMessageId) {
          store.updateToolExecution(
            taskId,
            conv.lastAssistantMessageId,
            response.toolCallId,
            { details: response.partialResult }
          );
        }
        break;

      case "tool_end":
        if (response.toolCallId && conv?.lastAssistantMessageId) {
          store.updateToolExecution(
            taskId,
            conv.lastAssistantMessageId,
            response.toolCallId,
            {
              status: response.isError ? "error" : "success",
              output: response.result,
            }
          );
        }
        break;

      case "turn_end":
        // Turn completed — finalize streaming
        store.setStreaming(taskId, false);
        store.setLastAssistantMessageId(taskId, null);

        // Extract artifacts from messages
        {
          const updatedConv = store.conversations.get(taskId);
          if (updatedConv) {
            const extractedArtifacts = extractArtifactsFromMessages(updatedConv.messages);
            store.addArtifacts(taskId, extractedArtifacts);
          }
        }

        // Save conversation
        store.saveTaskConversation(taskId);

        // Show notification if not active task and window unfocused
        if (taskId !== currentActiveTaskId && !document.hasFocus()) {
          showTaskNotification(taskId);
        }
        break;

      case "error":
        store.setStreaming(taskId, false);
        if (response.error && conv?.lastAssistantMessageId) {
          store.updateMessage(taskId, conv.lastAssistantMessageId, {
            content: `Error: ${response.error}`,
          });
        }
        break;

      case "aborted":
        store.setStreaming(taskId, false);
        store.setLastAssistantMessageId(taskId, null);
        break;

      case "session_created":
      case "session_closed":
        // Informational — no action needed
        break;
    }
  }, []);

  // Listen for app response events from Tauri
  useTauriEvents(handleAppResponse);

  // Show "New task" button when no task is active
  if (!activeTaskId) {
    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        <ChatHeader />
        <div className="flex-1 flex items-center justify-center">
          <Button onClick={() => setIsNewTaskDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New task
          </Button>
          <NewTaskDialog
            isOpen={isNewTaskDialogOpen}
            onClose={() => setIsNewTaskDialogOpen(false)}
            onConfirm={handleNewTaskConfirm}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <ChatHeader />
      <MessageList />
      <MessageInput />
    </div>
  );
}
