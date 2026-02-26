import { LeftSidebar } from "./LeftSidebar";
import { MainPanel } from "./MainPanel";
import { ArtifactPanel } from "./ArtifactPanel";
import { RightSidebar } from "./RightSidebar";
import { SkillEditor } from "@/components/skill/SkillEditor";
import { useUIStore } from "@/stores/uiStore";

export function AppLayout() {
  const editingSkillId = useUIStore((s) => s.editingSkillId);

  return (
    <div className="flex h-screen bg-sidebar overflow-hidden">
      <LeftSidebar />
      {editingSkillId ? (
        <SkillEditor skillId={editingSkillId} />
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
