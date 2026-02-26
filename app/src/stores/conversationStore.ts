import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Message, ToolExecution, ThinkingBlock } from "@/types/chat";
import type { Artifact } from "@/types/task";
import { saveConversation, loadConversation } from "@/lib/storage";

// Stable empty array reference to avoid re-renders
const EMPTY_MESSAGES: Message[] = [];

/**
 * Represents a conversation for a single task.
 * Each task has its own independent conversation state.
 */
export interface TaskConversation {
  taskId: string;
  messages: Message[];
  isStreaming: boolean;
  hasUnread: boolean;
  lastAssistantMessageId: string | null;
  /** Unified artifacts: both extracted from messages and reported via MCP */
  artifacts: Artifact[];
}

function createEmptyConversation(taskId: string): TaskConversation {
  return {
    taskId,
    messages: [],
    isStreaming: false,
    hasUnread: false,
    lastAssistantMessageId: null,
    artifacts: [],
  };
}

interface ConversationState {
  // All conversations, keyed by taskId
  conversations: Map<string, TaskConversation>;

  // The currently viewed task
  activeTaskId: string | null;

  // Get or create a conversation for a task
  getConversation: (taskId: string) => TaskConversation;

  // Message operations
  addMessage: (taskId: string, message: Message) => void;
  updateMessage: (taskId: string, messageId: string, updates: Partial<Message>) => void;
  appendToMessage: (taskId: string, messageId: string, content: string) => void;
  setMessages: (taskId: string, messages: Message[]) => void;

  // Streaming state
  setStreaming: (taskId: string, streaming: boolean) => void;
  setLastAssistantMessageId: (taskId: string, messageId: string | null) => void;

  // Tool executions
  addToolExecution: (taskId: string, messageId: string, tool: ToolExecution) => void;
  updateToolExecution: (taskId: string, messageId: string, toolId: string, updates: Partial<ToolExecution>) => void;

  // Unread tracking
  markAsRead: (taskId: string) => void;
  markAsUnread: (taskId: string) => void;

  // Artifacts (unified: extracted from messages + reported via MCP)
  addArtifact: (taskId: string, artifact: Omit<Artifact, 'id'>) => void;
  addArtifacts: (taskId: string, artifacts: Artifact[]) => void;
  setArtifacts: (taskId: string, artifacts: Artifact[]) => void;

  // Content blocks (for interleaved thinking/text)
  appendToBlock: (taskId: string, messageId: string, blockIndex: number, content: string, blockType: "text" | "thinking") => void;
  completeBlock: (taskId: string, messageId: string, blockIndex: number) => void;
  appendToLastTextBlock: (taskId: string, messageId: string, content: string) => void;
  appendToLastThinkingBlock: (taskId: string, messageId: string, content: string) => void;
  completeLastThinkingBlock: (taskId: string, messageId: string) => void;

  // Task switching
  setActiveTask: (taskId: string | null) => void;

  // Persistence
  loadTaskConversation: (taskId: string) => Promise<void>;
  saveTaskConversation: (taskId: string) => Promise<void>;

  // Cleanup
  removeConversation: (taskId: string) => void;
}

