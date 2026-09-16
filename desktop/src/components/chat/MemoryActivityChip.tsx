import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoryActivity } from "@/types/chat";

interface MemoryActivityChipProps {
  activity: MemoryActivity;
}

interface Row {
  label: string;
  text: string;
  detail?: string;
}

/** What automatic memory did around a turn: recalled before it, saved or changed after it. */
function describe(activity: MemoryActivity): { summary: string; rows: Row[] } {
  if (activity.phase === "recall") {
    const memories = activity.memories ?? [];
    return {
      summary: `Recalled ${memories.length} ${memories.length === 1 ? "memory" : "memories"}`,
      rows: memories.map((m) => ({ label: `${Math.round(m.p * 100)}%`, text: m.text })),
    };
  }

  const saved = activity.saved ?? [];
  const superseded = activity.superseded ?? [];
  const duplicates = activity.duplicates ?? [];
  const forgotten = activity.forgotten ?? [];
  const flagged = activity.flagged ?? [];

  const parts = [
    saved.length > 0 && `saved ${saved.length}`,
    superseded.length > 0 && `updated ${superseded.length}`,
    forgotten.length > 0 && `forgot ${forgotten.length}`,
    duplicates.length > 0 && `${duplicates.length} already known`,
    flagged.length > 0 && `${flagged.length} to review`,
    activity.unresolvedForget && "nothing matched to forget",
  ].filter(Boolean);

  return {
    summary: `Memory: ${parts.join(", ")}`,
    rows: [
      ...saved.map((m) => ({ label: m.kind === "profile" ? "Saved · always" : "Saved", text: m.text })),
      ...superseded.map((m) => ({ label: "Updated", text: m.text, detail: `was: ${m.replaced.text}` })),
      ...forgotten.map((m) => ({ label: "Forgot", text: m.text })),
      ...duplicates.map((m) => ({ label: "Known", text: m.text })),
      ...flagged.map((m) => ({ label: "Review", text: m.text, detail: "may be outdated, left unchanged" })),
    ],
  };
}

export function MemoryActivityChip({ activity }: MemoryActivityChipProps) {
  const [expanded, setExpanded] = useState(false);
  const { summary, rows } = describe(activity);

  return (
    <div className="w-full">
      <button
        type="button"
        disabled={rows.length === 0}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:hover:text-muted-foreground"
      >
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span>{summary}</span>
        {rows.length > 0 && (
          <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-lg border border-border bg-card divide-y divide-border">
          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 mt-0.5">
                {row.label}
              </span>
              <div className="min-w-0">
                <p className="text-xs">{row.text}</p>
                {row.detail && <p className="text-[11px] text-muted-foreground line-through decoration-muted-foreground/40">{row.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
