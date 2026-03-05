import { useMemoryStore } from "@/stores/memoryStore";
import { cn } from "@/lib/utils";

export function MemoryList() {
  const { memories, isLoading, selectedMemoryId, setSelectedMemoryId } =
    useMemoryStore();

  if (isLoading && memories.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        Loading memories...
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No memories yet.
      </div>
    );
  }

  return (
    <div className="pb-2 w-64">
      {memories.map((memory) => (
        <div
          key={memory.id}
          className={cn(
            "group flex flex-col gap-1 px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors overflow-hidden",
            selectedMemoryId === memory.id
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50 text-sidebar-foreground",
          )}
          onClick={() => setSelectedMemoryId(memory.id)}
        >
          <span className="truncate">{memory.text}</span>
          <div className="flex items-center gap-1.5">
            {memory.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
              >
                {tag}
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(memory.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
