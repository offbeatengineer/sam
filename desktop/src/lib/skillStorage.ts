import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  remove,
  readDir,
  rename,
} from "@tauri-apps/plugin-fs";
import * as path from "@tauri-apps/api/path";
import type { Skill, SkillContent, SkillMetadata } from "@/types/skill";

const APP_DIR = ".sam";
const SKILLS_DIR = `${APP_DIR}/skills`;

// ============ Directory Helpers ============

async function ensureSkillsDir(): Promise<void> {
  if (!(await exists(SKILLS_DIR, { baseDir: BaseDirectory.Home }))) {
    await mkdir(SKILLS_DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

async function getSkillsPath(): Promise<string> {
  const home = await path.homeDir();
  return await path.join(home, SKILLS_DIR);
}

// ============ YAML Frontmatter Parsing ============

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  // Simple YAML parser for our specific structure
  const frontmatter: Record<string, unknown> = {};
  let currentKey = "";
  let inMetadata = false;
  const metadata: Record<string, string> = {};

  for (const line of yamlContent.split("\n")) {
    if (line.startsWith("metadata:")) {
      inMetadata = true;
      continue;
    }

    if (inMetadata) {
      const metaMatch = line.match(/^\s{2}(\w+):\s*"?([^"]*)"?$/);
      if (metaMatch) {
        metadata[metaMatch[1]] = metaMatch[2];
      } else if (!line.startsWith("  ")) {
        inMetadata = false;
      }
    }

    if (!inMetadata) {
      const keyMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyMatch) {
        currentKey = keyMatch[1];
        frontmatter[currentKey] = keyMatch[2];
      }
    }
  }

  if (Object.keys(metadata).length > 0) {
    frontmatter.metadata = metadata;
  }

  return { frontmatter, body };
}

function serializeFrontmatter(skillContent: SkillContent): string {
  const { frontmatter, body } = skillContent;
  const lines: string[] = ["---"];

  lines.push(`name: ${frontmatter.name}`);
  lines.push(`description: ${frontmatter.description}`);
  lines.push("metadata:");
  lines.push(`  author: ${frontmatter.metadata.author}`);
  lines.push(`  version: "${frontmatter.metadata.version}"`);
  lines.push("---");
  lines.push(body);

  return lines.join("\n");
}

// ============ Skill CRUD Operations ============

export async function loadAllSkills(): Promise<Skill[]> {
  await ensureSkillsDir();

  const skillsPath = await getSkillsPath();
  const skills: Skill[] = [];

  try {
    // Use absolute path for readDir since BaseDirectory.Home has permission issues
    const entries = await readDir(skillsPath);

    for (const entry of entries) {
      if (entry.isDirectory && entry.name) {
        const skillMdPath = `${SKILLS_DIR}/${entry.name}/SKILL.md`;

        if (await exists(skillMdPath, { baseDir: BaseDirectory.Home })) {
          try {
            const content = await readTextFile(skillMdPath, {
              baseDir: BaseDirectory.Home,
            });
            const { frontmatter } = parseFrontmatter(content);

            const metadata: SkillMetadata = {
              author: (frontmatter.metadata as Record<string, string>)?.author || "unknown",
              version: (frontmatter.metadata as Record<string, string>)?.version || "1.0",
            };

            skills.push({
              id: entry.name,
              name: (frontmatter.name as string) || entry.name,
              description: (frontmatter.description as string) || "",
              metadata,
              path: await path.join(skillsPath, entry.name),
              isSystem: metadata.author === "sam",
            });
          } catch (err) {
            console.error(`Failed to load skill ${entry.name}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to read skills directory:", err);
  }

  // Sort: user skills first, then system skills, alphabetically within each group
  return skills.sort((a, b) => {
    if (a.isSystem !== b.isSystem) {
      return a.isSystem ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function loadSkillContent(skillId: string): Promise<SkillContent | null> {
  const skillMdPath = `${SKILLS_DIR}/${skillId}/SKILL.md`;

  if (!(await exists(skillMdPath, { baseDir: BaseDirectory.Home }))) {
    return null;
  }

  try {
    const content = await readTextFile(skillMdPath, {
      baseDir: BaseDirectory.Home,
    });
    const { frontmatter, body } = parseFrontmatter(content);

    const metadata: SkillMetadata = {
      author: (frontmatter.metadata as Record<string, string>)?.author || "unknown",
      version: (frontmatter.metadata as Record<string, string>)?.version || "1.0",
    };

    return {
      frontmatter: {
        name: (frontmatter.name as string) || skillId,
        description: (frontmatter.description as string) || "",
        metadata,
      },
      body,
    };
  } catch (err) {
    console.error(`Failed to load skill content for ${skillId}:`, err);
    return null;
  }
}

export async function saveSkillContent(skillId: string, content: SkillContent): Promise<void> {
  const skillMdPath = `${SKILLS_DIR}/${skillId}/SKILL.md`;
  const serialized = serializeFrontmatter(content);

  await writeTextFile(skillMdPath, serialized, {
    baseDir: BaseDirectory.Home,
  });
}

export async function createSkillFolder(
  skillId: string,
  name: string,
  description: string
): Promise<Skill> {
  await ensureSkillsDir();

  const skillDirPath = `${SKILLS_DIR}/${skillId}`;

  if (await exists(skillDirPath, { baseDir: BaseDirectory.Home })) {
    throw new Error(`Skill folder already exists: ${skillId}`);
  }

  await mkdir(skillDirPath, { baseDir: BaseDirectory.Home, recursive: true });

  const content: SkillContent = {
    frontmatter: {
      name,
      description,
      metadata: {
        author: "user",
        version: "1.0",
      },
    },
    body: `\n# ${name}\n\n${description}\n\n## Instructions\n\nAdd your skill instructions here.\n`,
  };

  await saveSkillContent(skillId, content);

  const skillsPath = await getSkillsPath();

  return {
    id: skillId,
    name,
    description,
    metadata: content.frontmatter.metadata,
    path: await path.join(skillsPath, skillId),
    isSystem: false,
  };
}

export async function deleteSkillFolder(skillId: string): Promise<void> {
  const skillDirPath = `${SKILLS_DIR}/${skillId}`;

  if (await exists(skillDirPath, { baseDir: BaseDirectory.Home })) {
    await remove(skillDirPath, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

export async function renameSkillFolder(
  oldId: string,
  newName: string
): Promise<{ newId: string; newPath: string } | null> {
  const newId = generateSkillId(newName);
  if (newId === oldId) return null;

  const oldDirPath = `${SKILLS_DIR}/${oldId}`;
  const newDirPath = `${SKILLS_DIR}/${newId}`;

  if (await exists(newDirPath, { baseDir: BaseDirectory.Home })) {
    throw new Error(`Skill folder already exists: ${newId}`);
  }

  await rename(oldDirPath, newDirPath, {
    oldPathBaseDir: BaseDirectory.Home,
    newPathBaseDir: BaseDirectory.Home,
  });

  const skillsPath = await getSkillsPath();
  return { newId, newPath: await path.join(skillsPath, newId) };
}

// Generate a valid folder name from skill name
export function generateSkillId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}
