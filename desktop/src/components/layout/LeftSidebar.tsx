import { useState, useCallback } from "react";
import { Plus, ChevronsUpDown, Check, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { SessionList } from "@/components/sidebar/SessionList";
import { useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionSearchStore } from "@/stores/sessionSearchStore";
import { searchSessions } from "@/lib/sessionSearchApi";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function LeftSidebar() {
  const createNewSession = useSessionStore((state) => state.createNewSession);
  const { leftSidebarOpen, toggleLeftSidebar, selectedArtifact, setSettingsPage } = useUIStore();
  const { instances, activeInstanceId, switchInstance } = useSettingsStore();
  const { matchingIds, isSearching, setIsSearching, clear: clearSearch } = useSessionSearchStore();
  const artifactPanelOpen = selectedArtifact !== null;

  const activeInstance = instances.find((i) => i.id === activeInstanceId);

  const [searchQuery, setSearchQuery] = useState("");

  const handleNewSession = () => {
    createNewSession();
  };

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (!value.trim()) {
      clearSearch();
    }
  }, [clearSearch]);

  const handleSearchSubmit = useCallback(() => {
    if (searchQuery.trim()) {
      setIsSearching(true);
      searchSessions(searchQuery.trim(), 20);
    }
  }, [searchQuery, setIsSearching]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    clearSearch();
  }, [clearSearch]);

  const isCollapsed = artifactPanelOpen || !leftSidebarOpen;

  return (
    <div
      className={cn(
        "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        isCollapsed ? "w-0 border-r-0" : "w-64"
      )}
    >
      {/* Header with instance switcher and toggle */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-12 px-3 w-64 border-b border-border"
      >
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium text-sidebar-foreground hover:text-foreground transition-colors truncate max-w-[170px]">
            <span className="truncate">{activeInstance?.name ?? "No Instance"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {instances.map((instance) => (
              <DropdownMenuItem
                key={instance.id}
                onClick={() => switchInstance(instance.id)}
                className="gap-2"
              >
                <span className="w-4 shrink-0">
                  {instance.id === activeInstanceId && (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="truncate">{instance.name}</span>
              </DropdownMenuItem>
            ))}
            {instances.length === 0 && (
              <DropdownMenuItem
                onClick={() => setSettingsPage("settings")}
                className="text-muted-foreground"
              >
                No instances configured
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSettingsPage("settings")}>
              Manage Instances…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <SidebarToggle
          side="left"
          isOpen={leftSidebarOpen}
          onClick={toggleLeftSidebar}
        />
      </div>

      {/* New session button + search */}
      <div className="w-64 space-y-1">
        <button
          className="flex items-center gap-2 px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent/50 text-sidebar-foreground w-[calc(100%-16px)] h-[41px]"
          onClick={handleNewSession}
        >
          <Plus className="h-4 w-4" />
          New session
        </button>
        <div className="px-2 pb-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
              placeholder="Search sessions..."
              className="w-full pl-8 pr-7 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={handleClearSearch}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1 w-64">
        <SessionList filterIds={matchingIds} isSearching={isSearching} />
      </ScrollArea>
    </div>
  );
}
