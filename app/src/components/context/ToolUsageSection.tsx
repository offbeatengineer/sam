import { useMemo, useState, useRef, useEffect } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToolCard } from "@/components/chat/ToolCard";
import { useActiveConversation } from "@/stores/conversationStore";
import type { ToolExecution } from "@/types/chat";

export function ToolUsageSection() {
  const conversation = useActiveConversation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Flatten all tool executions from all messages
  const toolExecutions = useMemo(() => {
    if (!conversation?.messages) return [];

    const executions: ToolExecution[] = [];
    for (const message of conversation.messages) {
      if (message.toolExecutions) {
        executions.push(...message.toolExecutions);
      }
    }
    return executions;
  }, [conversation?.messages]);

  // Auto-scroll to bottom when new tools are added
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
