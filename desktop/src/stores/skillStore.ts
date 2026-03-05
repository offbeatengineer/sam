import { create } from "zustand";
import {
  loadAllSkills,
  loadSkillContent,
  saveSkillContent,
  createSkillFolder,
  deleteSkillFolder,
  renameSkillFolder,
  generateSkillId,
} from "@/lib/skillStorage";
import { useUIStore } from "@/stores/uiStore";
import type { Skill, SkillContent } from "@/types/skill";

interface SkillStore {
  skills: Skill[];
  isLoaded: boolean;
  currentSkillContent: SkillContent | null;

  loadSkills: () => Promise<void>;
  createSkill: (name: string, description: string) => Promise<Skill>;
  deleteSkill: (id: string) => Promise<void>;
  loadSkillContent: (id: string) => Promise<SkillContent | null>;
  saveSkillContent: (id: string, content: SkillContent) => Promise<void>;
  updateSkillInList: (id: string, updates: Partial<Skill>) => void;
}

export const useSkillStore = create<SkillStore>()((set, get) => ({
  skills: [],
  isLoaded: false,
  currentSkillContent: null,

  loadSkills: async () => {
    const skills = await loadAllSkills();
    set({ skills, isLoaded: true });
  },

  createSkill: async (name: string, description: string) => {
    const id = generateSkillId(name);
    const skill = await createSkillFolder(id, name, description);

    set((state) => ({
      skills: [...state.skills, skill].sort((a, b) => {
        if (a.isSystem !== b.isSystem) {
          return a.isSystem ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }),
    }));

    return skill;
  },

  deleteSkill: async (id: string) => {
    await deleteSkillFolder(id);
    set((state) => ({
      skills: state.skills.filter((s) => s.id !== id),
    }));
  },

  loadSkillContent: async (id: string) => {
    const content = await loadSkillContent(id);
    set({ currentSkillContent: content });
    return content;
  },

  saveSkillContent: async (id: string, content: SkillContent) => {
    // Check if name changed and rename folder if needed
    const skill = get().skills.find((s) => s.id === id);
    const nameChanged = skill && content.frontmatter.name !== skill.name;

    let currentId = id;
    if (nameChanged && !skill.isSystem) {
      const result = await renameSkillFolder(id, content.frontmatter.name);
      if (result) {
        currentId = result.newId;
        // Update skill in list with new id and path
        set((state) => ({
          skills: state.skills.map((s) =>
            s.id === id ? { ...s, id: result.newId, path: result.newPath } : s
          ),
        }));
        // Update editingSkillId to the new id
        useUIStore.getState().setEditingSkillId(result.newId);
      }
    }

    await saveSkillContent(currentId, content);
    set({ currentSkillContent: content });

    // Also update the skill in the list with new name/description
    get().updateSkillInList(currentId, {
      name: content.frontmatter.name,
      description: content.frontmatter.description,
    });
  },

  updateSkillInList: (id: string, updates: Partial<Skill>) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === id ? { ...skill, ...updates } : skill
      ),
    }));
  },
}));
