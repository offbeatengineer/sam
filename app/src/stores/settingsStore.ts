import { create } from "zustand";
import { loadSettings, saveSettings } from "@/lib/storage";

interface SettingsStore {
  isLoaded: boolean;
  settingsDialogOpen: boolean;
  samUrl: string;

  loadSettings: () => Promise<void>;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
  setSamUrl: (url: string) => void;
}

const DEFAULT_SAM_URL = "ws://127.0.0.1:9222";

export const useSettingsStore = create<SettingsStore>()((set) => ({
  isLoaded: false,
  settingsDialogOpen: false,
  samUrl: DEFAULT_SAM_URL,

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
}));
