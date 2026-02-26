import { useRef, useEffect, useLayoutEffect, useCallback, useState } from "react";
import { ArrowUp, Brain, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useConversationStore, useActiveStreaming } from "@/stores/conversationStore";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { sendChat, abortTurn } from "@/lib/tauri";
import type { Message } from "@/types/chat";

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function MessageInput() {
  const { input, setInput, setTextareaRef } = useInputStore();
  // Max height for 15 lines of text (text-sm ~21px line-height + 8px padding)
  const maxHeight = 15 * 21 + 8; // ~323px
  const [scrollState, setScrollState] = useState({ thumbHeight: 0, thumbTop: 0, showScrollbar: false });
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isStreaming = useActiveStreaming();

  // Register textarea ref for external focus
  useEffect(() => {
    setTextareaRef(textareaRef);
  }, [setTextareaRef]);
  const { activeTaskId, createNewTask, updateTask } = useTaskStore();
  const setInputHeight = useUIStore((state) => state.setInputHeight);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update custom scrollbar position
  const updateScrollbar = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollHeight, clientHeight, scrollTop } = container;
    const hasOverflow = scrollHeight > clientHeight;

    if (hasOverflow) {
      const thumbHeight = Math.max(30, (clientHeight / scrollHeight) * clientHeight);
      const scrollableHeight = scrollHeight - clientHeight;
      const thumbRange = clientHeight - thumbHeight;
      const thumbTop = scrollableHeight > 0 ? (scrollTop / scrollableHeight) * thumbRange : 0;

      setScrollState({ thumbHeight, thumbTop, showScrollbar: true });
    } else {
      setScrollState({ thumbHeight: 0, thumbTop: 0, showScrollbar: false });
    }
  }, []);

  // Auto-resize textarea (synchronous to avoid flicker)
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [input]);

  // Update scrollbar after layout (runs after DOM mutation)
  useLayoutEffect(() => {
    updateScrollbar();
  }, [input, updateScrollbar]);

  // Listen to scroll events on container
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", updateScrollbar);
    return () => container.removeEventListener("scroll", updateScrollbar);
  }, [updateScrollbar]);

  // Track container height for dynamic message list padding
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      // Use offsetHeight for full box height including padding
      const height = container.offsetHeight;
      setInputHeight(height + 16); // +16 for bottom-4 offset
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [setInputHeight]);

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming) return;

    const messageContent = input.trim();
    setInput("");

    const convStore = useConversationStore.getState();

    // Create task if none exists
    let taskId = activeTaskId;
    if (!taskId) {
      const title =
        messageContent.length > 50
          ? messageContent.substring(0, 50) + "..."
          : messageContent;
      const task = createNewTask(title);
      taskId = task.id;
    } else {
      // Update task title on first message
      const conv = convStore.conversations.get(taskId);
      if (!conv || conv.messages.length === 0) {
        updateTask(taskId, {
          title:
            messageContent.length > 50
              ? messageContent.substring(0, 50) + "..."
              : messageContent,
        });
      }
    }

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: messageContent,
      timestamp: new Date(),
    };
    convStore.addMessage(taskId, userMessage);

    // Add placeholder assistant message
    const assistantMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    convStore.addMessage(taskId, assistantMessage);

    // Track the assistant message ID for streaming
    convStore.setLastAssistantMessageId(taskId, assistantMessage.id);
    convStore.setStreaming(taskId, true);

    // Send to sam via Tauri IPC
    try {
      await sendChat(taskId, messageContent);
    } catch (error) {
      console.error("Failed to send chat:", error);
      convStore.updateMessage(taskId, assistantMessage.id, {
        content: `Error: Failed to send message. ${error instanceof Error ? error.message : String(error)}`,
      });
      convStore.setStreaming(taskId, false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = async () => {
    if (!activeTaskId) return;

    try {
      await abortTurn(activeTaskId);
    } catch (error) {
      console.error("Failed to abort turn:", error);
    }
  };

  return (
    <div ref={containerRef} className="absolute bottom-4 left-0 right-0 z-10 px-6">
      <div className="max-w-3xl mx-auto rounded-md p-3 shadow-[0_0_10px_rgba(0,0,0,0.15)]">
        {/* Textarea row with custom scrollbar */}
        <div className="relative w-full">
          <div
            ref={scrollContainerRef}
            className="overflow-y-auto hide-native-scrollbar"
            style={{ maxHeight: `${maxHeight}px` }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply..."
              className="w-full bg-transparent border-none outline-none resize-none text-sm min-h-[24px] py-1 pr-3"
              rows={1}
              disabled={isStreaming}
            />
          </div>
          {/* Custom scrollbar */}
          {scrollState.showScrollbar && (
            <div className="absolute right-0 top-0 w-2 h-full p-[1px] pointer-events-none">
              <div
                className="w-full rounded-full bg-neutral-400 hover:bg-neutral-500 transition-colors"
                style={{
                  height: `${scrollState.thumbHeight}px`,
                  transform: `translateY(${scrollState.thumbTop}px)`,
                }}
              />
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "shrink-0 h-8 w-8 transition-colors",
                thinkingEnabled && "bg-primary/15 text-primary hover:bg-primary/25"
              )}
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
              title={thinkingEnabled ? "Disable thinking mode" : "Enable thinking mode"}
            >
              <Brain className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button
                size="icon"
                variant="destructive"
                className="shrink-0 h-8 w-8 rounded-full"
                onClick={handleStop}
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="shrink-0 h-8 w-8 rounded-full"
                onClick={handleSubmit}
                disabled={!input.trim()}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="max-w-3xl mx-auto text-xs text-center text-muted-foreground mt-2">
        AI can make mistakes. Please verify important information.
      </p>
    </div>
  );
}
