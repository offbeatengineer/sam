import { create } from "zustand";
import { loadSettings, saveSettings } from "@/lib/storage";
import { isConnected } from "@/lib/tauri";

type ConnectionStatus = "unknown" | "connected" | "disconnected";

function deriveArtifactsUrl(samUrl: string): string {
  try {
    const url = new URL(samUrl);
    return `http://${url.hostname}:${DEFAULT_ARTIFACTS_PORT}`;
  } catch {
    return `http://127.0.0.1:${DEFAULT_ARTIFACTS_PORT}`;
  }
}

interface SettingsStore {
  isLoaded: boolean;
  settingsDialogOpen: boolean;
  samUrl: string;
  artifactsUrl: string;
  artifactsDir: string;
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
const DEFAULT_ARTIFACTS_PORT = 9223;
const DEFAULT_ARTIFACTS_DIR = "~/.sam/artifacts/";

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export const useSettingsStore = create<SettingsStore>()((set) => ({
  isLoaded: false,
  settingsDialogOpen: false,
  samUrl: DEFAULT_SAM_URL,
  artifactsUrl: deriveArtifactsUrl(DEFAULT_SAM_URL),
  artifactsDir: DEFAULT_ARTIFACTS_DIR,
  connectionStatus: "unknown",

  loadSettings: async () => {
    const settings = await loadSettings();
    set({
      isLoaded: true,
      samUrl: (settings as any).samUrl ?? DEFAULT_SAM_URL,
      artifactsUrl: deriveArtifactsUrl((settings as any).samUrl ?? DEFAULT_SAM_URL),
    });
  },

  openSettingsDialog: () => set({ settingsDialogOpen: true }),
  closeSettingsDialog: () => set({ settingsDialogOpen: false }),

  setSamUrl: (url: string) => {
    set({ samUrl: url, artifactsUrl: deriveArtifactsUrl(url) });
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
