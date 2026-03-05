import { useEffect, useState } from "react";
import { FileText, Image, FileCode, Globe, Database, File, Files } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useArtifactsStore, type ArtifactFileEntry } from "@/stores/artifactsStore";
import { ArtifactPreview, type ArtifactInfo } from "./ArtifactPreview";
import { cn } from "@/lib/utils";

function getFileIcon(entry: ArtifactFileEntry) {
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";

  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) {
    return <Image className="h-4 w-4 text-green-500" />;
  }
  if (["html", "htm"].includes(ext)) {
    return <Globe className="h-4 w-4 text-blue-500" />;
  }
  if (["json", "csv", "yaml", "yml", "toml", "xml"].includes(ext)) {
    return <Database className="h-4 w-4 text-yellow-500" />;
  }
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "scss"].includes(ext)) {
    return <FileCode className="h-4 w-4 text-purple-500" />;
  }
  if (["md", "markdown", "mdx"].includes(ext)) {
    return <FileText className="h-4 w-4 text-orange-500" />;
  }

  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactsPage() {
  const files = useArtifactsStore((s) => s.files);
  const fetchFiles = useArtifactsStore((s) => s.fetchFiles);
  const initHomeDir = useArtifactsStore((s) => s.initHomeDir);
  const homeDir = useArtifactsStore((s) => s.homeDir);
  const isLoading = useArtifactsStore((s) => s.isLoading);

  const [selected, setSelected] = useState<ArtifactInfo | null>(null);

  useEffect(() => {
    initHomeDir();
    fetchFiles();
  }, [initHomeDir, fetchFiles]);

  const displayFiles = files.filter((f) => !f.isDirectory);

  const handleClick = (entry: ArtifactFileEntry) => {
    const fullPath = homeDir
      ? `${homeDir}/.sam/artifacts/${entry.path}`
      : `~/.sam/artifacts/${entry.path}`;

    setSelected({
      id: entry.path,
      name: entry.name,
      type: "file",
      path: fullPath,
    });
  };

  return (
    <div className="flex flex-1 min-w-0">
      {/* Left column — file list */}
      <div className="w-72 shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border">
        <div data-tauri-drag-region className="flex items-center justify-center h-12 px-3 border-b border-border">
          <h2 className="text-sm font-medium">Artifacts</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {isLoading && displayFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
            ) : displayFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No artifacts yet. Files in ~/.sam/artifacts/ will appear here.
              </p>
            ) : (
              <div className="space-y-0.5">
                {displayFiles.map((entry) => {
                  const isActive = selected?.id === entry.path;
                  return (
                    <button
                      key={entry.path}
                      onClick={() => handleClick(entry)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      )}
                    >
                      {getFileIcon(entry)}
                      <span className="truncate flex-1">{entry.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatSize(entry.size)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right column — preview */}
      <div className="flex-1 flex flex-col min-w-0 bg-sidebar">
        {selected ? (
          <ArtifactPreview
            artifact={selected}
            onClose={() => setSelected(null)}
          />
        ) : (
          <>
            <div data-tauri-drag-region className="h-12 border-b border-border shrink-0" />
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Files className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Select a file to preview</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
