import { useTauriEvents } from "./useTauriEvents";
import { useSessionSearchStore } from "@/stores/sessionSearchStore";
import type { AppResponse } from "@/types/chat";

export function useSessionSearchResponses() {
  useTauriEvents((response: AppResponse) => {
    if (response.type !== "session_search_result") return;
    const store = useSessionSearchStore.getState();
    const ids = new Set<string>();
    for (const r of response.results ?? []) {
      ids.add(r.conversation_id);
    }
    store.setMatchingIds(ids);
  });
}
