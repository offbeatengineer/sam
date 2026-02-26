import { Folder } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { ToolUsageSection } from "@/components/context/ToolUsageSection";
import { ArtifactsSection } from "@/components/context/ArtifactsSection";
import { ContextSection } from "@/components/context/ContextSection";
import { useUIStore } from "@/stores/uiStore";
import { useTaskStore } from "@/stores/taskStore";
import { cn } from "@/lib/utils";

function getBasename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function RightSidebar() {
  const { rightSidebarOpen, toggleRightSidebar, selectedArtifact } = useUIStore();
  const activeTask = useTaskStore((state) => {
    const activeTaskId = state.activeTaskId;
    if (!activeTaskId) return undefined;
    return state.tasks.find((t) => t.id === activeTaskId);
  });

  const workingDirectory = activeTask?.workingDirectory;
  const artifactPanelOpen = selectedArtifact !== null;

  // Sidebar collapses when artifact panel is open OR when manually closed
  const isCollapsed = artifactPanelOpen || !rightSidebarOpen;

  return (
    <div
      className={cn(
        "bg-sidebar border-l border-sidebar-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        isCollapsed ? "w-0 border-l-0" : "w-72"
      )}
    >
      {/* Header with toggle and working directory */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-12 px-3 min-w-72 border-b border-border"
      >
        {workingDirectory ? (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground max-w-[200px] truncate"
            title={workingDirectory}
          >
            <Folder className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{getBasename(workingDirectory)}</span>
          </span>
        ) : (
          <span />
        )}
        <SidebarToggle
          side="right"
          isOpen={rightSidebarOpen}
          onClick={toggleRightSidebar}
        />
      </div>

      <ScrollArea className="flex-1 min-w-72">
        <div className="px-4 pb-4 space-y-4 w-72">
          <ArtifactsSection />
          <ContextSection />
          <ToolUsageSection />
        </div>
      </ScrollArea>
    </div>
  );
}
