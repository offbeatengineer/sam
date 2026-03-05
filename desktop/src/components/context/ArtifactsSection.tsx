import { useMemo, useEffect } from "react";
import { FileText, Image, FileCode, Globe, Database, File } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useArtifactsStore } from "@/stores/artifactsStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveEntries } from "@/stores/sessionStore";
import type {
  SessionMessageEntry,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
} from "@/types/session";

interface SessionArtifactInfo {
  id: string;
  title: string;
  path: string;
  type: string;
  description?: string;
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

export function ArtifactsSection() {
  const entries = useActiveEntries();
  const homeDir = useArtifactsStore((s) => s.homeDir);
  const initHomeDir = useArtifactsStore((s) => s.initHomeDir);
  const setSelectedArtifact = useUIStore((s) => s.setSelectedArtifact);

  useEffect(() => {
    initHomeDir();
  }, [initHomeDir]);

  const artifacts = useMemo(() => {
    // Build toolResults map
    const toolResultsMap = new Map<string, ToolResultMessage>();
    for (const entry of entries) {
      if (entry.type === "message") {
        const msg = (entry as SessionMessageEntry).message;
        if (msg.role === "toolResult") {
          toolResultsMap.set(msg.toolCallId, msg as ToolResultMessage);
        }
      }
    }

    // Extract report_artifact tool calls, dedup by path (keep last)
    const seenPaths = new Map<string, number>();
    const result: SessionArtifactInfo[] = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = (entry as SessionMessageEntry).message;
      if (msg.role !== "assistant") continue;

      for (const block of (msg as AssistantMessage).content) {
        if (block.type !== "toolCall") continue;
        const tc = block as ToolCall;
        if (tc.name !== "report_artifact") continue;

        const toolResult = toolResultsMap.get(tc.id);
        if (!toolResult || toolResult.isError) continue;

        const details = toolResult.details as {
          path: string;
          title: string;
          description?: string;
          type: string;
        } | undefined;
        if (!details?.path) continue;

        const info: SessionArtifactInfo = {
          id: tc.id,
          title: details.title,
          path: details.path,
          type: details.type,
          description: details.description,
        };

        const existing = seenPaths.get(details.path);
        if (existing !== undefined) {
          result[existing] = info;
        } else {
          seenPaths.set(details.path, result.length);
          result.push(info);
        }
      }
    }

    return result;
  }, [entries]);

  const handleClick = (artifact: SessionArtifactInfo) => {
    const fullPath = homeDir
      ? `${homeDir}/.sam/artifacts/${artifact.path}`
      : `~/.sam/artifacts/${artifact.path}`;

    setSelectedArtifact({
      id: artifact.path,
      name: artifact.title,
      type: artifact.type,
      path: fullPath,
    });
  };

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="text-sm font-medium">
        Artifacts {artifacts.length > 0 && `(${artifacts.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3">
          {artifacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Artifacts from this session will appear here.
            </p>
          ) : (
            <div className="space-y-1">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => handleClick(artifact)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-accent transition-colors"
                >
                  {getTypeIcon(artifact.type)}
                  <span className="truncate flex-1">{artifact.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
