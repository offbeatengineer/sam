import { Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { SessionList } from "@/components/sidebar/SessionList";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

export function LeftSidebar() {
  const createNewSession = useSessionStore((state) => state.createNewSession);
  const { leftSidebarOpen, toggleLeftSidebar, selectedArtifact } = useUIStore();
  const artifactPanelOpen = selectedArtifact !== null;

  const handleNewSession = () => {
    createNewSession();
  };

  const isCollapsed = artifactPanelOpen || !leftSidebarOpen;

  return (
    <div
      className={cn(
        "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        isCollapsed ? "w-0 border-r-0" : "w-64"
      )}
    >
      {/* Header with toggle */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-end h-12 px-3 w-64 border-b border-border"
      >
        <SidebarToggle
          side="left"
          isOpen={leftSidebarOpen}
          onClick={toggleLeftSidebar}
        />
      </div>

      {/* New session button */}
      <div className="w-64">
        <button
          className="flex items-center gap-2 px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent/50 text-sidebar-foreground w-[calc(100%-16px)] h-[41px]"
          onClick={handleNewSession}
        >
          <Plus className="h-4 w-4" />
          New session
        </button>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1 w-64">
        <SessionList />
      </ScrollArea>
    </div>
  );
}
