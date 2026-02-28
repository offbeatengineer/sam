import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Check, AlertTriangle, Terminal } from "lucide-react";
import { ThinkingDisplay } from "./ThinkingDisplay";
import type { StreamingTurn } from "@/stores/sessionStore";

interface StreamingTurnViewProps {
  turn: StreamingTurn;
}

export function StreamingTurnView({ turn }: StreamingTurnViewProps) {
  return (
    <div className="w-full space-y-1">
      {/* Content blocks (thinking + text) */}
      {turn.contentBlocks.map((block, i) => {
        if (block.type === "thinking") {
          return (
            <ThinkingDisplay
              key={`st-thinking-${i}`}
              thinking={{ content: block.content, isComplete: block.isComplete }}
            />
          );
        }
        if (block.type === "text" && block.content) {
          return (
            <div
              key={`st-text-${i}`}
              className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {block.content}
              </ReactMarkdown>
            </div>
          );
        }
        return null;
      })}

      {/* Tool executions */}
      {turn.toolExecutions.map((tool) => (
        <div
          key={tool.id}
          className="w-full border border-border rounded-lg bg-card overflow-hidden flex items-center gap-3 px-4 py-2"
        >
          <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="flex-1 min-w-0 text-sm truncate">{tool.name}</span>
          {tool.status === "running" && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          {tool.status === "success" && (
            <Check className="h-4 w-4 text-green-600" />
          )}
          {tool.status === "error" && (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          )}
        </div>
      ))}
    </div>
  );
}
