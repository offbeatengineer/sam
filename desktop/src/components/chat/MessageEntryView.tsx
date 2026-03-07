import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal } from "lucide-react";
import type {
  SessionMessageEntry,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  AssistantMessage,
  UserMessage,
  BashExecutionMessage,
  CustomMessage,
  ImageContent,
  AudioRefContent,
} from "@/types/session";
import { buildUploadUrl } from "@/lib/uploadUrl";
import { AudioPlayer } from "./AudioPlayer";
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

interface MessageEntryViewProps {
  entry: SessionMessageEntry;
  toolResults?: Map<string, ToolResultMessage>;
}

export function MessageEntryView({ entry, toolResults }: MessageEntryViewProps) {
  const { message } = entry;

  switch (message.role) {
    case "user":
      return <UserMessageView message={message} />;
    case "assistant":
      return <AssistantMessageView message={message} toolResults={toolResults} />;
    case "toolResult":
      // Rendered inline with the preceding assistant message's toolCall
      return null;
    case "bashExecution":
      return <BashExecutionView message={message} />;
    case "custom":
      return <CustomMessageView message={message} />;
    case "compactionSummary":
    case "branchSummary":
      return (
        <div className="flex justify-center py-2">
          <div className="flex items-center gap-2">
            <div className="h-px bg-border flex-1 min-w-8" />
            <span className="text-xs text-muted-foreground">
              {message.summary}
            </span>
            <div className="h-px bg-border flex-1 min-w-8" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

function UserMessageView({ message }: { message: UserMessage }) {
  if (typeof message.content === "string") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-primary text-primary-foreground">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const images = message.content.filter((c): c is ImageContent => c.type === "image");
  const audioRefs = message.content.filter((c): c is AudioRefContent => c.type === "audio_ref");
  const text = message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return (
    <div className="flex flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex gap-1.5 flex-wrap justify-end max-w-[80%]">
          {images.map((img, i) => {
            const src = img.url
              ? buildUploadUrl(img.url)
              : img.data
                ? `data:${img.mimeType};base64,${img.data}`
                : undefined;
            return src ? (
              <img
                key={i}
                src={src}
                alt=""
                className="rounded-lg max-w-[220px] max-h-[220px] object-cover"
              />
            ) : null;
          })}
        </div>
      )}
      {audioRefs.map((a, i) => (
        <AudioPlayer key={`audio-${i}`} src={buildUploadUrl(a.url)} />
      ))}
      {text && (
        <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-primary text-primary-foreground">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  toolResults,
}: {
  message: AssistantMessage;
  toolResults?: Map<string, ToolResultMessage>;
}) {
  return (
    <div className="w-full space-y-1">
      {message.content.map((block, i) => {
        if (block.type === "thinking") {
          const tb = block as ThinkingContent;
          return (
            <ThinkingDisplay
              key={`thinking-${i}`}
              thinking={{ content: tb.thinking, isComplete: true }}
            />
          );
        }
        if (block.type === "text") {
          const tb = block as TextContent;
          if (!tb.text) return null;
          return (
            <div
              key={`text-${i}`}
              className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {tb.text}
              </ReactMarkdown>
            </div>
          );
        }
        if (block.type === "toolCall") {
          const tc = block as ToolCall;
          const result = toolResults?.get(tc.id);

          // Render ArtifactCard for report_artifact tool calls
          if (tc.name === "report_artifact" && result && !result.isError) {
            const details = result.details as { path: string; title: string; description?: string; type: string } | undefined;
            if (details) {
              return <ArtifactCard key={`artifact-${tc.id}`} details={details} />;
            }
          }

          // Render WebSearchCard for web_search tool calls
          if (tc.name === "web_search" && result?.details) {
            return <WebSearchCard key={`websearch-${tc.id}`} details={result.details as any} />;
          }

          // Render WebFetchCard for web_fetch tool calls
          if (tc.name === "web_fetch" && result?.details) {
            return <WebFetchCard key={`webfetch-${tc.id}`} details={result.details as any} />;
          }

          // Render MemoryCard for memory_save/update/forget
          if ((tc.name === "memory_save" || tc.name === "memory_update" || tc.name === "memory_forget") && result?.details) {
            return <MemoryCard key={`memory-${tc.id}`} details={result.details as any} />;
          }

          // Render MemoryRecallCard for memory_recall
          if (tc.name === "memory_recall" && result) {
            return <MemoryRecallCard key={`memrecall-${tc.id}`} result={result as any} args={tc.arguments as Record<string, unknown>} />;
          }

          // Render SessionSearchCard for session_search
          if (tc.name === "session_search" && result) {
            return <SessionSearchCard key={`sessearch-${tc.id}`} result={result as any} args={tc.arguments as Record<string, unknown>} />;
          }

          // Render SessionReadCard for session_read
          if (tc.name === "session_read" && result) {
            return <SessionReadCard key={`sesread-${tc.id}`} result={result as any} />;
          }

          // Render KitCreateCard for manage_kit create
          if (tc.name === "manage_kit" && result?.details) {
            return <KitCreateCard key={`kit-${tc.id}`} details={result.details as any} />;
          }

          const resultText = result
            ? result.content
                .filter((c): c is TextContent => c.type === "text")
                .map((c) => c.text)
                .join("\n")
            : undefined;
          const truncatedResult =
            resultText && resultText.length > 1000
              ? resultText.substring(0, 1000) + "..."
              : resultText;
          return (
            <ToolCard
              key={`tool-${tc.id}`}
              tool={{
                id: tc.id,
                name: tc.name,
                status: result?.isError ? "error" : "success",
                expanded: false,
                input: tc.arguments as Record<string, unknown>,
                output: truncatedResult,
              }}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function BashExecutionView({ message }: { message: BashExecutionMessage }) {
  const truncatedOutput =
    message.output.length > 500
      ? message.output.substring(0, 500) + "..."
      : message.output;

  return (
    <div className="w-full border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-b border-border">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <code className="text-xs font-mono truncate flex-1">{message.command}</code>
        {message.exitCode !== undefined && (
          <span
            className={`text-xs font-mono ${message.exitCode === 0 ? "text-green-600" : "text-destructive"}`}
          >
            exit {message.exitCode}
          </span>
        )}
      </div>
      {message.output && (
        <pre className="text-xs font-mono p-3 overflow-x-auto max-h-48 whitespace-pre-wrap text-muted-foreground">
          {truncatedOutput}
        </pre>
      )}
    </div>
  );
}

function CustomMessageView({ message }: { message: CustomMessage }) {
  if (!message.display) return null;

  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("\n");

  return (
    <div className="w-full">
      <div className="prose prose-neutral dark:prose-invert max-w-none text-sm">
        <p className="text-muted-foreground italic">{text}</p>
      </div>
    </div>
  );
}
