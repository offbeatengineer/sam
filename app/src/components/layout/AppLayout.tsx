import { LeftSidebar } from "./LeftSidebar";
import { MainPanel } from "./MainPanel";
import { ArtifactPanel } from "./ArtifactPanel";
import { RightSidebar } from "./RightSidebar";
import { SkillEditor } from "@/components/skill/SkillEditor";
import { MemoryDetail } from "@/components/memory/MemoryDetail";
import { useUIStore } from "@/stores/uiStore";
import { useMemoryResponses } from "@/hooks/useMemoryResponses";

export function AppLayout() {
  const editingSkillId = useUIStore((s) => s.editingSkillId);
  const leftSidebarTab = useUIStore((s) => s.leftSidebarTab);

  // Always active — routes memory responses to the store
  useMemoryResponses();

  return (
    <div className="flex h-screen bg-sidebar overflow-hidden">
      <LeftSidebar />
      {editingSkillId ? (
        <SkillEditor skillId={editingSkillId} />
      ) : leftSidebarTab === "memory" ? (
        <MemoryDetail />
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
