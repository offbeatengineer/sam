import { useMemo } from "react";
import { FileText, Image, FileCode } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import type { SessionEntry, SessionMessageEntry, ToolResultMessage } from "@/types/session";

interface Artifact {
  id: string;
  name: string;
  type: "file" | "image" | "chart" | "other";
  path?: string;
}

const FILE_CREATING_TOOLS = ["Write", "Edit", "NotebookEdit"];

function getArtifactType(filePath: string): Artifact["type"] {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext || "")) {
    return "image";
  }
  return "file";
}

function getFileIcon(type: Artifact["type"], path: string) {
  if (type === "image") {
    return <Image className="h-4 w-4 text-muted-foreground" />;
  }
  const ext = path.split(".").pop()?.toLowerCase();
  const codeExtensions = [
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
    "css", "scss", "html", "json", "yaml", "yml", "toml", "xml"
  ];
  if (codeExtensions.includes(ext || "")) {
    return <FileCode className="h-4 w-4 text-muted-foreground" />;
  }
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}

function extractArtifactsFromEntries(entries: SessionEntry[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as SessionMessageEntry).message;

    // Check toolResult entries for file-creating tools
    if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      if (!tr.isError && FILE_CREATING_TOOLS.includes(tr.toolName)) {
        const details = tr.details as Record<string, unknown> | undefined;
        const filePath = (details?.file_path ?? details?.notebook_path) as string | undefined;
        if (filePath && !seen.has(filePath)) {
          seen.add(filePath);
          artifacts.push({
            id: tr.toolCallId,
            name: filePath.split("/").pop() || filePath,
            path: filePath,
            type: getArtifactType(filePath),
          });
        }
      }
    }

    // Check assistant messages for tool calls with file paths
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolCall" && FILE_CREATING_TOOLS.includes(block.name)) {
          const filePath = (block.arguments?.file_path ?? block.arguments?.notebook_path) as string | undefined;
          if (filePath && !seen.has(filePath)) {
            seen.add(filePath);
            artifacts.push({
              id: block.id,
              name: filePath.split("/").pop() || filePath,
              path: filePath,
              type: getArtifactType(filePath),
            });
          }
        }
      }
    }
  }
  return artifacts;
}

export function ArtifactsSection() {
  const entries = useSessionStore((state) => state.activeEntries);
  const setSelectedArtifact = useUIStore((state) => state.setSelectedArtifact);

  const artifacts = useMemo(() => extractArtifactsFromEntries(entries), [entries]);

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="text-sm font-medium">
        Artifacts {artifacts.length > 0 && `(${artifacts.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3">
          {artifacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Files created during the conversation will appear here.
            </p>
          ) : (
            <div className="space-y-1">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => setSelectedArtifact(artifact)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-accent transition-colors"
                >
                  {getFileIcon(artifact.type, artifact.path || "")}
                  <span className="truncate flex-1">{artifact.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
