import { useEffect } from "react";
import { SkillItem } from "./SkillItem";
import { useSkillStore } from "@/stores/skillStore";

export function SkillList() {
  const { skills, isLoaded, loadSkills } = useSkillStore();

  useEffect(() => {
    if (!isLoaded) {
      loadSkills();
    }
  }, [isLoaded, loadSkills]);

  if (!isLoaded) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No skills yet. Click "New skill" to create one.
      </div>
    );
  }

  const userSkills = skills.filter((s) => !s.isSystem);
  const systemSkills = skills.filter((s) => s.isSystem);

  return (
    <div className="pb-2 w-64">
      {userSkills.map((skill) => (
        <SkillItem key={skill.id} skill={skill} />
      ))}
      {systemSkills.length > 0 && (
        <>
          <div className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            System skills
          </div>
          {systemSkills.map((skill) => (
            <SkillItem key={skill.id} skill={skill} />
          ))}
        </>
      )}
    </div>
  );
}
