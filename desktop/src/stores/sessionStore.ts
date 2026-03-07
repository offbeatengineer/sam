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

export type StreamItem =
  | { kind: "text"; content: string }
  | { kind: "thinking"; content: string; isComplete: boolean }
  | { kind: "tool"; id: string; name: string; status: "running" | "success" | "error"; args?: unknown; result?: string; isError?: boolean; details?: unknown };

export interface StreamingTurn {
  /** Single ordered timeline — items appended as they arrive from the stream. */
  items: StreamItem[];
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

  // Archived sessions (lazy loaded)
  archivedSessions: SessionInfo[];
  archivedLoaded: boolean;

  // Active session
  activeSessionId: string | null; // "channelId:conversationId"
  activeSessionPath: string | null;
  activeEntries: SessionEntry[];
  activeHeader: SessionHeader | null;

  // Streaming state (live app sessions only)
  streamingSessionId: string | null;
  streamingTurn: StreamingTurn | null;
  pendingUserMessage: string | null;
  pendingUserImages: Array<{ id: string; dataUrl: string }>;
  pendingUserAudio: { duration: number } | null;

  // Actions
  loadSessions: () => Promise<void>;
  setSessions: (dtos: SessionInfoDTO[]) => void;
  selectSession: (id: string) => void;
  setActiveEntries: (header: object | null, entries: object[]) => void;
  loadSessionEntries: (path: string) => Promise<void>;
  createNewSession: () => string;
  refreshActiveSession: () => Promise<void>;
  renameSession: (sessionPath: string, name: string) => Promise<void>;
  loadArchivedSessions: () => Promise<void>;
  archiveSession: (sessionPath: string) => Promise<void>;
  unarchiveSession: (sessionPath: string) => Promise<void>;

  // Streaming
  setPendingUserMessage: (
    text: string,
    images?: Array<{ id: string; dataUrl: string }>,
    audio?: { duration: number } | null,
  ) => void;
  beginStreaming: (sessionId: string) => void;
  appendTextDelta: (delta: string) => void;
  appendThinkingDelta: (delta: string) => void;
  completeThinking: () => void;
  addToolStart: (toolCallId: string, toolName: string, args: unknown) => void;
  updateTool: (toolCallId: string, partialResult: string) => void;
  endTool: (toolCallId: string, result: string, isError: boolean, details?: unknown) => void;
  endStreaming: () => void;

  // Reset
  clearAll: () => void;

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
    archivedSessions: [],
    archivedLoaded: false,
    activeSessionId: null,
    activeSessionPath: null,
    activeEntries: [],
    activeHeader: null,
    streamingSessionId: null,
    streamingTurn: null,
    pendingUserMessage: null,
    pendingUserImages: [],
    pendingUserAudio: null,

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
      const { sessions, archivedSessions, activeSessionId } = get();
      if (id === activeSessionId) return;

      const session = sessions.find((s) => sessionIdFromInfo(s) === id)
        ?? archivedSessions.find((s) => sessionIdFromInfo(s) === id);
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
      let { activeSessionPath, activeSessionId } = get();

      // New session: path unknown yet — discover it from the sessions list
      if (!activeSessionPath && activeSessionId) {
        await get().loadSessions();
        const session = get().sessions.find(
          (s) => sessionIdFromInfo(s) === activeSessionId,
        );
        if (session) {
          activeSessionPath = session.path;
          set({ activeSessionPath });
        }
      }

