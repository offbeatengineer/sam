import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NewTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (workingDirectory?: string) => void;
}

export function NewTaskDialog({ isOpen, onClose, onConfirm }: NewTaskDialogProps) {
  const [workingDirectory, setWorkingDirectory] = useState<string | undefined>();

  const handleSelectDirectory = async () => {
    const selected = await open({
      directory: true,
      title: "Select Working Directory",
    });

    if (selected && typeof selected === "string") {
      setWorkingDirectory(selected);
    }
  };

  const handleConfirm = () => {
    onConfirm(workingDirectory);
    setWorkingDirectory(undefined);
  };

  const handleClose = () => {
    setWorkingDirectory(undefined);
    onClose();
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
          <h2 className="text-lg font-semibold">New Task</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6">
          {/* Working Directory Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">
              Working Directory
            </label>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2 rounded-md border border-border bg-muted/30 text-sm truncate">
                {workingDirectory ? (
                  <span className="text-foreground">{workingDirectory}</span>
                ) : (
                  <span className="text-muted-foreground">No directory selected (optional)</span>
                )}
              </div>
              <Button
                variant="outline"
                size="default"
                onClick={handleSelectDirectory}
                className="shrink-0"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Browse
              </Button>
            </div>
            {workingDirectory && (
              <button
                onClick={() => setWorkingDirectory(undefined)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear selection
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Create Task
          </Button>
        </div>
      </div>
    </div>
  );
}
