import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { sendRaw, generateRequestId, onAppResponse } from "@/lib/tauri";
import type {
  SessionInfo,
  SessionInfoDTO,
  SessionEntry,
  SessionHeader,
} from "@/types/session";
import { parseSessionInfo as parseInfo } from "@/types/session";

// ======================== Streaming Turn ========================

export interface StreamingTurn {
  contentBlocks: Array<{
    type: "text" | "thinking";
    content: string;
    isComplete: boolean;
  }>;
  toolExecutions: Array<{
    id: string;
    name: string;
    status: "running" | "success" | "error";
    args?: unknown;
    result?: string;
    isError?: boolean;
  }>;
}

// ======================== Pending Request Tracking ========================

// Global map, outside zustand to avoid serialization/reactivity issues
const pendingRequests = new Map<string, (response: any) => void>();
let listenerInitialized = false;

/**
 * Initialize a global Tauri event listener that resolves pending requests.
 * Called once before any request is sent (e.g. during startup).
 */
function ensureGlobalListener() {
  if (listenerInitialized) return;
  listenerInitialized = true;

  onAppResponse((response: any) => {
    const requestId = response.requestId as string | undefined;
    if (!requestId) return;

    const resolver = pendingRequests.get(requestId);
    if (resolver) {
      pendingRequests.delete(requestId);
      resolver(response);
    }
  });
}

