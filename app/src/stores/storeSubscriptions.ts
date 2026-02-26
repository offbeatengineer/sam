/**
 * Cross-store subscriptions setup
 *
 * This file sets up subscriptions between stores to decouple them.
 * Instead of stores directly calling each other's methods, they react
 * to state changes via subscriptions.
 */

import { useTaskStore } from "./taskStore";
import { useConversationStore } from "./conversationStore";

let subscriptionsInitialized = false;

/**
 * Initialize cross-store subscriptions.
 * Called once during app startup.
 */
export function initializeStoreSubscriptions(): void {
  if (subscriptionsInitialized) return;
  subscriptionsInitialized = true;

  // Track known task IDs to detect deletions
  let knownTaskIds = new Set<string>();

  // When activeTaskId changes, load the conversation for that task
  useTaskStore.subscribe(
    (state) => ({ activeTaskId: state.activeTaskId, tasks: state.tasks, isLoaded: state.isLoaded }),
    async ({ activeTaskId, tasks, isLoaded }, prev) => {
      // Skip if stores not loaded yet
      if (!isLoaded) return;

      const convStore = useConversationStore.getState();
      const currentTaskIds = new Set(tasks.map((t) => t.id));

      // Detect deleted tasks and clean up their conversations
      for (const taskId of knownTaskIds) {
        if (!currentTaskIds.has(taskId)) {
          convStore.removeConversation(taskId);
        }
      }

      knownTaskIds = currentTaskIds;

      // Skip further processing if activeTaskId didn't change
      if (activeTaskId === prev.activeTaskId) return;

      // Save previous conversation before switching (if not streaming)
      if (prev.activeTaskId) {
        const prevConv = convStore.conversations.get(prev.activeTaskId);
        if (prevConv && !prevConv.isStreaming) {
          await convStore.saveTaskConversation(prev.activeTaskId);
        }
      }

      // Update active task in conversation store
      convStore.setActiveTask(activeTaskId);

      if (activeTaskId) {
        const task = tasks.find((t) => t.id === activeTaskId);
        if (task) {
          // Load conversation if not already loaded
          const existingConv = convStore.conversations.get(activeTaskId);
          if (!existingConv || existingConv.messages.length === 0) {
            await convStore.loadTaskConversation(activeTaskId);
          }
          // Mark as read when switching to a task
          convStore.markAsRead(activeTaskId);
        }
      }
    },
    { equalityFn: (a, b) => a.activeTaskId === b.activeTaskId && a.tasks === b.tasks && a.isLoaded === b.isLoaded }
  );
}
