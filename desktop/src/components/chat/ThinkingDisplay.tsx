import { cn } from "@/lib/utils";
import type { ThinkingData } from "@/types/chat";

interface ThinkingDisplayProps {
  thinking: ThinkingData;
}

export function ThinkingDisplay({ thinking }: ThinkingDisplayProps) {
  return (
    <div className={cn("text-sm text-muted-foreground whitespace-pre-wrap italic my-2", !thinking.isComplete && "animate-pulse")}>
      {thinking.content || "Thinking..."}
    </div>
  );
}
