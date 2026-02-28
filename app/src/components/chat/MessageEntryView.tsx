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
} from "@/types/session";
import { ThinkingDisplay } from "./ThinkingDisplay";
import { ToolCard } from "./ToolCard";

interface MessageEntryViewProps {
  entry: SessionMessageEntry;
}

export function MessageEntryView({ entry }: MessageEntryViewProps) {
  const { message } = entry;

  switch (message.role) {
    case "user":
      return <UserMessageView message={message} />;
    case "assistant":
      return <AssistantMessageView message={message} />;
    case "toolResult":
      return <ToolResultView message={message} />;
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
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("\n");

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-primary text-primary-foreground">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

function AssistantMessageView({ message }: { message: AssistantMessage }) {
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
          return (
            <ToolCard
              key={`tool-${tc.id}`}
              tool={{
                id: tc.id,
                name: tc.name,
                status: "success",
                expanded: false,
                input: tc.arguments as Record<string, unknown>,
              }}
            />
          );
        }
        return null;
      })}

      {/* Model & usage info */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] text-muted-foreground/60">
          {message.model}
          {message.usage && ` · ${message.usage.totalTokens.toLocaleString()} tokens`}
          {message.usage?.cost?.total != null && ` · $${message.usage.cost.total.toFixed(4)}`}
        </span>
      </div>
    </div>
  );
}

function ToolResultView({ message }: { message: ToolResultMessage }) {
  const text = message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const truncatedText = text.length > 500 ? text.substring(0, 500) + "..." : text;

  return (
    <ToolCard
      tool={{
        id: message.toolCallId,
        name: message.toolName,
        status: message.isError ? "error" : "success",
        expanded: false,
        output: truncatedText,
      }}
    />
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
