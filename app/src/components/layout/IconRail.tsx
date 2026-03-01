import { MessageSquare, BookOpen, Brain, Settings } from "lucide-react";
import { useUIStore, SettingsPage } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";

const pages: { id: SettingsPage; icon: typeof MessageSquare; label: string }[] = [
  { id: null, icon: MessageSquare, label: "Agent" },
  { id: "skills", icon: BookOpen, label: "Skills" },
  { id: "memory", icon: Brain, label: "Memory" },
  { id: "settings", icon: Settings, label: "Settings" },
];

const statusColor: Record<string, string> = {
  connected: "#22c55e",
  disconnected: "#ef4444",
  unknown: "#9ca3af",
};

export function IconRail() {
  const settingsPage = useUIStore((s) => s.settingsPage);
  const setSettingsPage = useUIStore((s) => s.setSettingsPage);
  const connectionStatus = useSettingsStore((s) => s.connectionStatus);

  return (
    <div className="w-12 bg-sidebar flex flex-col items-center shrink-0">
      {/* Header segment — aligns with other page headers, no right border */}
      <div
        data-tauri-drag-region
        className="h-12 w-full border-b border-border"
      />

      {/* Content segment — icon buttons */}
      <div className="flex flex-col items-center gap-1 px-1 pt-2 border-r border-sidebar-border flex-1 w-full">
        {pages.map(({ id, icon: Icon, label }) => {
          const active = settingsPage === id;
          return (
            <button
              key={label}
              title={label}
              className={cn(
                "relative h-9 w-9 flex items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
              onClick={() => setSettingsPage(id)}
            >
              <Icon className="h-4 w-4" />
              {id === null && (
                <span
                  className="absolute top-1 right-1 h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusColor[connectionStatus] ?? "#9ca3af" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
