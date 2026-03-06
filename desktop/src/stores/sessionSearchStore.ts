import { create } from "zustand";

interface SessionSearchStore {
  /** Set of conversation IDs matching the current search. null = no active search. */
  matchingIds: Set<string> | null;
  isSearching: boolean;

  setMatchingIds: (ids: Set<string> | null) => void;
  setIsSearching: (searching: boolean) => void;
  clear: () => void;
}

export const useSessionSearchStore = create<SessionSearchStore>()((set) => ({
  matchingIds: null,
  isSearching: false,

  setMatchingIds: (ids) => set({ matchingIds: ids, isSearching: false }),
  setIsSearching: (searching) => set({ isSearching: searching }),
  clear: () => set({ matchingIds: null, isSearching: false }),
}));
