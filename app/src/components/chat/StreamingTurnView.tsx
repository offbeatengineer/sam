import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingDisplay } from "./ThinkingDisplay";
import { ToolCard } from "./ToolCard";
import { ArtifactCard } from "./ArtifactCard";
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

      {/* Tool executions — inline with expand/collapse */}
      {turn.toolExecutions.map((tool) => {
        // Render ArtifactCard for completed report_artifact tool calls
        if (
          tool.name === "report_artifact" &&
          tool.status !== "running" &&
          tool.details
        ) {
          const details = tool.details as { path: string; title: string; description?: string; type: string };
          return <ArtifactCard key={tool.id} details={details} />;
        }

        return (
          <ToolCard
            key={tool.id}
            tool={{
              id: tool.id,
              name: tool.name,
              status: tool.status === "running" ? "running" : tool.status === "error" ? "error" : "success",
              expanded: false,
              input: tool.args as Record<string, unknown> | undefined,
              output: tool.result,
            }}
          />
        );
      })}
    </div>
  );
}
