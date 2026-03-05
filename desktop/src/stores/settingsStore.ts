import { create } from "zustand";
import { loadSettings, saveSettings } from "@/lib/storage";
import { connectToSam, disconnectFromSam, isConnected } from "@/lib/tauri";
import type { BackendInstance } from "@/types/instance";
import {
  deriveArtifactsUrl,
  buildConnectionUrl,
  createInstance,
} from "@/types/instance";
import { useSessionStore } from "@/stores/sessionStore";
import { useMemoryStore } from "@/stores/memoryStore";
import { useArtifactsStore } from "@/stores/artifactsStore";

type ConnectionStatus = "unknown" | "connected" | "disconnected";

interface SettingsStore {
  isLoaded: boolean;
  samUrl: string;
  artifactsUrl: string;
  artifactsDir: string;
  connectionStatus: ConnectionStatus;

  // Multi-instance state
  instances: BackendInstance[];
  activeInstanceId: string | null;

  // Existing actions
  loadSettings: () => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  startConnectionPolling: () => void;
  stopConnectionPolling: () => void;

  // Instance CRUD
  addInstance: (name: string, serverUrl: string, apiKey?: string) => Promise<void>;
  updateInstance: (id: string, updates: Partial<Pick<BackendInstance, "name" | "serverUrl" | "apiKey">>) => Promise<void>;
  removeInstance: (id: string) => Promise<void>;
  switchInstance: (id: string) => Promise<void>;
  getActiveInstance: () => BackendInstance | undefined;
}

const DEFAULT_SAM_URL = "ws://127.0.0.1:9222";
const DEFAULT_ARTIFACTS_DIR = "~/.sam/artifacts/";

let pollingInterval: ReturnType<typeof setInterval> | null = null;

