import { useTauriEvents } from "./useTauriEvents";
import { useMemoryStore } from "@/stores/memoryStore";
import type { AppResponse } from "@/types/chat";

export function useMemoryResponses() {
  useTauriEvents((response: AppResponse) => {
    const store = useMemoryStore.getState();

    switch (response.type) {
      case "memory_list_result":
        store.setMemories(response.memories ?? [], response.total ?? 0);
        break;

      case "memory_search_result":
        store.setMemories(response.memories ?? [], response.count ?? 0);
        break;

      case "memory_save_result":
        if (response.id && response.text != null) {
          store.addMemory({
            id: response.id,
            text: response.text,
            tags: response.tags ?? [],
            source: "user",
            created_at: Date.now(),
            score: 0,
          });
        }
        store.setIsLoading(false);
        break;

      case "memory_update_result":
        store.setIsLoading(false);
        break;

      case "memory_delete_result":
        store.setIsLoading(false);
        break;

      case "memory_error":
        console.error("[memory]", response.error);
        store.setIsLoading(false);
        break;
    }
  });
}
