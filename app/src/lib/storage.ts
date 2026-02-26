import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  remove,
  readDir,
} from "@tauri-apps/plugin-fs";
import * as path from "@tauri-apps/api/path";
import type { Message, ToolStatus, ContentBlock } from "@/types/chat";
import type { Task, Artifact } from "@/types/task";

// Note: SessionData and session persistence removed - sidecar handles session management

interface PersistedTask {
  id: string;
  title: string;
  workingDirectory?: string;
  createdAt: string; // ISO string for JSON serialization
  updatedAt: string;
}

const APP_DIR = ".sam";
const TASKS_DIR = `${APP_DIR}/tasks`;
const TASKS_INDEX = `${TASKS_DIR}/index.json`;
const SETTINGS_FILE = `${APP_DIR}/settings.json`;

// ============ App Settings ============

export interface AppSettings {
}

async function ensureAppDir(): Promise<void> {
  if (!(await exists(APP_DIR, { baseDir: BaseDirectory.Home }))) {
    await mkdir(APP_DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (!(await exists(SETTINGS_FILE, { baseDir: BaseDirectory.Home }))) {
    return {};
  }
  try {
    const content = await readTextFile(SETTINGS_FILE, {
      baseDir: BaseDirectory.Home,
    });
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureAppDir();
  await writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), {
    baseDir: BaseDirectory.Home,
  });
}

// ============ Directory Helpers ============

async function ensureTasksDir(): Promise<void> {
  if (!(await exists(TASKS_DIR, { baseDir: BaseDirectory.Home }))) {
    await mkdir(TASKS_DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

async function ensureTaskDir(taskId: string): Promise<void> {
  const dirPath = `${TASKS_DIR}/${taskId}`;
  if (!(await exists(dirPath, { baseDir: BaseDirectory.Home }))) {
    await mkdir(dirPath, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

// ============ Task Persistence ============

export async function saveTasks(tasks: Task[]): Promise<void> {
  await ensureTasksDir();
  const persisted: PersistedTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    workingDirectory: t.workingDirectory,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
  await writeTextFile(TASKS_INDEX, JSON.stringify(persisted, null, 2), {
    baseDir: BaseDirectory.Home,
  });
}

export async function loadTasks(): Promise<Task[]> {
  if (!(await exists(TASKS_INDEX, { baseDir: BaseDirectory.Home }))) {
    return [];
  }
  try {
    const content = await readTextFile(TASKS_INDEX, {
      baseDir: BaseDirectory.Home,
    });
    const persisted: PersistedTask[] = JSON.parse(content);
    return persisted.map((p) => ({
      id: p.id,
      title: p.title,
      workingDirectory: p.workingDirectory,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    }));
  } catch {
    return [];
  }
}

// Note: Session persistence (saveSession, loadSession) removed - sidecar handles session management

// ============ Conversation Persistence ============

interface PersistedToolExecution {
  id: string;
  name: string;
  status: ToolStatus;
  expanded: boolean;
  details?: string;
  input?: Record<string, unknown>;
  output?: string;
}

interface PersistedThinkingData {
  content: string;
  isComplete: boolean;
}

interface PersistedContentBlock {
  type: "text" | "thinking";
  content: string;
  isComplete?: boolean; // only for thinking blocks
}

interface PersistedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO string
  toolExecutions?: PersistedToolExecution[];
  thinking?: PersistedThinkingData;
  contentBlocks?: PersistedContentBlock[];
}

/**
 * Conversation format version 2: includes artifacts
 */
interface PersistedConversationV2 {
  version: 2;
  messages: PersistedMessage[];
  artifacts: Artifact[];
}

/**
 * Conversation format version 3: includes contentBlocks for interleaved thinking/text
 */
interface PersistedConversationV3 {
  version: 3;
  messages: PersistedMessage[];
  artifacts: Artifact[];
}


/**
 * Result of loading a conversation - includes both messages and artifacts
 */
export interface LoadedConversation {
  messages: Message[];
  artifacts: Artifact[];
}

function getConversationPath(taskId: string): string {
  return `${TASKS_DIR}/${taskId}/conversation.json`;
}

export async function saveConversation(
  taskId: string,
  messages: Message[],
  artifacts: Artifact[] = []
): Promise<void> {
  await ensureTaskDir(taskId);
  const persistedMessages: PersistedMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp.toISOString(),
    toolExecutions: m.toolExecutions,
    thinking: m.thinking,
    contentBlocks: m.contentBlocks?.map((block) => ({
      type: block.type,
      content: block.content,
      isComplete: block.type === "thinking" ? block.isComplete : undefined,
    })),
  }));
  const persisted: PersistedConversationV3 = {
    version: 3,
    messages: persistedMessages,
    artifacts,
  };
  await writeTextFile(
    getConversationPath(taskId),
    JSON.stringify(persisted, null, 2),
    {
      baseDir: BaseDirectory.Home,
    }
  );
}

/**
 * Convert legacy thinking + content to contentBlocks format
 */
function convertToContentBlocks(
  thinking?: PersistedThinkingData,
  content?: string
): ContentBlock[] | undefined {
  // If no thinking, don't create blocks (old format will render content directly)
  if (!thinking) return undefined;

  const blocks: ContentBlock[] = [];

  // Add thinking block first
  if (thinking.content) {
    blocks.push({
      type: "thinking",
      content: thinking.content,
      isComplete: thinking.isComplete,
    });
  }

  // Then add text block
  if (content) {
    blocks.push({
      type: "text",
      content,
    });
  }

  return blocks.length > 0 ? blocks : undefined;
}

export async function loadConversation(taskId: string): Promise<LoadedConversation> {
  const convPath = getConversationPath(taskId);
  if (!(await exists(convPath, { baseDir: BaseDirectory.Home }))) {
    return { messages: [], artifacts: [] };
  }
  try {
    const content = await readTextFile(convPath, { baseDir: BaseDirectory.Home });
    const data = JSON.parse(content);

    // Handle version 3 format (with contentBlocks)
    if (data.version === 3) {
      const persisted = data as PersistedConversationV3;
      const messages: Message[] = persisted.messages.map((p) => ({
        id: p.id,
        role: p.role,
        content: p.content,
        timestamp: new Date(p.timestamp),
        toolExecutions: p.toolExecutions,
        thinking: p.thinking,
        contentBlocks: p.contentBlocks?.map((block) => {
          if (block.type === "thinking") {
            return { type: "thinking" as const, content: block.content, isComplete: block.isComplete ?? true };
          }
          return { type: "text" as const, content: block.content };
        }),
      }));
      return { messages, artifacts: persisted.artifacts };
    }

    // Handle version 2 format (with artifacts, but no contentBlocks)
    if (data.version === 2) {
      const persisted = data as PersistedConversationV2;
      const messages: Message[] = persisted.messages.map((p) => ({
        id: p.id,
        role: p.role,
        content: p.content,
        timestamp: new Date(p.timestamp),
        toolExecutions: p.toolExecutions,
        thinking: p.thinking,
        // Convert legacy thinking + content to contentBlocks for assistant messages
        contentBlocks: p.role === "assistant" ? convertToContentBlocks(p.thinking, p.content) : undefined,
      }));
      return { messages, artifacts: persisted.artifacts };
    }

    // Handle old format (array of messages)
    if (Array.isArray(data)) {
      const persisted: PersistedMessage[] = data;
      const messages: Message[] = persisted.map((p) => ({
        id: p.id,
        role: p.role,
        content: p.content,
        timestamp: new Date(p.timestamp),
        toolExecutions: p.toolExecutions,
        thinking: p.thinking,
        // Convert legacy thinking + content to contentBlocks for assistant messages
        contentBlocks: p.role === "assistant" ? convertToContentBlocks(p.thinking, p.content) : undefined,
      }));
      // Extract artifacts from messages for old format
      const artifacts = extractArtifactsFromMessages(messages);
      return { messages, artifacts };
    }

    return { messages: [], artifacts: [] };
  } catch {
    return { messages: [], artifacts: [] };
  }
}

// ============ Task Folder Deletion ============

export async function deleteTaskFolder(taskId: string): Promise<void> {
  const dirPath = `${TASKS_DIR}/${taskId}`;
  if (await exists(dirPath, { baseDir: BaseDirectory.Home })) {
    await remove(dirPath, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

// ============ Artifact Helpers ============

const FILE_CREATING_TOOLS = ["Write", "Edit", "NotebookEdit"];

function getArtifactType(filePath: string): Artifact["type"] {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext || "")) {
    return "image";
  }
  return "file";
}

/**
 * Extract artifacts from messages by looking at successful file-creating tool executions
 */
export function extractArtifactsFromMessages(messages: Message[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    for (const tool of msg.toolExecutions || []) {
      // Only consider successful file-creating tools
      if (tool.status !== "success") continue;
      if (!FILE_CREATING_TOOLS.includes(tool.name)) continue;

      // Extract file path from tool input
      const filePath = tool.input?.file_path as string;
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        artifacts.push({
          id: tool.id,
          name: filePath.split("/").pop() || filePath,
          path: filePath,
          type: getArtifactType(filePath),
        });
      }
    }
  }
  return artifacts;
}

// ============ Migration ============

async function getTasksDir(): Promise<string> {
  const home = await path.homeDir();
  return await path.join(home, TASKS_DIR);
}

/**
 * Migrate old conversation formats to the latest format.
 * Runs at app startup before loading any conversations.
 *
 * Migration path:
 * - v1 (array of messages) → v3 (with artifacts and contentBlocks)
 * - v2 (with artifacts) → v3 (with contentBlocks)
 */
export async function migrateConversations(
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  try {
    const tasksDir = await getTasksDir();

    // Check if tasks directory exists
    if (!(await exists(TASKS_DIR, { baseDir: BaseDirectory.Home }))) {
      return;
    }

    const entries = await readDir(tasksDir);
    const taskDirs = entries.filter((e) => e.isDirectory);

    for (let i = 0; i < taskDirs.length; i++) {
      onProgress?.(i + 1, taskDirs.length);
      const entry = taskDirs[i];
      if (!entry.name) continue;

      const convPath = `${TASKS_DIR}/${entry.name}/conversation.json`;

      try {
        if (!(await exists(convPath, { baseDir: BaseDirectory.Home }))) {
          continue;
        }

        const content = await readTextFile(convPath, { baseDir: BaseDirectory.Home });
        const data = JSON.parse(content);

        // Skip if already at latest version
        if (data.version === 3) continue;

        let persistedMessages: PersistedMessage[];
        let artifacts: Artifact[];

        // Handle v2 format
        if (data.version === 2) {
          persistedMessages = data.messages;
          artifacts = data.artifacts;
        }
        // Handle v1 format (array of messages)
        else if (Array.isArray(data)) {
          persistedMessages = data;
          const messages = persistedMessages.map((p) => ({
            id: p.id,
            role: p.role as "user" | "assistant" | "system",
            content: p.content,
            timestamp: new Date(p.timestamp),
            toolExecutions: p.toolExecutions,
          }));
          artifacts = extractArtifactsFromMessages(messages);
        } else {
          continue;
        }

        // Convert thinking + content to contentBlocks for assistant messages
        const migratedMessages: PersistedMessage[] = persistedMessages.map((p) => {
          if (p.role === "assistant" && p.thinking) {
            const blocks: PersistedContentBlock[] = [];
            if (p.thinking.content) {
              blocks.push({
                type: "thinking",
                content: p.thinking.content,
                isComplete: p.thinking.isComplete,
              });
            }
            if (p.content) {
              blocks.push({
                type: "text",
                content: p.content,
              });
            }
            return { ...p, contentBlocks: blocks.length > 0 ? blocks : undefined };
          }
          return p;
        });

        const newFormat: PersistedConversationV3 = {
          version: 3,
          messages: migratedMessages,
          artifacts,
        };

        await writeTextFile(convPath, JSON.stringify(newFormat, null, 2), {
          baseDir: BaseDirectory.Home,
        });
      } catch {
        // Skip individual file errors, continue with migration
        console.warn(`Failed to migrate conversation for task ${entry.name}`);
      }
    }
  } catch (err) {
    console.error("Migration failed:", err);
    // Don't throw - migration errors shouldn't block app startup
  }
}
