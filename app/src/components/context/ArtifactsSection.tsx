import { useEffect } from "react";
import { FileText, Image, FileCode, Globe, Database, File } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useArtifactsStore, type ArtifactFileEntry } from "@/stores/artifactsStore";
import { useUIStore } from "@/stores/uiStore";

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

export function ArtifactsSection() {
  const files = useArtifactsStore((s) => s.files);
  const fetchFiles = useArtifactsStore((s) => s.fetchFiles);
  const initHomeDir = useArtifactsStore((s) => s.initHomeDir);
  const homeDir = useArtifactsStore((s) => s.homeDir);
  const setSelectedArtifact = useUIStore((s) => s.setSelectedArtifact);

  useEffect(() => {
    initHomeDir();
    fetchFiles();
  }, [initHomeDir, fetchFiles]);

  const displayFiles = files.filter((f) => !f.isDirectory);

  const handleClick = (entry: ArtifactFileEntry) => {
    const fullPath = homeDir
      ? `${homeDir}/.sam/artifacts/${entry.path}`
      : `~/.sam/artifacts/${entry.path}`;

    setSelectedArtifact({
      id: entry.path,
      name: entry.name,
      type: "file",
      path: fullPath,
    });
  };

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="text-sm font-medium">
        Artifacts {displayFiles.length > 0 && `(${displayFiles.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3">
          {displayFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Files in ~/.sam/artifacts/ will appear here.
            </p>
          ) : (
            <div className="space-y-1">
              {displayFiles.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleClick(entry)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-accent transition-colors"
                >
                  {getFileIcon(entry)}
                  <span className="truncate flex-1">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
