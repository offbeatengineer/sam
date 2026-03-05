import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

export interface KitInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  enabled: boolean;
}

interface KitsState {
  kits: KitInfo[];
  isLoading: boolean;
  selectedKitId: string | null;

  fetchKits: () => Promise<void>;
  setSelectedKitId: (id: string | null) => void;
  scheduleRefresh: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useKitsStore = create<KitsState>()((set, get) => ({
  kits: [],
  isLoading: false,
  selectedKitId: null,

  fetchKits: async () => {
    const { artifactsUrl } = useSettingsStore.getState();
    // Kits API is on the same server as artifacts
    const baseUrl = artifactsUrl.replace(/\/__files$/, "").replace(/\/$/, "");
    set({ isLoading: true });
    try {
      const res = await fetch(`${baseUrl}/kits`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const kits = (await res.json()) as KitInfo[];
      set({ kits, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setSelectedKitId: (id) => set({ selectedKitId: id }),

  scheduleRefresh: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      get().fetchKits();
    }, 300);
  },
}));
