import { useUIStore } from "@/stores/uiStore";
import { ArtifactPreview } from "./ArtifactPreview";
import { cn } from "@/lib/utils";

export function ArtifactPanel() {
  const { selectedArtifact, setSelectedArtifact } = useUIStore();
  const isOpen = selectedArtifact !== null;

  return (
    <div
      className={cn(
        "bg-sidebar border-l border-sidebar-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        isOpen ? "flex-1 min-w-0" : "w-0 border-l-0"
      )}
    >
      {isOpen && selectedArtifact && selectedArtifact.path && (
        <ArtifactPreview
          artifact={selectedArtifact as { id: string; name: string; type: string; path: string }}
          onClose={() => setSelectedArtifact(null)}
        />
      )}
    </div>
  );
}
