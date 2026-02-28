import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SettingsPage = "skills" | "memory" | null;

interface UIStore {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  inputHeight: number;
  selectedArtifact: { id: string; name: string; type: string; path?: string } | null;
  settingsPage: SettingsPage;
  editingSkillId: string | null;
  expandedChannels: Record<string, boolean>;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebar: (open: boolean) => void;
  setRightSidebar: (open: boolean) => void;
  setInputHeight: (height: number) => void;
  setSelectedArtifact: (artifact: { id: string; name: string; type: string; path?: string } | null) => void;
  setSettingsPage: (page: SettingsPage) => void;
  setEditingSkillId: (id: string | null) => void;
  toggleChannel: (channelId: string) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      inputHeight: 120,
      selectedArtifact: null,
      settingsPage: null,
      editingSkillId: null,
      expandedChannels: { app: true },
      toggleLeftSidebar: () =>
        set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
      toggleRightSidebar: () =>
        set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setLeftSidebar: (open) => set({ leftSidebarOpen: open }),
      setRightSidebar: (open) => set({ rightSidebarOpen: open }),
      setInputHeight: (height) => set({ inputHeight: height }),
      setSelectedArtifact: (artifact) => set({ selectedArtifact: artifact }),
      setSettingsPage: (page) => set({ settingsPage: page, editingSkillId: null }),
      setEditingSkillId: (id) => set({ editingSkillId: id }),
      toggleChannel: (channelId) =>
        set((state) => ({
          expandedChannels: {
            ...state.expandedChannels,
            [channelId]: !state.expandedChannels[channelId],
          },
        })),
    }),
    {
      name: "sam-ui",
      partialize: (state) => ({
        leftSidebarOpen: state.leftSidebarOpen,
        rightSidebarOpen: state.rightSidebarOpen,
        editingSkillId: state.editingSkillId,
        expandedChannels: state.expandedChannels,
      }),
    }
  )
);
