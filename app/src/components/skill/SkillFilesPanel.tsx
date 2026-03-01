import { useState, useEffect, useCallback } from "react";
import { Folder, File, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { readDir, watch } from "@tauri-apps/plugin-fs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface TreeNodeProps {
  name: string;
  path: string;
  isDirectory: boolean;
  refreshKey: number;
  onFileClick?: (filePath: string) => void;
  activeFilePath?: string | null;
}

function TreeNode({ name, path, isDirectory, refreshKey, onFileClick, activeFilePath }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);

  const loadChildren = useCallback(async () => {
    if (!isDirectory) return;
    try {
      const entries = await readDir(path);
      setChildren(
        entries
          .map((e) => ({ name: e.name, isDirectory: e.isDirectory }))
          .filter((e) => !e.name.startsWith("."))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
      );
    } catch (err) {
      console.error("Failed to read directory:", err);
    }
  }, [path, isDirectory]);

  useEffect(() => {
    if (isExpanded && isDirectory) {
      loadChildren();
    }
  }, [refreshKey, isExpanded, isDirectory, loadChildren]);

  const isMdFile = !isDirectory && name.endsWith(".md");
  const isActive = activeFilePath === path;

  const handleClick = async () => {
    if (isDirectory) {
      if (!isExpanded) await loadChildren();
      setIsExpanded(!isExpanded);
    } else if (isMdFile && onFileClick) {
      onFileClick(path);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-0.5 pl-3 text-sm rounded",
          (isDirectory || isMdFile) ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
          isActive && "bg-accent text-accent-foreground"
        )}
        onClick={handleClick}
      >
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{name}</span>
      </div>
      {isDirectory && isExpanded && children.length > 0 && (
        <div className="ml-[19px] border-l border-border">
          {children.map((child) => (
            <TreeNode
              key={child.name}
              name={child.name}
              path={`${path}/${child.name}`}
              isDirectory={child.isDirectory}
              refreshKey={refreshKey}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SkillFilesPanelProps {
  skillPath: string;
  skillName: string;
  onFileClick?: (filePath: string) => void;
  activeFilePath?: string | null;
}

export function SkillFilesPanel({ skillPath, skillName, onFileClick, activeFilePath }: SkillFilesPanelProps) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRoot = useCallback(async () => {
    try {
      const dirEntries = await readDir(skillPath);
      const sortedEntries = dirEntries
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
        }))
        .filter((entry) => !entry.name.startsWith("."))
        .sort((a, b) => {
          // Put SKILL.md first
          if (a.name === "SKILL.md") return -1;
          if (b.name === "SKILL.md") return 1;
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      setEntries(sortedEntries);
      setError(null);
    } catch (err) {
      console.error("Failed to read skill directory:", err);
      setError("Failed to load directory");
    }
  }, [skillPath]);

  useEffect(() => {
    loadRoot();
  }, [skillPath, refreshKey, loadRoot]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const setupWatcher = async () => {
      try {
        const unwatch = await watch(
          skillPath,
          () => {
            setRefreshKey((k) => k + 1);
          },
          { recursive: true, delayMs: 500 }
        );
        cleanup = unwatch;
      } catch (err) {
        console.error("Failed to set up file watcher:", err);
      }
    };

    setupWatcher();

    return () => {
      cleanup?.();
    };
  }, [skillPath]);

  return (
    <div className="h-full flex flex-col bg-sidebar border-l border-border">
      {/* Header */}
      <div data-tauri-drag-region className="h-12 px-4 flex items-center border-b border-border">
        <h3 className="text-sm font-medium truncate">{skillName}</h3>
      </div>

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {error ? (
            <div className="text-xs text-muted-foreground">{error}</div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5 py-0.5 text-sm">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{skillName}</span>
              </div>
              <div className="ml-[7px] border-l border-border">
                {entries.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-1 pl-4">Empty</div>
                ) : (
                  entries.map((entry) => (
                    <TreeNode
                      key={entry.name}
                      name={entry.name}
                      path={`${skillPath}/${entry.name}`}
                      isDirectory={entry.isDirectory}
                      refreshKey={refreshKey}
                      onFileClick={onFileClick}
                      activeFilePath={activeFilePath}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
