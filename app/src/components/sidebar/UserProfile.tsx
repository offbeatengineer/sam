import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";

export function UserProfile() {
  const openSettingsDialog = useSettingsStore((state) => state.openSettingsDialog);
  const connectionStatus = useSettingsStore((state) => state.connectionStatus);

  return (
    <div className="px-3 py-2 border-t border-sidebar-border flex items-center justify-between">
      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
        <span className={cn(
          "h-1.5 w-1.5 rounded-full",
          connectionStatus === "connected" && "bg-green-500",
          connectionStatus === "disconnected" && "bg-red-500",
          connectionStatus === "unknown" && "bg-gray-400",
        )} />
        {connectionStatus === "connected" ? "Connected" : connectionStatus === "disconnected" ? "Disconnected" : "Checking..."}
      </span>

      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openSettingsDialog}>
        <Settings className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
