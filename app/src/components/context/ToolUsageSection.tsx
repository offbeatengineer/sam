import { useMemo, useState, useRef, useEffect } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToolCard } from "@/components/chat/ToolCard";
import { useSessionStore } from "@/stores/sessionStore";
import type { SessionMessageEntry, AssistantMessage, ToolCall } from "@/types/session";
import type { ToolExecution } from "@/types/chat";

export function ToolUsageSection() {
  const entries = useSessionStore((state) => state.activeEntries);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Extract tool calls from session entries
  const toolExecutions = useMemo(() => {
    const executions: ToolExecution[] = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = (entry as SessionMessageEntry).message;

      if (msg.role === "assistant") {
        const assistant = msg as AssistantMessage;
        for (const block of assistant.content) {
          if (block.type === "toolCall") {
            const tc = block as ToolCall;
            executions.push({
              id: tc.id,
              name: tc.name,
              status: "success",
              expanded: false,
              input: tc.arguments as Record<string, unknown>,
            });
          }
        }
      }
    }
    return executions;
  }, [entries]);

  useEffect(() => {
    if (scrollRef.current && toolExecutions.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolExecutions.length]);

  const handlePrev = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleNext = () => {
    if (selectedIndex !== null && selectedIndex < toolExecutions.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };

  return (
    <Collapsible defaultOpen={true}>
      <CollapsibleTrigger className="text-sm font-medium">
        Tool Usage{toolExecutions.length > 0 && ` (${toolExecutions.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ScrollArea
          className="mt-3 tool-usage-scroll-area"
          viewportRef={scrollRef}
          viewportClassName="!max-h-[168px]"
        >
          <div className="space-y-2 pr-2">
            {toolExecutions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tool executions yet
              </p>
            ) : (
              toolExecutions.map((tool, index) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  isOpen={selectedIndex === index}
                  onOpenChange={(open) => setSelectedIndex(open ? index : null)}
                  onPrev={index > 0 ? handlePrev : undefined}
                  onNext={index < toolExecutions.length - 1 ? handleNext : undefined}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
