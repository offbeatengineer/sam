import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  createCodingTools,
  createGrepTool,
  createFindTool,
  createLsTool,
  loadSkillsFromDir,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { getSystemPrompt } from "./system-prompt.js";
import type { SamConfig } from "./config.js";
import { createWebSearchTool } from "./tools/web-search.js";
import { createWebFetchTool } from "./tools/web-fetch.js";
import type { SessionKey } from "./types.js";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = resolve(__dirname, "..", "skills");

export type { AgentSession } from "@mariozechner/pi-coding-agent";

function createResourceLoader(cwd: string, systemPromptPath: string, skillsDir: string): ResourceLoader {
  const systemPrompt = getSystemPrompt(cwd, systemPromptPath);
  const runtime = createExtensionRuntime();

  return {
    getExtensions: () => ({ extensions: [], errors: [], diagnostics: [], runtime }),
    getSkills: () => {
      const bundled = loadSkillsFromDir({ dir: BUNDLED_SKILLS_DIR, source: "bundled" });
      const user = loadSkillsFromDir({ dir: skillsDir, source: "user" });
      // User skills override bundled skills with the same name
      const merged = new Map(bundled.skills.map((s) => [s.name, s]));
      for (const s of user.skills) merged.set(s.name, s);
      return {
        skills: [...merged.values()],
        diagnostics: [...bundled.diagnostics, ...user.diagnostics],
      };
    },
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };
}

export async function createSession(config: SamConfig, key: SessionKey) {
  const cwd = config.workspace;
  const sessionDir = resolve(config.sessions, key.channelId, key.conversationId);
  mkdirSync(sessionDir, { recursive: true });

  const authStorage = new AuthStorage();
  if (config.model.apiKey) {
    authStorage.setRuntimeApiKey(config.model.provider, config.model.apiKey);
  }

  const modelRegistry = new ModelRegistry(authStorage);
  const model = getModel(config.model.provider as any, config.model.id as any);

  const tools = [
    ...createCodingTools(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];

  const customTools = [
    createWebSearchTool(config.tools?.webSearch?.apiKey),
    createWebFetchTool(),
  ];

  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 3 },
  });

  const resourceLoader = createResourceLoader(cwd, config.prompts.system, config.skills);

  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: config.model.thinking as any,
    tools,
    customTools,
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  return session;
}
