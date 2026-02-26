import { create } from "zustand";
import { loadSettings, saveSettings } from "@/lib/storage";
import { isConnected } from "@/lib/tauri";

type ConnectionStatus = "unknown" | "connected" | "disconnected";

interface SettingsStore {
  isLoaded: boolean;
  settingsDialogOpen: boolean;
  samUrl: string;
  connectionStatus: ConnectionStatus;

  loadSettings: () => Promise<void>;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
  setSamUrl: (url: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  startConnectionPolling: () => void;
  stopConnectionPolling: () => void;
}

const DEFAULT_SAM_URL = "ws://127.0.0.1:9222";

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export const useSettingsStore = create<SettingsStore>()((set) => ({
  isLoaded: false,
  settingsDialogOpen: false,
  samUrl: DEFAULT_SAM_URL,
  connectionStatus: "unknown",

  loadSettings: async () => {
    const settings = await loadSettings();
    set({
      isLoaded: true,
      samUrl: (settings as any).samUrl ?? DEFAULT_SAM_URL,
    });
  },

  openSettingsDialog: () => set({ settingsDialogOpen: true }),
  closeSettingsDialog: () => set({ settingsDialogOpen: false }),

  setSamUrl: (url: string) => {
    set({ samUrl: url });
    // Persist
    saveSettings({ samUrl: url } as any).catch(console.error);
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
}));
