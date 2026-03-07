import { useEffect, useRef, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionEntryRenderer } from "./SessionEntryRenderer";
import { StreamingTurnView } from "./StreamingTurnView";
import { useActiveEntries, useActiveStreaming, useStreamingTurn, usePendingUserMessage, usePendingUserImages, usePendingUserAudio } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { Mic } from "lucide-react";
import type { SessionMessageEntry, ToolResultMessage } from "@/types/session";

export function MessageList({ isReadOnly }: { isReadOnly?: boolean }) {
  const entries = useActiveEntries();
  const isStreaming = useActiveStreaming();
  const streamingTurn = useStreamingTurn();
  const pendingUserMessage = usePendingUserMessage();
  const pendingUserImages = usePendingUserImages();
  const pendingUserAudio = usePendingUserAudio();
  const inputHeight = useUIStore((state) => state.inputHeight);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a map from toolCallId → ToolResultMessage for inline rendering
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const entry of entries) {
      if (entry.type === "message") {
        const msg = (entry as SessionMessageEntry).message;
        if (msg.role === "toolResult") {
          map.set(msg.toolCallId, msg as ToolResultMessage);
        }
      }
    }
    return map;
  }, [entries]);

  // Instant-jump on initial load, smooth-scroll for subsequent updates.
  // MessageList remounts on session switch (keyed by activeSessionId),
  // so initialLoadRef resets naturally.
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (initialLoadRef.current) {
      if (entries.length === 0) return;
      initialLoadRef.current = false;
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    } else {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [entries, isStreaming, streamingTurn, pendingUserMessage]);

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
    <div className="flex-1 overflow-hidden" style={{ paddingBottom: isReadOnly ? undefined : `${inputHeight}px` }}>
      <ScrollArea className="h-full chat-scroll-area" viewportRef={scrollRef}>
        <div className="p-6 space-y-4">
          {entries.map((entry) => (
            <SessionEntryRenderer key={entry.id} entry={entry} toolResults={toolResultsMap} />
          ))}

          {pendingUserMessage !== null && (
            <div className="flex flex-col items-end gap-1.5">
              {pendingUserImages.length > 0 && (
                <div className="flex gap-1.5 flex-wrap justify-end max-w-[80%] opacity-70">
                  {pendingUserImages.map((img) => (
                    <img
                      key={img.id}
                      src={img.dataUrl}
                      alt=""
                      className="h-[60px] w-[60px] rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}
              {pendingUserAudio && (
                <div className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1.5 text-xs opacity-70">
                  <Mic className="h-3 w-3" />
                  <span>{formatDuration(pendingUserAudio.duration)}</span>
                </div>
              )}
              {pendingUserMessage && (
                <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-primary text-primary-foreground">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{pendingUserMessage}</p>
                </div>
              )}
            </div>
          )}

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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
