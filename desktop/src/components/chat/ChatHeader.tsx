import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 300;

function getSessionTitle(session: { name?: string; firstMessage: string } | undefined): string {
  if (!session) return "Start a new session";
  if (session.name) return session.name;
  if (session.firstMessage) {
    return session.firstMessage.length > 60
      ? session.firstMessage.substring(0, 57) + "..."
      : session.firstMessage;
  }
  return "New session";
}

const CHANNEL_BADGES: Record<string, { label: string; className: string }> = {
  discord: { label: "Discord", className: "bg-indigo-500/15 text-indigo-400" },
  pulse: { label: "Pulse", className: "bg-amber-500/15 text-amber-400" },
};

export function ChatHeader() {
  const activeSession = useSessionStore((state) => state.getActiveSession());
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const {
    leftSidebarOpen,
    rightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useUIStore();

  const [isMacOS, setIsMacOS] = useState(false);
  const [showLeftToggle, setShowLeftToggle] = useState(!leftSidebarOpen);
  const [showRightToggle, setShowRightToggle] = useState(!rightSidebarOpen);

  useEffect(() => {
    setIsMacOS(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  useEffect(() => {
    if (leftSidebarOpen) {
      setShowLeftToggle(false);
    } else {
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

  const needsTrafficLightSpace = isMacOS && !leftSidebarOpen;
  const title = getSessionTitle(activeSession);
  const channelBadge = activeSession && CHANNEL_BADGES[activeSession.channelId];
  const isReadOnly = activeSession && activeSession.channelId !== "app";

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
        <h1 className="text-sm font-medium flex items-center gap-1.5 cursor-pointer hover:text-muted-foreground transition-colors">
          {title}
          {activeSessionId && <ChevronDown className="h-4 w-4" />}
        </h1>
        {channelBadge && (
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", channelBadge.className)}>
            {channelBadge.label}
          </span>
        )}
        {isReadOnly && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
            Read-only
          </span>
        )}
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
