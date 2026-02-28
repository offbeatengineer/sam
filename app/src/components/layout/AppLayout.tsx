import { useEffect, useCallback, useState } from "react";
import { Plus, Search, ArrowLeft } from "lucide-react";
import { LeftSidebar } from "./LeftSidebar";
import { MainPanel } from "./MainPanel";
import { ArtifactPanel } from "./ArtifactPanel";
import { RightSidebar } from "./RightSidebar";
import { SkillEditor } from "@/components/skill/SkillEditor";
import { SkillList } from "@/components/sidebar/SkillList";
import { MemoryDetail } from "@/components/memory/MemoryDetail";
import { MemoryList } from "@/components/memory/MemoryList";
import { NewSkillDialog } from "@/components/sidebar/NewSkillDialog";
import { NewMemoryDialog } from "@/components/memory/NewMemoryDialog";
import { useUIStore } from "@/stores/uiStore";
import { useSkillStore } from "@/stores/skillStore";
import { useMemoryStore } from "@/stores/memoryStore";
import { useMemoryResponses } from "@/hooks/useMemoryResponses";
import { listMemories, searchMemories } from "@/lib/memoryApi";
import { ScrollArea } from "@/components/ui/scroll-area";

function SettingsSkillsPage() {
  const { skills, isLoaded, loadSkills, createSkill } = useSkillStore();
  const { editingSkillId, setEditingSkillId, setSettingsPage } = useUIStore();
  const [isNewSkillDialogOpen, setIsNewSkillDialogOpen] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      loadSkills().then(() => {
        const { skills: loaded } = useSkillStore.getState();
        if (loaded.length > 0 && !editingSkillId) {
          setEditingSkillId(loaded[0].id);
        }
      });
    } else if (skills.length > 0 && !editingSkillId) {
      setEditingSkillId(skills[0].id);
    }
  }, [isLoaded, loadSkills, skills, editingSkillId, setEditingSkillId]);

  const handleNewSkillConfirm = async (name: string, description: string) => {
    const skill = await createSkill(name, description);
    setIsNewSkillDialogOpen(false);
    setEditingSkillId(skill.id);
  };

  return (
    <div className="flex flex-1 min-w-0">
      {/* Skills sidebar */}
      <div className="w-64 border-r border-border flex flex-col bg-sidebar">
        <div className="flex items-center justify-between h-12 px-3 border-b border-border">
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSettingsPage(null)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-sm font-medium">Skills</h2>
        </div>
        <div className="w-64">
          <button
            className="flex items-center gap-2 px-3 py-2 mx-2 rounded-md cursor-pointer text-sm transition-colors hover:bg-accent/50 text-sidebar-foreground w-[calc(100%-16px)] h-[41px]"
            onClick={() => setIsNewSkillDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New skill
          </button>
        </div>
        <ScrollArea className="flex-1">
          <SkillList />
        </ScrollArea>
        <NewSkillDialog
          isOpen={isNewSkillDialogOpen}
          onClose={() => setIsNewSkillDialogOpen(false)}
          onConfirm={handleNewSkillConfirm}
        />
      </div>
      {/* Skill editor */}
      {editingSkillId ? (
        <SkillEditor skillId={editingSkillId} />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-sidebar">
          <p className="text-muted-foreground text-sm">Select a skill to edit</p>
        </div>
      )}
    </div>
  );
}

function SettingsMemoryPage() {
  const { searchQuery, setSearchQuery, setIsLoading } = useMemoryStore();
  const { setSettingsPage } = useUIStore();
  const [isNewMemoryDialogOpen, setIsNewMemoryDialogOpen] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    listMemories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(
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

  return (
    <div className="flex flex-1 min-w-0">
      {/* Memory sidebar */}
      <div className="w-64 border-r border-border flex flex-col bg-sidebar">
        <div className="flex items-center justify-between h-12 px-3 border-b border-border">
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSettingsPage(null)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h2 className="text-sm font-medium">Memory</h2>
        </div>
        <div className="px-2 space-y-1 w-64">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
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
        <ScrollArea className="flex-1">
          <MemoryList />
        </ScrollArea>
        <NewMemoryDialog
          isOpen={isNewMemoryDialogOpen}
          onClose={() => setIsNewMemoryDialogOpen(false)}
        />
      </div>
      {/* Memory detail */}
      <MemoryDetail />
    </div>
  );
}

export function AppLayout() {
  const settingsPage = useUIStore((s) => s.settingsPage);

  // Always active — routes memory responses to the store
  useMemoryResponses();

  return (
    <div className="flex h-screen bg-sidebar overflow-hidden">
      <LeftSidebar />
      {settingsPage === "skills" ? (
        <SettingsSkillsPage />
      ) : settingsPage === "memory" ? (
        <SettingsMemoryPage />
      ) : (
        <>
          <MainPanel />
          <ArtifactPanel />
          <RightSidebar />
        </>
      )}
    </div>
  );
}
