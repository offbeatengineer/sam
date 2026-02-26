import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 300;

export function ChatHeader() {
  // Use selector to get active task directly to avoid creating new objects on each render
  const activeTask = useTaskStore((state) => {
    const activeTaskId = state.activeTaskId;
    if (!activeTaskId) return undefined;
    return state.tasks.find((t) => t.id === activeTaskId);
  });
  const {
    leftSidebarOpen,
    rightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useUIStore();

  const [isMacOS, setIsMacOS] = useState(false);

  // Delayed state for showing toggles after animation completes
  const [showLeftToggle, setShowLeftToggle] = useState(!leftSidebarOpen);
  const [showRightToggle, setShowRightToggle] = useState(!rightSidebarOpen);

  useEffect(() => {
    setIsMacOS(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  useEffect(() => {
    if (leftSidebarOpen) {
      // Hide immediately when opening
      setShowLeftToggle(false);
    } else {
      // Show after animation completes when closing
      const timer = setTimeout(() => setShowLeftToggle(true), ANIMATION_DURATION);
      return () => clearTimeout(timer);
    }
  }, [leftSidebarOpen]);

  useEffect(() => {
    if (rightSidebarOpen) {
      setShowRightToggle(false);
    } else {
      const timer = setTimeout(() => setShowRightToggle(true), ANIMATION_DURATION);
      return () => clearTimeout(timer);
    }
  }, [rightSidebarOpen]);

  // Add left padding for macOS traffic lights when left sidebar is collapsed
  const needsTrafficLightSpace = isMacOS && !leftSidebarOpen;

  if (!activeTask) {
    return (
      <div
        data-tauri-drag-region
        className={cn(
          "flex items-center justify-between h-12 px-3 border-b border-border",
          needsTrafficLightSpace && "pl-[72px]"
        )}
      >
        <div className="flex items-center gap-2">
          {showLeftToggle && (
            <SidebarToggle
              side="left"
              isOpen={leftSidebarOpen}
              onClick={toggleLeftSidebar}
            />
          )}
          <h1 className="text-sm font-medium text-muted-foreground">
            Start a new task
          </h1>
        </div>
        {showRightToggle && (
          <SidebarToggle
            side="right"
            isOpen={rightSidebarOpen}
            onClick={toggleRightSidebar}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "flex items-center justify-between h-12 px-3 border-b border-border",
        needsTrafficLightSpace && "pl-[72px]"
      )}
    >
      <div className="flex items-center gap-2">
        {showLeftToggle && (
          <SidebarToggle
            side="left"
            isOpen={leftSidebarOpen}
            onClick={toggleLeftSidebar}
          />
        )}
        <h1 className="text-sm font-medium flex items-center gap-1 cursor-pointer hover:text-muted-foreground transition-colors">
          {activeTask.title}
          <ChevronDown className="h-4 w-4" />
        </h1>
      </div>
      {showRightToggle && (
        <SidebarToggle
          side="right"
          isOpen={rightSidebarOpen}
          onClick={toggleRightSidebar}
        />
      )}
    </div>
  );
}
