import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

export interface ArtifactFileEntry {
  path: string;
  name: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
}

interface ArtifactsState {
  files: ArtifactFileEntry[];
  isLoading: boolean;
  homeDir: string;

  fetchFiles: () => Promise<void>;
  scheduleRefresh: () => void;
  initHomeDir: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useArtifactsStore = create<ArtifactsState>()((set, get) => ({
  files: [],
  isLoading: false,
  homeDir: "",

  fetchFiles: async () => {
    const { artifactsUrl } = useSettingsStore.getState();
    set({ isLoading: true });
    try {
      const res = await fetch(`${artifactsUrl}/__files`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const files = (await res.json()) as ArtifactFileEntry[];
      set({ files, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  scheduleRefresh: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      get().fetchFiles();
    }, 300);
  },

  initHomeDir: async () => {
    if (get().homeDir) return;
    try {
      const { homeDir } = await import("@tauri-apps/api/path");
      const dir = await homeDir();
      set({ homeDir: dir });
    } catch {
      // fallback — won't expand ~ paths
    }
  },
}));
