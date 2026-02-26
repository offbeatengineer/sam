import { FileText, Image, FileCode } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useConversationStore } from "@/stores/conversationStore";
import { useUIStore } from "@/stores/uiStore";
import type { Artifact } from "@/types/task";

// Stable empty array to prevent infinite re-renders
const EMPTY_ARTIFACTS: Artifact[] = [];

function getFileIcon(type: Artifact["type"], path: string) {
  if (type === "image") {
    return <Image className="h-4 w-4 text-muted-foreground" />;
  }

  // Check if it's a code file
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

export function ArtifactsSection() {
  // Use unified artifacts from the store (already merged and deduplicated)
  const artifacts = useConversationStore((state) => {
    const taskId = state.activeTaskId;
    if (!taskId) return EMPTY_ARTIFACTS;
    return state.conversations.get(taskId)?.artifacts ?? EMPTY_ARTIFACTS;
  });

  const setSelectedArtifact = useUIStore((state) => state.setSelectedArtifact);

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
