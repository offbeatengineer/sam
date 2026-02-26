import { useEffect, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Message } from "./Message";
import { useConversationStore, useActiveMessages, useActiveStreaming } from "@/stores/conversationStore";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";

export function MessageList() {
  const messages = useActiveMessages();
  const isStreaming = useActiveStreaming();
  const activeTaskId = useTaskStore((state) => state.activeTaskId);
  const inputHeight = useUIStore((state) => state.inputHeight);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive, questions appear, or task changes
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM has rendered
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, [messages, isStreaming, activeTaskId]);

  // Mark as read when scrolled to bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !activeTaskId) return;

    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (isAtBottom) {
      useConversationStore.getState().markAsRead(activeTaskId);
    }
  }, [activeTaskId]);

  // Set up scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Mark as read when switching to a task with no unread (already at bottom)
  useEffect(() => {
    if (activeTaskId) {
      // Small delay to ensure scroll position is calculated
      requestAnimationFrame(() => {
        handleScroll();
      });
    }
  }, [activeTaskId, handleScroll]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground">
            Describe your task below to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden" style={{ paddingBottom: `${inputHeight}px` }}>
      <ScrollArea className="h-full chat-scroll-area" viewportRef={scrollRef}>
        <div className="p-6 space-y-4">
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}

          {isStreaming && (
            <div className="px-2 py-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                  </div>
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
