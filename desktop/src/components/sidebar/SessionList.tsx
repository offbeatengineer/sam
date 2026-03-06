import { useMemo } from "react";
import { ChevronRight, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionItem } from "./SessionItem";
import { useSessionStore, sessionIdFor } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import type { SessionInfo } from "@/types/session";

const CHANNEL_ORDER = ["app", "discord", "pulse"];

const CHANNEL_LABELS: Record<string, string> = {
  app: "App",
  discord: "Discord",
  pulse: "Pulse",
};

const CHANNEL_COLORS: Record<string, string> = {
  app: "bg-green-500",
  discord: "bg-indigo-500",
  pulse: "bg-amber-500",
};

function groupByChannel(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const groups = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const list = groups.get(session.channelId);
    if (list) {
      list.push(session);
    } else {
      groups.set(session.channelId, [session]);
    }
  }
  return groups;
}

export function SessionList() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const selectSession = useSessionStore((state) => state.selectSession);
  const archivedSessions = useSessionStore((state) => state.archivedSessions);
  const archivedLoaded = useSessionStore((state) => state.archivedLoaded);
  const loadArchivedSessions = useSessionStore((state) => state.loadArchivedSessions);
  const expandedChannels = useUIStore((state) => state.expandedChannels);
  const toggleChannel = useUIStore((state) => state.toggleChannel);

  const grouped = useMemo(() => groupByChannel(sessions), [sessions]);

  // Sort channels: known channels first in order, then any unknown ones
  const channels = useMemo(() => {
    const known = CHANNEL_ORDER.filter((c) => grouped.has(c));
    const unknown = [...grouped.keys()].filter((c) => !CHANNEL_ORDER.includes(c)).sort();
    return [...known, ...unknown];
  }, [grouped]);

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No sessions yet. Start a conversation below.
      </div>
    );
  }

  return (
    <div className="pb-2 w-64">
      {channels.map((channelId) => {
        const channelSessions = grouped.get(channelId)!;
        const isExpanded = !!expandedChannels[channelId];
        const label = CHANNEL_LABELS[channelId] ?? channelId;
        const dotColor = CHANNEL_COLORS[channelId] ?? "bg-gray-400";

        return (
          <div key={channelId}>
            <button
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => toggleChannel(channelId)}
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
              <span
                className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)}
              />
              <span>{label}</span>
              <span className="ml-auto text-[10px] opacity-60">
                {channelSessions.length}
              </span>
            </button>
            {isExpanded &&
              channelSessions.map((session) => {
                const id = sessionIdFor(
                  session.channelId,
                  session.conversationId
                );
                return (
                  <SessionItem
                    key={id}
                    session={session}
                    isActive={id === activeSessionId}
                    onClick={() => selectSession(id)}
                  />
                );
              })}
          </div>
        );
      })}

      {/* Archived sessions — lazy loaded */}
      <div>
        <button
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            const wasExpanded = !!expandedChannels.archived;
            toggleChannel("archived");
            if (!wasExpanded && !archivedLoaded) {
              loadArchivedSessions();
            }
          }}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              expandedChannels.archived && "rotate-90"
            )}
          />
          <Archive className="h-3 w-3 opacity-60" />
          <span>Archived</span>
        </button>
        {expandedChannels.archived && (
          archivedSessions.length > 0 ? (
            archivedSessions.map((session) => {
              const id = sessionIdFor(session.channelId, session.conversationId);
              return (
                <SessionItem
                  key={id}
                  session={session}
                  isActive={id === activeSessionId}
                  onClick={() => selectSession(id)}
                />
              );
            })
          ) : (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              {archivedLoaded ? "No archived sessions" : "Loading..."}
            </div>
          )
        )}
      </div>
    </div>
  );
}
