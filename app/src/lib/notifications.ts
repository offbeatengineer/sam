import { useSessionStore, sessionIdFor } from "@/stores/sessionStore";

/**
 * Request browser notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * Show a notification when a session has new messages in the background
 */
export function showTaskNotification(conversationId: string): void {
  if (document.hasFocus()) return;
  if (Notification.permission !== "granted") return;

  const session = useSessionStore.getState().sessions.find(
    (s) => s.conversationId === conversationId
  );
  const title = session?.name || session?.firstMessage || "Session";
  const displayTitle = title.length > 50 ? title.substring(0, 47) + "..." : title;

  const notification = new Notification("AI Response Ready", {
    body: `"${displayTitle}" has new messages`,
    tag: `session-${conversationId}`,
    icon: "/favicon.ico",
  });

  notification.onclick = () => {
    window.focus();
    if (session) {
      useSessionStore.getState().selectSession(
        sessionIdFor(session.channelId, session.conversationId)
      );
    }
    notification.close();
  };

  setTimeout(() => notification.close(), 5000);
}
