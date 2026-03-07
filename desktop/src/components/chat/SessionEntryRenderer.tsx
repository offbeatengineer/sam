import type { SessionEntry, ToolResultMessage } from "@/types/session";
import { MessageEntryView } from "./MessageEntryView";
import { AudioPlayer } from "./AudioPlayer";
import { buildUploadUrl } from "@/lib/uploadUrl";

interface SessionEntryRendererProps {
  entry: SessionEntry;
  toolResults?: Map<string, ToolResultMessage>;
}

export function SessionEntryRenderer({ entry, toolResults }: SessionEntryRendererProps) {
  switch (entry.type) {
    case "message":
      return <MessageEntryView entry={entry} toolResults={toolResults} />;

    case "model_change":
      return (
        <div className="flex justify-center py-1">
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            Model: {entry.modelId}
          </span>
        </div>
      );

    case "thinking_level_change":
      return (
        <div className="flex justify-center py-1">
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            Thinking: {entry.thinkingLevel}
          </span>
        </div>
      );

    case "compaction":
      return (
        <div className="flex justify-center py-2">
          <div className="flex items-center gap-2">
            <div className="h-px bg-border flex-1 min-w-8" />
            <span className="text-xs text-muted-foreground">Context compacted</span>
            <div className="h-px bg-border flex-1 min-w-8" />
          </div>
        </div>
      );

    case "branch_summary":
      return (
        <div className="flex justify-center py-2">
          <div className="flex items-center gap-2">
            <div className="h-px bg-border flex-1 min-w-8" />
            <span className="text-xs text-muted-foreground max-w-md truncate">
              Branch: {entry.summary}
            </span>
            <div className="h-px bg-border flex-1 min-w-8" />
          </div>
        </div>
      );

    case "custom_message":
      if (!entry.display) return null;
      return (
        <div className="w-full">
          <div className="prose prose-neutral dark:prose-invert max-w-none text-sm">
            <p className="text-muted-foreground italic">
              {typeof entry.content === "string"
                ? entry.content
                : entry.content
                    .filter((c): c is { type: "text"; text: string } => c.type === "text")
                    .map((c) => c.text)
                    .join("\n")}
            </p>
          </div>
        </div>
      );

    case "custom": {
      if (entry.customType === "audio_attachment" && entry.data) {
        const data = entry.data as { url?: string };
        if (data.url) {
          return (
            <div className="flex justify-end">
              <AudioPlayer src={buildUploadUrl(data.url)} />
            </div>
          );
        }
      }
      return null;
    }

    // Internal metadata entries — don't render
    case "label":
    case "session_info":
      return null;

    default:
      return null;
  }
}
