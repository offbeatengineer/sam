import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolExecution } from "@/types/chat";

const PREVIEW_LINES = 2;

interface ToolCardProps {
  tool: ToolExecution;
}

function shortenPath(p: string): string {
  const homeDir = "/Users/";
  if (p.startsWith(homeDir)) {
    const rest = p.substring(homeDir.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx !== -1) return "~" + rest.substring(slashIdx);
  }
  return p;
}

function buildContent(tool: ToolExecution): string {
  const parts: string[] = [];
  const args = tool.input;

  switch (tool.name) {
    case "bash": {
      const cmd = args?.command as string | undefined;
      if (cmd) parts.push(`$ ${cmd}`);
      break;
    }
    case "read": {
      const path = (args?.file_path ?? args?.path) as string | undefined;
      if (path) parts.push(`read ${shortenPath(path)}`);
      break;
    }
    case "write": {
      const path = (args?.file_path ?? args?.path) as string | undefined;
      if (path) parts.push(`write ${shortenPath(path)}`);
      const content = args?.content as string | undefined;
      if (content) {
        parts.push("");
        parts.push(content);
      }
      break;
    }
    case "edit": {
      const path = (args?.file_path ?? args?.path) as string | undefined;
      if (path) parts.push(`edit ${shortenPath(path)}`);
      break;
    }
    case "manage_kit": {
      const action = (args?.action as string) ?? "manage";
      const kitId = (args?.kitId as string) ?? "";
      parts.push(`kit ${action} ${kitId}`);
      break;
    }
    default: {
      parts.push(tool.name);
      if (args && Object.keys(args).length > 0) {
        parts.push(JSON.stringify(args, null, 2));
      }
    }
  }

  if (tool.output) {
    if (parts.length > 0) parts.push("");
    parts.push(tool.output);
  }

  return parts.join("\n");
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = tool.status === "error";
  const isRunning = tool.status === "running" || tool.status === "pending";

  const fullContent = buildContent(tool);
  const lines = fullContent.split("\n");
  const isLong = lines.length > PREVIEW_LINES;
  const displayContent =
    expanded || !isLong
      ? fullContent
      : lines.slice(0, PREVIEW_LINES).join("\n");
  const remainingLines = lines.length - PREVIEW_LINES;

  return (
    <div
      className={cn(
        "w-full rounded-md text-xs font-mono overflow-hidden cursor-pointer",
        isError
          ? "bg-red-950/15"
          : isRunning
            ? "bg-muted/10"
            : "bg-emerald-950/10"
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <pre
        className={cn(
          "px-3 pt-2 whitespace-pre-wrap break-words leading-relaxed overflow-hidden",
          !expanded ? "pb-0 line-clamp-2" : "pb-2",
          isRunning && "animate-pulse",
          isError ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {/* Bold first line */}
        <span className="font-semibold text-foreground">
          {lines[0]}
        </span>
        {displayContent.includes("\n") && (
          <>
            {"\n"}
            {displayContent.substring(displayContent.indexOf("\n") + 1)}
          </>
        )}
      </pre>
      {isLong && !expanded && (
        <div className="px-3 pb-2 text-xs text-muted-foreground/60">
          ... ({remainingLines} more lines)
        </div>
      )}
    </div>
  );
}
