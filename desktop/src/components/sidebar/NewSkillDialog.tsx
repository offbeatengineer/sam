import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NewSkillDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string, description: string) => void;
}

export function NewSkillDialog({ isOpen, onClose, onConfirm }: NewSkillDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleConfirm = () => {
    if (!name.trim()) return;
    onConfirm(name.trim(), description.trim());
    setName("");
    setDescription("");
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && name.trim()) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative bg-background border border-border rounded-lg shadow-lg w-[480px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Skill</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Name Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Skill Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., code-reviewer"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>

          {/* Description Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what this skill does..."
              rows={3}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            Create Skill
          </Button>
        </div>
      </div>
    </div>
  );
}
