import { FileText, Image, FileCode, Globe, Database, File } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useArtifactsStore } from "@/stores/artifactsStore";
import { useEffect } from "react";

interface ArtifactDetails {
  path: string;
  title: string;
  description?: string;
  type: string;
}

interface ArtifactCardProps {
  details: ArtifactDetails;
}

function getTypeIcon(type: string) {
  switch (type) {
    case "html":
      return <Globe className="h-4 w-4 text-blue-500" />;
    case "image":
      return <Image className="h-4 w-4 text-green-500" />;
    case "markdown":
      return <FileText className="h-4 w-4 text-orange-500" />;
    case "code":
      return <FileCode className="h-4 w-4 text-purple-500" />;
    case "data":
      return <Database className="h-4 w-4 text-yellow-500" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground" />;
  }
}

export function ArtifactCard({ details }: ArtifactCardProps) {
  const setSelectedArtifact = useUIStore((s) => s.setSelectedArtifact);
  const homeDir = useArtifactsStore((s) => s.homeDir);
  const initHomeDir = useArtifactsStore((s) => s.initHomeDir);

  useEffect(() => {
    initHomeDir();
  }, [initHomeDir]);

  const handleClick = () => {
    const fullPath = homeDir
      ? `${homeDir}/.sam/artifacts/${details.path}`
      : `~/.sam/artifacts/${details.path}`;

    setSelectedArtifact({
      id: details.path,
      name: details.title,
      type: details.type,
      path: fullPath,
    });
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-left"
    >
      {getTypeIcon(details.type)}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{details.title}</p>
        {details.description && (
          <p className="text-xs text-muted-foreground truncate">{details.description}</p>
        )}
        <p className="text-xs text-muted-foreground/70 truncate">
          artifacts/{details.path}
        </p>
      </div>
    </button>
  );
}
