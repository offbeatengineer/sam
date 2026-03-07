import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingDisplay } from "./ThinkingDisplay";
import { ToolCard } from "./ToolCard";
import { ArtifactCard } from "./ArtifactCard";
import { WebSearchCard } from "./WebSearchCard";
import { WebFetchCard } from "./WebFetchCard";
import { MemoryCard } from "./MemoryCard";
import { MemoryRecallCard } from "./MemoryRecallCard";
import { SessionSearchCard } from "./SessionSearchCard";
import { SessionReadCard } from "./SessionReadCard";
import { KitCreateCard } from "./KitCreateCard";
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

          // Render WebSearchCard for completed web_search tool calls
          if (item.name === "web_search" && item.status !== "running" && item.details) {
            return <WebSearchCard key={item.id} details={item.details as any} />;
          }

          // Render WebFetchCard for completed web_fetch tool calls
          if (item.name === "web_fetch" && item.status !== "running" && item.details) {
            return <WebFetchCard key={item.id} details={item.details as any} />;
          }

          // Render MemoryCard for completed memory_save/update/forget
          if ((item.name === "memory_save" || item.name === "memory_update" || item.name === "memory_forget") && item.status !== "running" && item.details) {
            return <MemoryCard key={item.id} details={item.details as any} />;
          }

          // Render MemoryRecallCard for completed memory_recall
          if (item.name === "memory_recall" && item.status !== "running" && item.result) {
            const resultObj = { content: [{ type: "text" as const, text: item.result }] };
            return <MemoryRecallCard key={item.id} result={resultObj} args={item.args as Record<string, unknown> ?? {}} />;
          }

          // Render SessionSearchCard for completed session_search
          if (item.name === "session_search" && item.status !== "running" && item.result) {
            const resultObj = { content: [{ type: "text" as const, text: item.result }] };
            return <SessionSearchCard key={item.id} result={resultObj} args={item.args as Record<string, unknown> ?? {}} />;
          }

          // Render SessionReadCard for completed session_read
          if (item.name === "session_read" && item.status !== "running" && item.result) {
            const resultObj = { content: [{ type: "text" as const, text: item.result }] };
            return <SessionReadCard key={item.id} result={resultObj} />;
          }

          // Render KitCreateCard for completed manage_kit create
          if (item.name === "manage_kit" && item.status !== "running" && item.details) {
            return <KitCreateCard key={item.id} details={item.details as any} />;
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

      {/* Bouncing dots indicator while streaming */}
      <div className="flex items-center gap-1 pt-2 px-1">
        <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 bg-primary rounded-full animate-bounce" />
      </div>
    </div>
  );
}
