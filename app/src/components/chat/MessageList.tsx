import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionEntryRenderer } from "./SessionEntryRenderer";
import { StreamingTurnView } from "./StreamingTurnView";
import { useSessionStore, useActiveEntries, useActiveStreaming, useStreamingTurn } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";

export function MessageList() {
  const entries = useActiveEntries();
  const isStreaming = useActiveStreaming();
  const streamingTurn = useStreamingTurn();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const inputHeight = useUIStore((state) => state.inputHeight);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive or session changes
  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, [entries, isStreaming, streamingTurn, activeSessionId]);

  if (entries.length === 0 && !isStreaming) {
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
          {entries.map((entry) => (
            <SessionEntryRenderer key={entry.id} entry={entry} />
          ))}

          {isStreaming && streamingTurn && (
            <StreamingTurnView turn={streamingTurn} />
          )}

          {isStreaming && !streamingTurn && (
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
