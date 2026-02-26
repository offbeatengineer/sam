import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useTaskStore } from "@/stores/taskStore";
import { useIsTaskStreaming, useHasUnread } from "@/stores/conversationStore";

interface TaskItemProps {
  task: Task;
  isActive: boolean;
  onClick: () => void;
}

export function TaskItem({ task, isActive, onClick }: TaskItemProps) {
  const { deleteTask, updateTask } = useTaskStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get streaming and unread state for this task
  const isStreaming = useIsTaskStreaming(task.id);
  const hasUnread = useHasUnread(task.id);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
    } else {
      setEditValue(task.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(task.title);
      setIsEditing(false);
    }
  };

  const handleStartEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(task.title);
    setIsEditing(true);
  };

  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors overflow-hidden",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 text-sidebar-foreground"
      )}
      onClick={isEditing ? undefined : onClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-none outline-none text-sm py-0 mr-2"
          />
        ) : (
          <span className="truncate flex-1 min-w-0">{task.title}</span>
        )}

        {/* Working indicator - pulsing blue dot (only when not active) */}
        {isStreaming && !isActive && (
          <span
            className="shrink-0 h-2 w-2 rounded-full bg-blue-500 animate-pulse"
            title="AI is working on this task"
          />
        )}

        {/* Unread badge - solid primary dot (only when not active and not streaming) */}
        {hasUnread && !isActive && !isStreaming && (
          <span
            className="shrink-0 h-2 w-2 rounded-full bg-primary"
            title="New messages"
          />
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleStartEditing}>
            <Pencil className="h-4 w-4 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              deleteTask(task.id);
            }}
            className="text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
