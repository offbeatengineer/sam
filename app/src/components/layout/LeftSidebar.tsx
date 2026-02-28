import { useState, useEffect, useCallback } from "react";
import { Plus, Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { TaskList } from "@/components/sidebar/TaskList";
import { SkillList } from "@/components/sidebar/SkillList";
import { MemoryList } from "@/components/memory/MemoryList";
import { UserProfile } from "@/components/sidebar/UserProfile";
import { NewTaskDialog } from "@/components/sidebar/NewTaskDialog";
import { NewSkillDialog } from "@/components/sidebar/NewSkillDialog";
import { NewMemoryDialog } from "@/components/memory/NewMemoryDialog";
import { SettingsDialog } from "@/components/sidebar/SettingsDialog";
import { useTaskStore } from "@/stores/taskStore";
import { useSkillStore } from "@/stores/skillStore";
import { useMemoryStore } from "@/stores/memoryStore";
import { useUIStore, type LeftSidebarTab } from "@/stores/uiStore";
import { listMemories, searchMemories } from "@/lib/memoryApi";
import { cn } from "@/lib/utils";
export function LeftSidebar() {
  const { createNewTask } = useTaskStore();
  const { skills, isLoaded, loadSkills, createSkill } = useSkillStore();
  const { searchQuery, setSearchQuery, setIsLoading } = useMemoryStore();
  const { leftSidebarOpen, toggleLeftSidebar, selectedArtifact, leftSidebarTab, setLeftSidebarTab, editingSkillId, setEditingSkillId } = useUIStore();
  const [isNewTaskDialogOpen, setIsNewTaskDialogOpen] = useState(false);
  const [isNewSkillDialogOpen, setIsNewSkillDialogOpen] = useState(false);
  const [isNewMemoryDialogOpen, setIsNewMemoryDialogOpen] = useState(false);
  const artifactPanelOpen = selectedArtifact !== null;

  const handleNewTaskConfirm = (workingDirectory?: string) => {
    createNewTask("New task", workingDirectory);
    setIsNewTaskDialogOpen(false);
  };

  const handleNewSkillConfirm = async (name: string, description: string) => {
    const skill = await createSkill(name, description);
    setIsNewSkillDialogOpen(false);
    setEditingSkillId(skill.id);
  };

  const handleTabClick = async (tab: LeftSidebarTab) => {
    setLeftSidebarTab(tab);
    if (tab === "skills") {
      // Load skills if needed, then auto-select the first one
      if (!isLoaded) {
        await loadSkills();
        const { skills: loadedSkills } = useSkillStore.getState();
        if (loadedSkills.length > 0) {
          setEditingSkillId(loadedSkills[0].id);
        }
      } else if (skills.length > 0) {
        setEditingSkillId(skills[0].id);
      }
    } else if (tab === "memory") {
      setEditingSkillId(null);
      setIsLoading(true);
      listMemories();
    } else {
      setEditingSkillId(null);
    }
  };

  const handleMemorySearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      setIsLoading(true);
      if (query.trim()) {
        searchMemories(query.trim());
      } else {
        listMemories();
      }
    },
    [setSearchQuery, setIsLoading],
  );

  // Auto-select first skill on app restart when skills tab was persisted
  useEffect(() => {
    if (leftSidebarTab === "skills" && isLoaded && !editingSkillId && skills.length > 0) {
      setEditingSkillId(skills[0].id);
    }
  }, [leftSidebarTab, isLoaded, editingSkillId, skills, setEditingSkillId]);

  // Load memories on app restart when memory tab was persisted
  useEffect(() => {
    if (leftSidebarTab === "memory") {
      listMemories();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sidebar collapses when artifact panel is open OR when manually closed
  const isCollapsed = artifactPanelOpen || !leftSidebarOpen;

  return (
    <div
      className={cn(
        "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        isCollapsed ? "w-0 border-r-0" : "w-64"
      )}
    >
      {/* Header with toggle */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-end h-12 px-3 w-64 border-b border-border"
      >
        <SidebarToggle
          side="left"
          isOpen={leftSidebarOpen}
          onClick={toggleLeftSidebar}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-2 py-2 w-64 border-b border-border">
        <button
          onClick={() => handleTabClick("tasks")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            leftSidebarTab === "tasks"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          Tasks
        </button>
        <button
          onClick={() => handleTabClick("skills")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            leftSidebarTab === "skills"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          Skills
        </button>
        <button
          onClick={() => handleTabClick("memory")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            leftSidebarTab === "memory"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          Memory
        </button>
      </div>

      {/* New button or search */}
      <div className="w-64">
        {leftSidebarTab === "tasks" && (
          <button
            className="flex items-center gap-2 px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent/50 text-sidebar-foreground w-[calc(100%-16px)] h-[41px]"
            onClick={() => setIsNewTaskDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New task
          </button>
        )}
        {leftSidebarTab === "skills" && (
          <button
            className="flex items-center gap-2 px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent/50 text-sidebar-foreground w-[calc(100%-16px)] h-[41px]"
            onClick={() => setIsNewSkillDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New skill
          </button>
        )}
        {leftSidebarTab === "memory" && (
          <div className="px-2 space-y-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleMemorySearch(e.target.value)}
                placeholder="Search memories..."
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent/50 text-sidebar-foreground w-full h-[33px]"
              onClick={() => setIsNewMemoryDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New memory
            </button>
          </div>
        )}
      </div>

      {/* New Task Dialog */}
      <NewTaskDialog
        isOpen={isNewTaskDialogOpen}
        onClose={() => setIsNewTaskDialogOpen(false)}
        onConfirm={handleNewTaskConfirm}
      />

      {/* New Skill Dialog */}
      <NewSkillDialog
        isOpen={isNewSkillDialogOpen}
        onClose={() => setIsNewSkillDialogOpen(false)}
        onConfirm={handleNewSkillConfirm}
      />

      {/* New Memory Dialog */}
      <NewMemoryDialog
        isOpen={isNewMemoryDialogOpen}
        onClose={() => setIsNewMemoryDialogOpen(false)}
      />

      {/* Settings Dialog */}
      <SettingsDialog />

      {/* Tab content list */}
      <ScrollArea className="flex-1 w-64">
        {leftSidebarTab === "tasks" && <TaskList />}
        {leftSidebarTab === "skills" && <SkillList />}
        {leftSidebarTab === "memory" && <MemoryList />}
      </ScrollArea>

      {/* User profile */}
      <div className="w-64">
        <UserProfile />
      </div>
    </div>
  );
}
