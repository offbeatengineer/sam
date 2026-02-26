import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Artifact } from "@/types/task";

export type LeftSidebarTab = "tasks" | "skills";

interface UIStore {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  inputHeight: number;
  selectedArtifact: Artifact | null;
  leftSidebarTab: LeftSidebarTab;
  editingSkillId: string | null;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebar: (open: boolean) => void;
  setRightSidebar: (open: boolean) => void;
  setInputHeight: (height: number) => void;
  setSelectedArtifact: (artifact: Artifact | null) => void;
  setLeftSidebarTab: (tab: LeftSidebarTab) => void;
  setEditingSkillId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      inputHeight: 120,
      selectedArtifact: null,
      leftSidebarTab: "tasks" as LeftSidebarTab,
      editingSkillId: null,
      toggleLeftSidebar: () =>
        set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
      toggleRightSidebar: () =>
        set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),
      setLeftSidebar: (open) => set({ leftSidebarOpen: open }),
      setRightSidebar: (open) => set({ rightSidebarOpen: open }),
      setInputHeight: (height) => set({ inputHeight: height }),
      setSelectedArtifact: (artifact) => set({ selectedArtifact: artifact }),
      setLeftSidebarTab: (tab) => set({ leftSidebarTab: tab }),
      setEditingSkillId: (id) => set({ editingSkillId: id }),
    }),
    {
      name: "sam-ui",
      partialize: (state) => ({
        leftSidebarOpen: state.leftSidebarOpen,
        rightSidebarOpen: state.rightSidebarOpen,
        leftSidebarTab: state.leftSidebarTab,
        editingSkillId: state.editingSkillId,
      }),
    }
  )
);