export const useConversationStore = create<ConversationState>()(
  subscribeWithSelector((set, get) => ({
  conversations: new Map(),
  activeTaskId: null,

  getConversation: (taskId: string) => {
    const { conversations } = get();
    let conv = conversations.get(taskId);
    if (!conv) {
      conv = createEmptyConversation(taskId);
      set((state) => {
        const newConversations = new Map(state.conversations);
        newConversations.set(taskId, conv!);
        return { conversations: newConversations };
      });
    }
    return conv;
  },

  addMessage: (taskId, message) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const existingConv = conversations.get(taskId);
      const conv = existingConv || createEmptyConversation(taskId);
      conversations.set(taskId, {
        ...conv,
        messages: [...conv.messages, message],
      });
      return { conversations };
    }),

  updateMessage: (taskId, messageId, updates) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        ),
      });
      return { conversations };
    }),

  appendToMessage: (taskId, messageId, content) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) =>
          msg.id === messageId ? { ...msg, content: msg.content + content } : msg
        ),
      });
      return { conversations };
    }),

  setMessages: (taskId, messages) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const existingConv = conversations.get(taskId);
      const conv = existingConv || createEmptyConversation(taskId);
      conversations.set(taskId, { ...conv, messages });
      return { conversations };
    }),

  setStreaming: (taskId, streaming) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;
      conversations.set(taskId, { ...conv, isStreaming: streaming });
      return { conversations };
    }),

  setLastAssistantMessageId: (taskId, messageId) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;
      conversations.set(taskId, { ...conv, lastAssistantMessageId: messageId });
      return { conversations };
    }),

  addToolExecution: (taskId, messageId, tool) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) =>
          msg.id === messageId
            ? { ...msg, toolExecutions: [...(msg.toolExecutions || []), tool] }
            : msg
        ),
      });
      return { conversations };
    }),

  updateToolExecution: (taskId, messageId, toolId, updates) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                toolExecutions: msg.toolExecutions?.map((tool) =>
                  tool.id === toolId ? { ...tool, ...updates } : tool
                ),
              }
            : msg
        ),
      });
      return { conversations };
    }),

  markAsRead: (taskId) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;
      conversations.set(taskId, { ...conv, hasUnread: false });
      return { conversations };
    }),

  markAsUnread: (taskId) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;
      conversations.set(taskId, { ...conv, hasUnread: true });
      return { conversations };
    }),

  addArtifact: (taskId, artifact) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const existingConv = conversations.get(taskId);
      const conv = existingConv || createEmptyConversation(taskId);

      // Don't add duplicates (same path)
      if (conv.artifacts.some((a) => a.path === artifact.path)) {
        return state;
      }

      const newArtifact: Artifact = {
        ...artifact,
        id: `artifact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      };

      conversations.set(taskId, {
        ...conv,
        artifacts: [...conv.artifacts, newArtifact],
      });
      return { conversations };
    }),

  addArtifacts: (taskId, newArtifacts) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const existingConv = conversations.get(taskId);
      const conv = existingConv || createEmptyConversation(taskId);

      // Merge: deduplicate by path
      const existingPaths = new Set(conv.artifacts.map((a) => a.path));
      const toAdd = newArtifacts.filter((a) => a.path && !existingPaths.has(a.path));

      if (toAdd.length === 0) {
        return state;
      }

      conversations.set(taskId, {
        ...conv,
        artifacts: [...conv.artifacts, ...toAdd],
      });
      return { conversations };
    }),

  setArtifacts: (taskId, artifacts) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const existingConv = conversations.get(taskId);
      const conv = existingConv || createEmptyConversation(taskId);
      conversations.set(taskId, { ...conv, artifacts });
      return { conversations };
    }),

  appendToBlock: (taskId, messageId, blockIndex, content, blockType) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          const blocks = [...(msg.contentBlocks || [])];

          // Ensure array is large enough
          while (blocks.length <= blockIndex) {
            blocks.push({ type: "text", content: "" });
          }

          const existing = blocks[blockIndex];

          if (blockType === "thinking") {
            if (existing.type === "thinking") {
              blocks[blockIndex] = { ...existing, content: existing.content + content };
            } else {
              blocks[blockIndex] = { type: "thinking", content, isComplete: false };
            }
          } else {
            if (existing.type === "text") {
              blocks[blockIndex] = { ...existing, content: existing.content + content };
            } else {
              blocks[blockIndex] = { type: "text", content };
            }
          }

          return { ...msg, contentBlocks: blocks };
        }),
      });
      return { conversations };
    }),

  completeBlock: (taskId, messageId, blockIndex) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          const blocks = [...(msg.contentBlocks || [])];
          if (blockIndex < blocks.length && blocks[blockIndex].type === "thinking") {
            blocks[blockIndex] = { ...blocks[blockIndex], isComplete: true };
          }

          return { ...msg, contentBlocks: blocks };
        }),
      });
      return { conversations };
    }),

  appendToLastTextBlock: (taskId, messageId, content) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          const blocks = [...(msg.contentBlocks || [])];

          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock && lastBlock.type === "text") {
            blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + content };
          } else {
            blocks.push({ type: "text", content });
          }

          return { ...msg, contentBlocks: blocks };
        }),
      });
      return { conversations };
    }),

  appendToLastThinkingBlock: (taskId, messageId, content) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          const blocks = [...(msg.contentBlocks || [])];

          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock && lastBlock.type === "thinking") {
            blocks[blocks.length - 1] = {
              ...lastBlock,
              content: lastBlock.content + content,
              isComplete: false
            };
          } else {
            blocks.push({ type: "thinking", content, isComplete: false });
          }

          return { ...msg, contentBlocks: blocks };
        }),
      });
      return { conversations };
    }),

  completeLastThinkingBlock: (taskId, messageId) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(taskId);
      if (!conv) return state;

      conversations.set(taskId, {
        ...conv,
        messages: conv.messages.map((msg) => {
          if (msg.id !== messageId) return msg;

          const blocks = [...(msg.contentBlocks || [])];

          // Find last INCOMPLETE thinking block and mark it complete
          for (let i = blocks.length - 1; i >= 0; i--) {
            const block = blocks[i];
            if (block.type === "thinking" && !block.isComplete) {
              blocks[i] = { ...block, isComplete: true } as ThinkingBlock;
              break;
            }
          }

          return { ...msg, contentBlocks: blocks };
        }),
      });
      return { conversations };
    }),

  setActiveTask: (taskId) => set({ activeTaskId: taskId }),

  loadTaskConversation: async (taskId) => {
    const { getConversation } = get();
    const conv = getConversation(taskId);

    const { messages, artifacts } = await loadConversation(taskId);

    set((state) => {
      const conversations = new Map(state.conversations);
      conversations.set(taskId, {
        ...conv,
        messages,
        artifacts,
      });
      return { conversations };
    });
  },

  saveTaskConversation: async (taskId) => {
    const { conversations } = get();
    const conv = conversations.get(taskId);
    if (!conv || conv.messages.length === 0) return;

    await saveConversation(taskId, conv.messages, conv.artifacts);
  },

  removeConversation: (taskId) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      conversations.delete(taskId);
      return { conversations };
    }),
})));

// Derived hooks for convenience

/**
 * Get the active conversation (for UI rendering)
 */
export function useActiveConversation(): TaskConversation | null {
  const activeTaskId = useConversationStore((state) => state.activeTaskId);
  const conversation = useConversationStore((state) =>
    activeTaskId ? state.conversations.get(activeTaskId) : undefined
  );
  return conversation ?? null;
}

/**
 * Check if a specific task is streaming
 */
export function useIsTaskStreaming(taskId: string) {
  return useConversationStore(
    (state) => state.conversations.get(taskId)?.isStreaming ?? false
  );
}

/**
 * Check if a specific task has unread messages
 */
export function useHasUnread(taskId: string) {
  return useConversationStore(
    (state) => state.conversations.get(taskId)?.hasUnread ?? false
  );
}

/**
 * Get messages for the active task
 * Returns a stable empty array reference when no messages
 */
export function useActiveMessages() {
  return useConversationStore((state) => {
    const activeTaskId = state.activeTaskId;
    if (!activeTaskId) return EMPTY_MESSAGES;
    return state.conversations.get(activeTaskId)?.messages ?? EMPTY_MESSAGES;
  });
}

/**
 * Get streaming state for the active task
 */
export function useActiveStreaming() {
  return useConversationStore((state) => {
    const activeTaskId = state.activeTaskId;
    if (!activeTaskId) return false;
    return state.conversations.get(activeTaskId)?.isStreaming ?? false;
  });
}
