import { ChevronDown, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";

export function UserProfile() {
  const openSettingsDialog = useSettingsStore((state) => state.openSettingsDialog);

  return (
    <div className="p-3 border-t border-sidebar-border flex items-center gap-2">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="bg-primary/10 text-primary text-xs">
          U
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium truncate">User</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground">Local</span>
      </div>

      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openSettingsDialog}>
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  );
}
