import { create } from "zustand";
import type { Message, ToolExecution } from "@/types/chat";

interface ChatStore {
  messages: Message[];
  isStreaming: boolean;
  sessionId: string | null;

  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  appendToLastMessage: (content: string) => void;
  addToolExecution: (messageId: string, tool: ToolExecution) => void;
  updateToolExecution: (
    messageId: string,
    toolId: string,
    updates: Partial<ToolExecution>
  ) => void;
  setStreaming: (streaming: boolean) => void;
  setSessionId: (id: string | null) => void;
  setBackend: (backend: string) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  sessionId: null,

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    })),

  appendToLastMessage: (content) =>
    set((state) => {
      console.log('[chatStore] appendToLastMessage called with:', content);
      const messages = [...state.messages];
      const lastIndex = messages.length - 1;
      if (lastIndex >= 0 && messages[lastIndex].role === "assistant") {
        const oldContent = messages[lastIndex].content;
        const newContent = oldContent + content;
        console.log('[chatStore] Old content:', JSON.stringify(oldContent), '-> New content:', JSON.stringify(newContent));
        messages[lastIndex] = {
          ...messages[lastIndex],
          content: newContent,
        };
      }
      return { messages };
    }),

  addToolExecution: (messageId, tool) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              toolExecutions: [...(msg.toolExecutions || []), tool],
            }
          : msg
      ),
    })),

  updateToolExecution: (messageId, toolId, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              toolExecutions: msg.toolExecutions?.map((tool) =>
                tool.id === toolId ? { ...tool, ...updates } : tool
              ),
            }
          : msg
      ),
    })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setSessionId: (id) => set({ sessionId: id }),
  setBackend: () => {},
  setMessages: (messages) => set({ messages }),
  clearMessages: () => set({ messages: [], sessionId: null }),
}));
