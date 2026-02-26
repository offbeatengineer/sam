import { useTaskStore } from "@/stores/taskStore";

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
 * Show a notification when a task completes in the background
 */
export function showTaskNotification(taskId: string): void {
  // Only show if window is not focused
  if (document.hasFocus()) return;

  // Only show if we have permission
  if (Notification.permission !== "granted") return;

  const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
  if (!task) return;

  const notification = new Notification("AI Response Ready", {
    body: `Task "${task.title}" has new messages`,
    tag: `task-${taskId}`, // Prevents duplicate notifications for same task
    icon: "/favicon.ico",
  });

  notification.onclick = () => {
    // Focus the window and switch to the task
    window.focus();
    useTaskStore.getState().switchTask(taskId);
    notification.close();
  };

  // Auto-close after 5 seconds
  setTimeout(() => notification.close(), 5000);
}
