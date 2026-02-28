import { SessionItem } from "./SessionItem";
import { useSessionStore, sessionIdFor } from "@/stores/sessionStore";

export function SessionList() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const selectSession = useSessionStore((state) => state.selectSession);

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No sessions yet. Start a conversation below.
      </div>
    );
  }

  return (
    <div className="pb-2 w-64">
      {sessions.map((session) => {
        const id = sessionIdFor(session.channelId, session.conversationId);
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
}
