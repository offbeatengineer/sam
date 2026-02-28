import { useState } from "react";
import {
  FileText,
  Terminal,
  ChevronRight,
  AlertTriangle,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolExecution } from "@/types/chat";

interface ToolCardProps {
  tool: ToolExecution;
}

const toolIcons: Record<string, React.ElementType> = {
  read: FileText,
  write: FileText,
  edit: FileText,
  bash: Terminal,
  default: Terminal,
};

function getToolIcon(name: string) {
  return toolIcons[name] ?? toolIcons.default;
}

const statusIcon = {
  pending: <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  success: <Check className="h-3.5 w-3.5 text-green-600" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  error: <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
};

function formatToolHeader(tool: ToolExecution): { label: string; detail?: string } {
  const args = tool.input;
  switch (tool.name) {
    case "bash": {
      const cmd = args?.command as string | undefined;
      return { label: "$", detail: cmd ? (cmd.length > 120 ? cmd.substring(0, 117) + "..." : cmd) : "..." };
    }
    case "read": {
      const path = (args?.file_path ?? args?.path) as string | undefined;
      return { label: "read", detail: path ? shortenPath(path) : undefined };
    }
    case "write": {
      const path = (args?.file_path ?? args?.path) as string | undefined;
      return { label: "write", detail: path ? shortenPath(path) : undefined };
    }
    case "edit": {
      const path = (args?.file_path ?? args?.path) as string | undefined;
      return { label: "edit", detail: path ? shortenPath(path) : undefined };
    }
    default:
      return { label: tool.name };
  }
}

function shortenPath(p: string): string {
  const homeDir = "/Users/";
  const idx = p.indexOf(homeDir);
  if (idx === 0) {
    const rest = p.substring(homeDir.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx !== -1) return "~" + rest.substring(slashIdx);
  }
  return p;
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getToolIcon(tool.name);
  const hasContent = !!(tool.input || tool.output);
  const { label, detail } = formatToolHeader(tool);
  const isError = tool.status === "error";

  return (
    <div
      className={cn(
        "w-full rounded-md text-xs font-mono overflow-hidden",
        isError ? "bg-destructive/5" : "bg-muted/30"
      )}
    >
      {/* Header — always visible */}
      <button
        className={cn(
          "flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left",
          hasContent && "cursor-pointer hover:bg-muted/50"
        )}
        onClick={() => hasContent && setExpanded(!expanded)}
        disabled={!hasContent}
      >
        {hasContent && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
        )}
        {!hasContent && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="font-semibold text-foreground">{label}</span>
        {detail && (
          <span className="text-muted-foreground truncate flex-1 min-w-0">
            {detail}
          </span>
        )}
        <span className="shrink-0 ml-auto">{statusIcon[tool.status]}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5">
          {tool.input && tool.name !== "bash" && (
            <pre className="text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {tool.output && (
            <pre
              className={cn(
                "whitespace-pre-wrap break-words max-h-64 overflow-y-auto leading-relaxed",
                isError ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {tool.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
