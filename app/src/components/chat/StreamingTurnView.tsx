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
      {turn.items.map((item, i) => {
        if (item.kind === "thinking") {
          return (
            <ThinkingDisplay
              key={`st-thinking-${i}`}
              thinking={{ content: item.content, isComplete: item.isComplete }}
            />
          );
        }

        if (item.kind === "text" && item.content) {
          return (
            <div
              key={`st-text-${i}`}
              className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {item.content}
              </ReactMarkdown>
            </div>
          );
        }

        if (item.kind === "tool") {
          // Render ArtifactCard for completed report_artifact tool calls
          if (
            item.name === "report_artifact" &&
            item.status !== "running" &&
            item.details
          ) {
            const details = item.details as { path: string; title: string; description?: string; type: string };
            return <ArtifactCard key={item.id} details={details} />;
          }

          return (
            <ToolCard
              key={item.id}
              tool={{
                id: item.id,
                name: item.name,
                status: item.status === "running" ? "running" : item.status === "error" ? "error" : "success",
                expanded: false,
                input: item.args as Record<string, unknown> | undefined,
                output: item.result,
              }}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
