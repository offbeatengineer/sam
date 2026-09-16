import { create } from "zustand";
import type { MemoryItem } from "@/types/chat";

interface MemoryStore {
  memories: MemoryItem[];
  total: number;
  isLoading: boolean;
  searchQuery: string;
  selectedMemoryId: string | null;
  /** Include memories that were replaced or forgotten. */
  showAll: boolean;

  setMemories: (memories: MemoryItem[], total: number) => void;
  addMemory: (memory: MemoryItem) => void;
  removeMemory: (id: string) => void;
  updateMemoryInList: (id: string, patch: Partial<MemoryItem>) => void;
  setShowAll: (showAll: boolean) => void;
  setSelectedMemoryId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useMemoryStore = create<MemoryStore>()((set) => ({
  memories: [],
  total: 0,
  isLoading: false,
  searchQuery: "",
  selectedMemoryId: null,
  showAll: false,

  setMemories: (memories, total) => set({ memories, total, isLoading: false }),

  addMemory: (memory) =>
    set((state) => ({
      memories: [memory, ...state.memories],
      total: state.total + 1,
    })),

  removeMemory: (id) =>
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
      total: state.total - 1,
      selectedMemoryId:
        state.selectedMemoryId === id ? null : state.selectedMemoryId,
    })),

  updateMemoryInList: (id, patch) =>
    set((state) => ({
      memories: state.memories.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),

  setShowAll: (showAll) => set({ showAll }),

  setSelectedMemoryId: (id) => set({ selectedMemoryId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsLoading: (loading) => set({ isLoading: loading }),
}));
