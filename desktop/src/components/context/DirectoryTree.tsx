import { useState, useEffect, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder, File } from "lucide-react";
import { readDir, watch } from "@tauri-apps/plugin-fs";
import { useInputStore } from "@/stores/inputStore";

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface TreeNodeProps {
  name: string;
  path: string;
  isDirectory: boolean;
  rootPath: string;
  depth: number;
  refreshKey: number;
}

function TreeNode({ name, path, isDirectory, rootPath, depth, refreshKey }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const appendToInput = useInputStore((state) => state.appendToInput);
  const focusInput = useInputStore((state) => state.focusInput);

  const loadChildren = useCallback(async () => {
    if (!isDirectory) return;

    setIsLoading(true);
    try {
      const entries = await readDir(path);
      const sortedEntries = entries
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
        }))
        .filter((entry) => !entry.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      setChildren(sortedEntries);
    } catch (error) {
      console.error("Failed to read directory:", error);
    } finally {
      setIsLoading(false);
    }
  }, [path, isDirectory]);

  // Reload children when refreshKey changes (if expanded)
  useEffect(() => {
    if (isExpanded && isDirectory) {
      loadChildren();
    }
  }, [refreshKey, isExpanded, isDirectory, loadChildren]);

  const handleToggle = async () => {
    if (!isDirectory) return;

    if (!isExpanded) {
      await loadChildren();
    }
    setIsExpanded(!isExpanded);
  };

  const handleClick = () => {
    if (isDirectory) {
      handleToggle();
    } else {
      // Get relative path from root
      const relativePath = path.replace(rootPath + "/", "");
      appendToInput(`@${relativePath}`);
      focusInput();
    }
  };

  const paddingLeft = depth * 16;

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 px-1 hover:bg-accent rounded cursor-pointer text-sm"
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={handleClick}
      >
        {isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        ) : (
          <>
            <span className="w-3" />
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{name}</span>
        {isLoading && (
          <span className="text-xs text-muted-foreground">...</span>
        )}
      </div>
      {isDirectory && isExpanded && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.name}
              name={child.name}
              path={`${path}/${child.name}`}
              isDirectory={child.isDirectory}
              rootPath={rootPath}
              depth={depth + 1}
              refreshKey={refreshKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DirectoryTreeProps {
  rootPath: string;
}

export function DirectoryTree({ rootPath }: DirectoryTreeProps) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRoot = useCallback(async () => {
    try {
      const dirEntries = await readDir(rootPath);
      const sortedEntries = dirEntries
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
        }))
        .filter((entry) => !entry.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      setEntries(sortedEntries);
      setError(null);
    } catch (err) {
      console.error("Failed to read root directory:", err);
      setError("Failed to load directory");
    }
  }, [rootPath]);

  // Load root directory on mount and when rootPath or refreshKey changes
  useEffect(() => {
    loadRoot();
  }, [rootPath, refreshKey, loadRoot]);

  // Set up file watcher
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const setupWatcher = async () => {
      try {
        const unwatch = await watch(
          rootPath,
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
  }, [rootPath]);

  if (error) {
    return (
      <div className="text-xs text-muted-foreground py-2">{error}</div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">Empty directory</div>
    );
  }

  return (
    <div className="text-sm">
      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          name={entry.name}
          path={`${rootPath}/${entry.name}`}
          isDirectory={entry.isDirectory}
          rootPath={rootPath}
          depth={0}
          refreshKey={refreshKey}
        />
      ))}
    </div>
  );
}
