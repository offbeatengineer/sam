import { useState } from "react";
import { MessageSquare, ChevronRight } from "lucide-react";

interface SessionReadMessage {
  role: string;
  text: string;
  timestamp: number;
}

interface SessionReadCardProps {
  result: { content: { type: string; text: string }[] };
}

function parseResult(result: SessionReadCardProps["result"]): {
  sessionName: string;
  messages: SessionReadMessage[];
  totalMessages: number;
} | null {
  try {
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const parsed = JSON.parse(text);
    return {
      sessionName: parsed.session_name ?? parsed.sessionName ?? "",
      messages: parsed.messages ?? [],
      totalMessages: parsed.total_messages ?? parsed.totalMessages ?? parsed.messages?.length ?? 0,
    };
  } catch {
    return null;
  }
}

export function SessionReadCard({ result }: SessionReadCardProps) {
  const [expanded, setExpanded] = useState(false);
  const data = parseResult(result);
  if (!data) return null;

  return (
    <div className="w-full rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted/80 transition-colors text-left"
      >
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate flex-1">
          {data.sessionName || "Session"}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {data.messages.length} of {data.totalMessages} messages
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground/50 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && data.messages.length > 0 && (
        <div className="divide-y divide-border border-t border-border max-h-64 overflow-y-auto">
          {data.messages.map((msg, i) => (
            <div key={i} className="px-3 py-2">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted mr-1.5">
                {msg.role}
              </span>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {msg.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