      if (!activeSessionPath) return;
      await get().loadSessionEntries(activeSessionPath);
    },

    renameSession: async (sessionPath: string, name: string) => {
      const response = await requestResponse({
        type: "rename_session",
        sessionPath,
        name,
      });
      if (response.success) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.path === sessionPath ? { ...s, name } : s,
          ),
        }));
      }
    },

    loadArchivedSessions: async () => {
      const response = await requestResponse({ type: "list_archived_sessions" });
      if (response.sessions) {
        const archivedSessions = (response.sessions as SessionInfoDTO[]).map(parseInfo);
        set({ archivedSessions, archivedLoaded: true });
      }
    },

    archiveSession: async (sessionPath: string) => {
      const response = await requestResponse({
        type: "archive_session",
        sessionPath,
      });
      if (response.success) {
        const { sessions, activeSessionPath } = get();
        set({
          sessions: sessions.filter((s) => s.path !== sessionPath),
          archivedLoaded: false,
        });
        if (activeSessionPath === sessionPath) {
          set({
            activeSessionId: null,
            activeSessionPath: null,
            activeEntries: [],
            activeHeader: null,
          });
        }
      }
    },

    unarchiveSession: async (sessionPath: string) => {
      const response = await requestResponse({
        type: "unarchive_session",
        sessionPath,
      });
      if (response.success) {
        const { archivedSessions, activeSessionPath } = get();
        set({
          archivedSessions: archivedSessions.filter((s) => s.path !== sessionPath),
        });
        if (activeSessionPath === sessionPath) {
          set({
            activeSessionId: null,
            activeSessionPath: null,
            activeEntries: [],
            activeHeader: null,
          });
        }
        get().loadSessions();
      }
    },

    // Streaming
    setPendingUserMessage: (
      text: string,
      images?: Array<{ id: string; dataUrl: string }>,
      audio?: { duration: number } | null,
    ) => {
      set({
        pendingUserMessage: text,
        pendingUserImages: images ?? [],
        pendingUserAudio: audio ?? null,
      });
    },

    beginStreaming: (sessionId: string) => {
      set({
        streamingSessionId: sessionId,
        streamingTurn: { items: [] },
      });
    },

    appendTextDelta: (delta: string) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        const items = [...state.streamingTurn.items];
        const last = items[items.length - 1];

        if (last && last.kind === "text") {
          items[items.length - 1] = { ...last, content: last.content + delta };
        } else {
          items.push({ kind: "text", content: delta });
        }

        return { streamingTurn: { items } };
      });
    },

    appendThinkingDelta: (delta: string) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        const items = [...state.streamingTurn.items];
        const last = items[items.length - 1];

        if (last && last.kind === "thinking" && !last.isComplete) {
          items[items.length - 1] = { ...last, content: last.content + delta };
        } else {
          items.push({ kind: "thinking", content: delta, isComplete: false });
        }

        return { streamingTurn: { items } };
      });
    },

    completeThinking: () => {
      set((state) => {
        if (!state.streamingTurn) return state;
        const items = [...state.streamingTurn.items];

        for (let i = items.length - 1; i >= 0; i--) {
          const item = items[i];
          if (item.kind === "thinking" && !item.isComplete) {
            items[i] = { ...item, isComplete: true };
            break;
          }
        }

        return { streamingTurn: { items } };
      });
    },

    addToolStart: (toolCallId: string, toolName: string, args: unknown) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        return {
          streamingTurn: {
            items: [
              ...state.streamingTurn.items,
              { kind: "tool" as const, id: toolCallId, name: toolName, status: "running" as const, args },
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
            items: state.streamingTurn.items.map((item) =>
              item.kind === "tool" && item.id === toolCallId
                ? { ...item, result: partialResult }
                : item
            ),
          },
        };
      });
    },

    endTool: (toolCallId: string, result: string, isError: boolean, details?: unknown) => {
      set((state) => {
        if (!state.streamingTurn) return state;
        return {
          streamingTurn: {
            items: state.streamingTurn.items.map((item) =>
              item.kind === "tool" && item.id === toolCallId
                ? { ...item, status: isError ? "error" as const : "success" as const, result, isError, ...(details !== undefined ? { details } : {}) }
                : item
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
        pendingUserImages: [],
        pendingUserAudio: null,
      });
      // Refresh entries from JSONL
      get().refreshActiveSession();
    },

    clearAll: () => {
      set({
        sessions: [],
        isLoaded: false,
        archivedSessions: [],
        archivedLoaded: false,
        activeSessionId: null,
        activeSessionPath: null,
        activeEntries: [],
        activeHeader: null,
        streamingSessionId: null,
        streamingTurn: null,
        pendingUserMessage: null,
        pendingUserImages: [],
        pendingUserAudio: null,
      });
    },

    getActiveSession: () => {
      const { sessions, archivedSessions, activeSessionId } = get();
      if (!activeSessionId) return undefined;
      return sessions.find((s) => sessionIdFromInfo(s) === activeSessionId)
        ?? archivedSessions.find((s) => sessionIdFromInfo(s) === activeSessionId);
    },
  }))
);

// ======================== Derived Hooks ========================

const EMPTY_ENTRIES: SessionEntry[] = [];
const EMPTY_IMAGES: Array<{ id: string; dataUrl: string }> = [];

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

export function usePendingUserImages() {
  return useSessionStore((state) =>
    state.streamingSessionId === state.activeSessionId ? state.pendingUserImages : EMPTY_IMAGES,
  );
}

export function usePendingUserAudio() {
  return useSessionStore((state) =>
    state.streamingSessionId === state.activeSessionId ? state.pendingUserAudio : null,
  );
}

export function sessionIdFor(channelId: string, conversationId: string): string {
  return `${channelId}:${conversationId}`;
}
