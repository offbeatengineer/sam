import { Brain } from "lucide-react";

interface MemoryCardDetails {
  action: string;
  id: string;
  text?: string;
  tags?: string[];
}

interface MemoryCardProps {
  details: MemoryCardDetails;
}

const actionLabels: Record<string, string> = {
  saved: "Memory saved",
  updated: "Memory updated",
  forgotten: "Memory forgotten",
};

export function MemoryCard({ details }: MemoryCardProps) {
  const label = actionLabels[details.action] ?? `Memory ${details.action}`;

  return (
    <div className="w-full rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Brain className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium">{label}</span>
            <code className="text-[10px] text-muted-foreground/70 font-mono truncate">
              {details.id.substring(0, 8)}
            </code>
          </div>
          {details.text && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {details.text}
            </p>
          )}
          {details.tags && details.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {details.tags.map((tag) => (
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
      </div>
    </div>
  );
}
