import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveMemory } from "@/lib/memoryApi";

interface NewMemoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewMemoryDialog({ isOpen, onClose }: NewMemoryDialogProps) {
  const [text, setText] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  const handleConfirm = () => {
    if (!text.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    saveMemory(text.trim(), tags.length > 0 ? tags : undefined, "user");
    setText("");
    setTagsInput("");
    onClose();
  };

  const handleClose = () => {
    setText("");
    setTagsInput("");
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && text.trim()) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-background border border-border rounded-lg shadow-lg w-[520px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Memory</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Content
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What should be remembered..."
              rows={5}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., project, preference, workflow"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!text.trim()}>
            Save Memory
          </Button>
        </div>
      </div>
    </div>
  );
}