/** Send a raw request and wait for the matching response by requestId. */
async function requestResponse(payload: Record<string, unknown>): Promise<any> {
  ensureGlobalListener();

  const requestId = generateRequestId();
  const promise = new Promise<any>((resolve) => {
    pendingRequests.set(requestId, resolve);
  });

  // Add a timeout so we never hang forever
  const timeout = new Promise<any>((_, reject) =>
    setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request ${requestId} timed out`));
    }, 10_000)
  );

  await sendRaw({ ...payload, requestId });
  return Promise.race([promise, timeout]);
}

// ======================== Store Interface ========================

interface SessionState {
  // Session list
  sessions: SessionInfo[];
  isLoaded: boolean;

  // Active session
  activeSessionId: string | null; // "channelId:conversationId"
  activeSessionPath: string | null;
  activeEntries: SessionEntry[];
  activeHeader: SessionHeader | null;

  // Streaming state (live app sessions only)
  streamingSessionId: string | null;
  streamingTurn: StreamingTurn | null;
  pendingUserMessage: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  setSessions: (dtos: SessionInfoDTO[]) => void;
  selectSession: (id: string) => void;
  setActiveEntries: (header: object | null, entries: object[]) => void;
  loadSessionEntries: (path: string) => Promise<void>;
  createNewSession: () => string;
  refreshActiveSession: () => Promise<void>;

  // Streaming
  setPendingUserMessage: (text: string) => void;
  beginStreaming: (sessionId: string) => void;
  appendTextDelta: (delta: string) => void;
  appendThinkingDelta: (delta: string) => void;
  completeThinking: () => void;
  addToolStart: (toolCallId: string, toolName: string, args: unknown) => void;
  updateTool: (toolCallId: string, partialResult: string) => void;
  endTool: (toolCallId: string, result: string, isError: boolean) => void;
  endStreaming: () => void;

  // Internal
  getActiveSession: () => SessionInfo | undefined;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function sessionIdFromInfo(s: { channelId: string; conversationId: string }): string {
  return `${s.channelId}:${s.conversationId}`;
}

export const useSessionStore = create<SessionState>()(
  subscribeWithSelector((set, get) => ({
    sessions: [],
    isLoaded: false,
    activeSessionId: null,
    activeSessionPath: null,
    activeEntries: [],
    activeHeader: null,
    streamingSessionId: null,
    streamingTurn: null,
    pendingUserMessage: null,

    loadSessions: async () => {
      const response = await requestResponse({ type: "list_sessions" });
      if (response.sessions) {
        const sessions = (response.sessions as SessionInfoDTO[]).map(parseInfo);
        set({ sessions, isLoaded: true });
      }
    },

    setSessions: (dtos: SessionInfoDTO[]) => {
      const sessions = dtos.map(parseInfo);
      set({ sessions, isLoaded: true });
    },

    selectSession: (id: string) => {
      const { sessions, activeSessionId } = get();
      if (id === activeSessionId) return;

      const session = sessions.find((s) => sessionIdFromInfo(s) === id);
      if (!session) return;

      set({
        activeSessionId: id,
        activeSessionPath: session.path,
        activeEntries: [],
        activeHeader: null,
      });

      // Load entries
      get().loadSessionEntries(session.path);
    },

    setActiveEntries: (header: object | null, entries: object[]) => {
      set({
        activeHeader: header as SessionHeader | null,
        activeEntries: entries as SessionEntry[],
      });
    },

    loadSessionEntries: async (path: string) => {
      const response = await requestResponse({
        type: "get_session_entries",
        sessionPath: path,
      });
      if (response.entries) {
        set({
          activeHeader: (response.header as SessionHeader) ?? null,
          activeEntries: response.entries as SessionEntry[],
        });
      }
    },

    createNewSession: () => {
      const conversationId = generateId();
      const id = `app:${conversationId}`;
      set({
        activeSessionId: id,
        activeSessionPath: null,
        activeEntries: [],
        activeHeader: null,
      });
      return conversationId;
    },

    refreshActiveSession: async () => {
      const { activeSessionPath } = get();
      if (!activeSessionPath) return;
      await get().loadSessionEntries(activeSessionPath);
    },

    // Streaming
    setPendingUserMessage: (text: string) => {
      set({ pendingUserMessage: text });
    },

    beginStreaming: (sessionId: string) => {
      set({
        streamingSessionId: sessionId,
        streamingTurn: {
          contentBlocks: [],
          toolExecutions: [],
        },
      });
    },

    appendTextDelta: (delta: string) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        const blocks = [...state.streamingTurn.contentBlocks];
        const lastBlock = blocks[blocks.length - 1];

        if (lastBlock && lastBlock.type === "text") {
          blocks[blocks.length - 1] = {
            ...lastBlock,
            content: lastBlock.content + delta,
          };
        } else {
          blocks.push({ type: "text", content: delta, isComplete: true });
        }

        return {
          streamingTurn: { ...state.streamingTurn, contentBlocks: blocks },
        };
      });
    },

    appendThinkingDelta: (delta: string) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        const blocks = [...state.streamingTurn.contentBlocks];
        const lastBlock = blocks[blocks.length - 1];

        if (lastBlock && lastBlock.type === "thinking" && !lastBlock.isComplete) {
          blocks[blocks.length - 1] = {
            ...lastBlock,
            content: lastBlock.content + delta,
          };
        } else {
          blocks.push({ type: "thinking", content: delta, isComplete: false });
        }

        return {
          streamingTurn: { ...state.streamingTurn, contentBlocks: blocks },
        };
      });
    },

    completeThinking: () => {
      set((state) => {
        if (!state.streamingTurn) return state;
        const blocks = [...state.streamingTurn.contentBlocks];

        for (let i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i].type === "thinking" && !blocks[i].isComplete) {
            blocks[i] = { ...blocks[i], isComplete: true };
            break;
          }
        }

        return {
          streamingTurn: { ...state.streamingTurn, contentBlocks: blocks },
        };
      });
    },

    addToolStart: (toolCallId: string, toolName: string, args: unknown) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        return {
          streamingTurn: {
            ...state.streamingTurn,
            toolExecutions: [
              ...state.streamingTurn.toolExecutions,
              { id: toolCallId, name: toolName, status: "running" as const, args },
            ],
          },
        };
      });
    },

    updateTool: (toolCallId: string, partialResult: string) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        return {
          streamingTurn: {
            ...state.streamingTurn,
            toolExecutions: state.streamingTurn.toolExecutions.map((t) =>
              t.id === toolCallId ? { ...t, result: partialResult } : t
            ),
          },
        };
      });
    },

    endTool: (toolCallId: string, result: string, isError: boolean) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        return {
          streamingTurn: {
            ...state.streamingTurn,
            toolExecutions: state.streamingTurn.toolExecutions.map((t) =>
              t.id === toolCallId
                ? { ...t, status: isError ? "error" as const : "success" as const, result, isError }
                : t
            ),
          },
        };
      });
    },

    endStreaming: () => {
      set({
        streamingSessionId: null,
        streamingTurn: null,
        pendingUserMessage: null,
      });
      // Refresh entries from JSONL
      get().refreshActiveSession();
    },

    getActiveSession: () => {
      const { sessions, activeSessionId } = get();
      if (!activeSessionId) return undefined;
      return sessions.find((s) => sessionIdFromInfo(s) === activeSessionId);
    },
  }))
);

// ======================== Derived Hooks ========================

const EMPTY_ENTRIES: SessionEntry[] = [];

export function useActiveEntries() {
  return useSessionStore((state) => state.activeEntries ?? EMPTY_ENTRIES);
}

export function useActiveStreaming() {
  return useSessionStore(
    (state) => state.streamingSessionId !== null && state.streamingSessionId === state.activeSessionId,
  );
}

export function useStreamingTurn() {
  return useSessionStore((state) =>
    state.streamingSessionId === state.activeSessionId ? state.streamingTurn : null,
  );
}

export function usePendingUserMessage() {
  return useSessionStore((state) =>
    state.streamingSessionId === state.activeSessionId ? state.pendingUserMessage : null,
  );
}

export function sessionIdFor(channelId: string, conversationId: string): string {
  return `${channelId}:${conversationId}`;
}
