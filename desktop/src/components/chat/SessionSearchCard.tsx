import { useState } from "react";
import { MessageSquare, ChevronRight } from "lucide-react";

interface SessionSearchItem {
  text: string;
  role: string;
  score: number;
  session_name?: string;
  sessionName?: string;
  conversation_id?: string;
  conversationId?: string;
  channel_id?: string;
  channelId?: string;
  timestamp: number;
}

interface SessionSearchCardProps {
  result: { content: { type: string; text: string }[] };
  args: Record<string, unknown>;
}

function parseResults(result: SessionSearchCardProps["result"]): SessionSearchItem[] {
  try {
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const parsed = JSON.parse(text);
    return (parsed.results ?? []) as SessionSearchItem[];
  } catch {
    return [];
  }
}

function relativeTime(ts: number): string {
  // Timestamp is in ms since epoch
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function SessionSearchCard({ result, args }: SessionSearchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const query = (args.query as string) ?? "";
  const results = parseResults(result);

  return (
    <div className="w-full rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted/80 transition-colors text-left"
      >
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{query}</span>
        <span className="text-[10px] text-muted-foreground/50">
          {results.length} {results.length === 1 ? "result" : "results"}
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground/50 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && results.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {results.map((item, i) => (
            <div key={i} className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted">
                  {item.role}
                </span>
                <span className="text-xs text-muted-foreground/70 truncate flex-1">
                  {item.session_name ?? item.sessionName}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {relativeTime(item.timestamp)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
