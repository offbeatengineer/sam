import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { useMemoryStore } from "@/stores/memoryStore";
import { deleteMemory, updateMemory } from "@/lib/memoryApi";

export function MemoryDetail() {
  const { memories, selectedMemoryId, removeMemory, updateMemoryInList } =
    useMemoryStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editTags, setEditTags] = useState("");

  const memory = memories.find((m) => m.id === selectedMemoryId);

  // Reset edit state when selection changes
  useEffect(() => {
    setIsEditing(false);
  }, [selectedMemoryId]);

  const handleEditorChange = useCallback((content: string) => {
    setEditText(content);
  }, []);

  const hasUnsavedChanges =
    isEditing &&
    memory != null &&
    (editText !== memory.text || editTags !== memory.tags.join(", "));

  if (!memory) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground bg-sidebar">
        Select a memory to view details
      </div>
    );
  }

  const handleEdit = () => {
    setEditText(memory.text);
    setEditTags(memory.tags.join(", "));
    setIsEditing(true);
  };

  const handleSave = () => {
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    updateMemory(memory.id, editText, tags);
    updateMemoryInList(memory.id, editText, tags);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleDelete = () => {
    deleteMemory(memory.id);
    removeMemory(memory.id);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-sidebar">
      {/* Header */}
      <div data-tauri-drag-region className="h-12 px-4 flex items-center justify-between border-b border-border">
        <h2 className="text-sm font-medium truncate">Memory Detail</h2>
        {!isEditing && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {isEditing ? (
        <>
          {/* Editor */}
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor
              content={editText}
              onChange={handleEditorChange}
              onSave={handleSave}
              hasUnsavedChanges={hasUnsavedChanges}
            />
          </div>

          {/* Tags + actions at bottom */}
          <div className="border-t border-border px-4 py-3 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Tags
              </label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="comma-separated tags"
                className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </>
      ) : (
        /* Read-only view */
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Content */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Content
            </label>
            <div className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {memory.text}
              </ReactMarkdown>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Tags
            </label>
            {memory.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {memory.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No tags</p>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Metadata
            </label>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>
                Source:{" "}
                <span className="text-foreground">{memory.source}</span>
              </div>
              <div>
                Created:{" "}
                <span className="text-foreground">
                  {new Date(memory.created_at).toLocaleString()}
                </span>
              </div>
              {memory.score > 0 && (
                <div>
                  Relevance:{" "}
                  <span className="text-foreground">
                    {(memory.score * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
