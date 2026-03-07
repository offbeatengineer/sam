import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";

interface MemoryRecallItem {
  id: string;
  text: string;
  tags?: string[];
  source?: string;
  score?: number;
}

interface MemoryRecallCardProps {
  result: { content: { type: string; text: string }[] };
  args: Record<string, unknown>;
}

function parseResults(result: MemoryRecallCardProps["result"]): MemoryRecallItem[] {
  try {
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const parsed = JSON.parse(text);
    return (parsed.results ?? []) as MemoryRecallItem[];
  } catch {
    return [];
  }
}

export function MemoryRecallCard({ result, args }: MemoryRecallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const query = (args.query as string) ?? "";
  const results = parseResults(result);

  return (
    <div className="w-full rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted/80 transition-colors text-left"
      >
        <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{query}</span>
        <span className="text-[10px] text-muted-foreground/50">
          {results.length} {results.length === 1 ? "memory" : "memories"}
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
                <code className="text-[10px] text-muted-foreground/70 font-mono">
                  {item.id.substring(0, 8)}
                </code>
                {item.score != null && (
                  <span className="text-[10px] text-muted-foreground/50">
                    {(item.score * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">
                {item.text}
              </p>
              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
