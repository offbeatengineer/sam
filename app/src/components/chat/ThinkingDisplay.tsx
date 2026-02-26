import { useState } from "react";
import { Brain, ChevronRight, ChevronDown } from "lucide-react";
import type { ThinkingData } from "@/types/chat";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ThinkingDisplayProps {
  thinking: ThinkingData;
}

/**
 * Get summary text from thinking content (first line, truncated to ~50 chars)
 */
function getSummary(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim()) || "";
  if (firstLine.length <= 50) return firstLine;
  return firstLine.substring(0, 47) + "...";
}

export function ThinkingDisplay({ thinking }: ThinkingDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFullContent, setShowFullContent] = useState(false);

  const summary = getSummary(thinking.content);
  const lines = thinking.content.split("\n");
  const isLongContent = lines.length > 6;
  const truncatedContent = isLongContent && !showFullContent
    ? lines.slice(0, 6).join("\n")
    : thinking.content;

  // Collapsed: minimal single line with brain icon
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground transition-colors my-1"
      >
        <Brain className={cn("w-4 h-4 flex-shrink-0", !thinking.isComplete && "animate-pulse")} />
        <span className="text-left italic">{summary || "Thinking..."}</span>
        <ChevronRight className="w-3 h-3 flex-shrink-0" />
      </button>
    );
  }

  // Expanded: full content
  return (
    <div className="my-2">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(false)}
        className="flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground transition-colors"
      >
        <Brain className={cn("w-4 h-4 flex-shrink-0", !thinking.isComplete && "animate-pulse")} />
        <span className="text-left italic">{summary || "Thinking..."}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {/* Content */}
      <div className="pl-6 mt-2 border-l-2 border-border">
        <ScrollArea viewportClassName={cn("pr-2", showFullContent ? "max-h-96" : "max-h-32")}>
          <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans">
            {truncatedContent}
          </pre>
        </ScrollArea>

        {/* Show more link */}
        {isLongContent && !showFullContent && (
          <button
            onClick={() => setShowFullContent(true)}
            className="text-xs text-muted-foreground hover:text-foreground mt-1"
          >
            Show more
          </button>
        )}
      </div>
    </div>
  );
}
