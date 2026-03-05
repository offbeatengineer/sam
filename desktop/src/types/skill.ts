export interface SkillMetadata {
  author: string;
  version: string;
}

export interface Skill {
  id: string;                    // Folder name
  name: string;                  // From frontmatter
  description: string;           // From frontmatter
  metadata: SkillMetadata;
  path: string;                  // Full folder path
  isSystem: boolean;             // author === "sam"
}

export interface SkillContent {
  frontmatter: {
    name: string;
    description: string;
    metadata: SkillMetadata;
  };
  body: string;                  // Markdown content after frontmatter
}
