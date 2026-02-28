import { MoreHorizontal, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "@/types/session";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSessionStore } from "@/stores/sessionStore";

interface SessionItemProps {
  session: SessionInfo;
  isActive: boolean;
  onClick: () => void;
}

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getSessionTitle(session: SessionInfo): string {
  if (session.name) return session.name;
  if (session.firstMessage) {
    return session.firstMessage.length > 60
      ? session.firstMessage.substring(0, 57) + "..."
      : session.firstMessage;
  }
  return "New session";
}

export function SessionItem({ session, isActive, onClick }: SessionItemProps) {
  const isStreaming = useSessionStore(
    (state) => state.streamingSessionId === `${session.channelId}:${session.conversationId}`
  );
  const isAppSession = session.channelId === "app";
  const title = getSessionTitle(session);

  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors overflow-hidden",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="truncate flex-1 min-w-0">{title}</span>

        {/* Streaming indicator */}
        {isStreaming && !isActive && (
          <span
            className="shrink-0 h-2 w-2 rounded-full bg-blue-500 animate-pulse"
            title="AI is working"
          />
        )}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground shrink-0 opacity-60 group-hover:opacity-100">
          {getRelativeTime(session.modified)}
        </span>

        {isAppSession && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
