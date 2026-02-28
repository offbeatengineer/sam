import { create } from "zustand";
import type { MemoryItem } from "@/types/chat";

interface MemoryStore {
  memories: MemoryItem[];
  total: number;
  isLoading: boolean;
  searchQuery: string;
  selectedMemoryId: string | null;

  setMemories: (memories: MemoryItem[], total: number) => void;
  addMemory: (memory: MemoryItem) => void;
  removeMemory: (id: string) => void;
  updateMemoryInList: (id: string, text: string, tags: string[]) => void;
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

  updateMemoryInList: (id, text, tags) =>
    set((state) => ({
      memories: state.memories.map((m) =>
        m.id === id ? { ...m, text, tags } : m,
      ),
    })),

  setSelectedMemoryId: (id) => set({ selectedMemoryId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsLoading: (loading) => set({ isLoading: loading }),
}));
