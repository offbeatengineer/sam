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
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

export type { AgentSession } from "@mariozechner/pi-coding-agent";

function createResourceLoader(cwd: string, systemPromptPath: string, skillsDir: string): ResourceLoader {
  const systemPrompt = getSystemPrompt(cwd, systemPromptPath);
  const runtime = createExtensionRuntime();

  return {
    getExtensions: () => ({ extensions: [], errors: [], diagnostics: [], runtime }),
    getSkills: () => loadSkillsFromDir({ dir: skillsDir, source: "user" }),
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
