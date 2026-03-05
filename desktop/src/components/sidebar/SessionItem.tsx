import { useRef, useState } from "react";
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
  const renameSession = useSessionStore((state) => state.renameSession);
  const isAppSession = session.channelId === "app";
  const title = getSessionTitle(session);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setEditName(session.name || title);
    setIsEditing(true);
    // Focus after React renders the input
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    const trimmed = editName.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== session.name) {
      renameSession(session.path, trimmed);
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors overflow-hidden",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground"
      )}
      onClick={isEditing ? undefined : onClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent border border-border rounded px-1 py-0.5 text-sm outline-none focus:border-ring"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelEditing();
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 min-w-0">{title}</span>
        )}

        {/* Streaming indicator */}
        {isStreaming && !isActive && (
          <span
            className="shrink-0 h-2 w-2 rounded-full bg-blue-500 animate-pulse"
            title="AI is working"
          />
        )}
      </div>

      {!isEditing && isAppSession && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={startEditing}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
