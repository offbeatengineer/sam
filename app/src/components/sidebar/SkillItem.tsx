import { MoreHorizontal, Pencil, Trash2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Skill } from "@/types/skill";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSkillStore } from "@/stores/skillStore";
import { useUIStore } from "@/stores/uiStore";

interface SkillItemProps {
  skill: Skill;
}

export function SkillItem({ skill }: SkillItemProps) {
  const { deleteSkill } = useSkillStore();
  const { setEditingSkillId } = useUIStore();

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSkillId(skill.id);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSkill(skill.id);
  };

  const handleClick = () => {
    setEditingSkillId(skill.id);
  };

  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors overflow-hidden",
        "hover:bg-accent/50 text-sidebar-foreground"
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="truncate flex-1 min-w-0">{skill.name}</span>

        {skill.isSystem && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
            <Shield className="h-3 w-3" />
            SYSTEM
          </span>
        )}
      </div>

      {!skill.isSystem && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