async function persist(instances: BackendInstance[], activeInstanceId: string | null) {
  await saveSettings({ instances, activeInstanceId });
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  isLoaded: false,
  samUrl: DEFAULT_SAM_URL,
  artifactsUrl: deriveArtifactsUrl(DEFAULT_SAM_URL),
  artifactsDir: DEFAULT_ARTIFACTS_DIR,
  connectionStatus: "unknown",
  instances: [],
  activeInstanceId: null,

  loadSettings: async () => {
    const settings = await loadSettings();
    const { instances, activeInstanceId } = settings;
    const active = instances.find((i) => i.id === activeInstanceId);

    set({
      isLoaded: true,
      instances,
      activeInstanceId,
      samUrl: active ? active.serverUrl : DEFAULT_SAM_URL,
      artifactsUrl: deriveArtifactsUrl(active ? active.serverUrl : DEFAULT_SAM_URL),
    });
  },

  setConnectionStatus: (status: ConnectionStatus) => set({ connectionStatus: status }),

  startConnectionPolling: () => {
    if (pollingInterval) return;
    const poll = async () => {
      try {
        const connected = await isConnected();
        set({ connectionStatus: connected ? "connected" : "disconnected" });
      } catch {
        set({ connectionStatus: "disconnected" });
      }
    };
    poll();
    pollingInterval = setInterval(poll, 3000);
  },

  stopConnectionPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },

  addInstance: async (name, serverUrl, apiKey?) => {
    const instance = createInstance(name, serverUrl, apiKey);
    const { instances, activeInstanceId } = get();
    const newInstances = [...instances, instance];
    const isFirst = instances.length === 0;
    const newActiveId = isFirst ? instance.id : activeInstanceId;

    set({
      instances: newInstances,
      activeInstanceId: newActiveId,
      ...(isFirst
        ? {
            samUrl: instance.serverUrl,
            artifactsUrl: deriveArtifactsUrl(instance.serverUrl),
          }
        : {}),
    });

    await persist(newInstances, newActiveId);

    // Auto-connect if first instance
    if (isFirst) {
      try {
        await connectToSam(buildConnectionUrl(instance));
      } catch (err) {
        console.warn("Failed to connect to new instance:", err);
      }
    }
  },

  updateInstance: async (id, updates) => {
    const { instances, activeInstanceId } = get();
    const newInstances = instances.map((i) =>
      i.id === id ? { ...i, ...updates } : i,
    );
    const updated = newInstances.find((i) => i.id === id);
    const isActive = id === activeInstanceId;
    const urlChanged =
      isActive &&
      updated &&
      (updates.serverUrl !== undefined || updates.apiKey !== undefined);

    set({
      instances: newInstances,
      ...(isActive && updated
        ? {
            samUrl: updated.serverUrl,
            artifactsUrl: deriveArtifactsUrl(updated.serverUrl),
          }
        : {}),
    });

    await persist(newInstances, activeInstanceId);

    // Reconnect if URL or apiKey changed for active instance
    if (urlChanged && updated) {
      try {
        await disconnectFromSam();
        await connectToSam(buildConnectionUrl(updated));
      } catch (err) {
        console.warn("Failed to reconnect after update:", err);
      }
    }
  },

  removeInstance: async (id) => {
    const { instances, activeInstanceId } = get();
    const newInstances = instances.filter((i) => i.id !== id);
    let newActiveId = activeInstanceId;

    if (id === activeInstanceId) {
      // Switch to first remaining, or null
      const next = newInstances[0];
      newActiveId = next?.id ?? null;

      if (next) {
        set({
          instances: newInstances,
          activeInstanceId: newActiveId,
          samUrl: next.serverUrl,
          artifactsUrl: deriveArtifactsUrl(next.serverUrl),
        });
        await persist(newInstances, newActiveId);
        // Reconnect to the new active
        try {
          await disconnectFromSam();
          useSessionStore.getState().clearAll();
          useMemoryStore.setState({ memories: [], total: 0 });
          useArtifactsStore.setState({ files: [] });
          await connectToSam(buildConnectionUrl(next));
          await useSessionStore.getState().loadSessions();
        } catch (err) {
          console.warn("Failed to switch after removal:", err);
        }
      } else {
        set({
          instances: newInstances,
          activeInstanceId: null,
          samUrl: DEFAULT_SAM_URL,
          artifactsUrl: deriveArtifactsUrl(DEFAULT_SAM_URL),
        });
        await persist(newInstances, null);
        try {
          await disconnectFromSam();
          useSessionStore.getState().clearAll();
          useMemoryStore.setState({ memories: [], total: 0 });
          useArtifactsStore.setState({ files: [] });
        } catch (err) {
          console.warn("Failed to disconnect after removal:", err);
        }
      }
    } else {
      set({ instances: newInstances });
      await persist(newInstances, newActiveId);
    }
  },

  switchInstance: async (id) => {
    const { activeInstanceId, instances } = get();
    if (id === activeInstanceId) return;

    const instance = instances.find((i) => i.id === id);
    if (!instance) return;

    // 1. Disconnect
    try {
      await disconnectFromSam();
    } catch {
      // ignore
    }

    // 2. Clear stores
    useSessionStore.getState().clearAll();
    useMemoryStore.setState({ memories: [], total: 0 });
    useArtifactsStore.setState({ files: [] });

    // 3. Update state
    set({
      activeInstanceId: id,
      samUrl: instance.serverUrl,
      artifactsUrl: deriveArtifactsUrl(instance.serverUrl),
    });
    await persist(instances, id);

    // 4. Connect to new instance
    try {
      await connectToSam(buildConnectionUrl(instance));
    } catch (err) {
      console.warn("Failed to connect to instance:", err);
    }

    // 5. Load sessions and auto-select
    try {
      await useSessionStore.getState().loadSessions();
      const { sessions, selectSession } = useSessionStore.getState();
      const latestApp = sessions.find((s) => s.channelId === "app");
      if (latestApp) {
        selectSession(`${latestApp.channelId}:${latestApp.conversationId}`);
      } else if (sessions.length > 0) {
        selectSession(`${sessions[0].channelId}:${sessions[0].conversationId}`);
      }
    } catch (err) {
      console.warn("Failed to load sessions after switch:", err);
    }
  },

  getActiveInstance: () => {
    const { instances, activeInstanceId } = get();
    return instances.find((i) => i.id === activeInstanceId);
  },
}));
