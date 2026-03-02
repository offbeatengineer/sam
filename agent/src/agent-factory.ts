import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  createCodingTools,
  createGrepTool,
  createFindTool,
  createLsTool,
  createBashTool,
  loadSkillsFromDir,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { getSystemPrompt } from "./system-prompt.js";
import { SAM_DIR, type SamConfig } from "./config.js";
import { createWebSearchTool } from "./tools/web-search.js";
import { createWebFetchTool } from "./tools/web-fetch.js";
import { createMemorySaveTool, createMemoryRecallTool, createMemoryUpdateTool, createMemoryForgetTool } from "./tools/memory.js";
import { createReportArtifactTool } from "./tools/report-artifact.js";
import type { SessionKey } from "./types.js";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = resolve(__dirname, "..", "skills");

// Commands that should be run in tmux to avoid blocking
const LONG_RUNNING_PATTERNS = [
  "npm run dev",
  "npm run start",
  "npm start",
  "vite",
  "webpack",
  "nodemon",
  "python -m http.server",
  "python3 -m http.server",
  "php -S",
  "cargo watch",
  "mix phx.server",
  "rails server",
  "bundle exec rails",
  "go run",
];

function createTmuxSpawnHook(): (context: any) => any {
  return (context) => {
    const command = context.command;
    
    // Check if command matches any long-running pattern
    const isLongRunning = LONG_RUNNING_PATTERNS.some((pattern) => 
      command.includes(pattern)
    );

    // Check if already using tmux
    const alreadyTmux = command.includes("tmux");

    if (isLongRunning && !alreadyTmux) {
      // Generate a unique tmux session name
      const sessionName = `sam-${Date.now()}`;
      const tmuxCommand = `tmux new-session -d -s ${sessionName} '${command}'`;
      
      console.log(`[tmux-hook] Wrapped long-running command: ${command}`);
      console.log(`[tmux-hook] Running as: ${tmuxCommand}`);
      
      return {
        ...context,
        command: tmuxCommand,
      };
    }

    return context;
  };
}

export type { AgentSession } from "@mariozechner/pi-coding-agent";

function createResourceLoader(cwd: string, systemPromptPath: string, agentsPromptPath: string, skillsDir: string): ResourceLoader {
  const systemPrompt = getSystemPrompt(cwd, systemPromptPath);
  const runtime = createExtensionRuntime();

  const agentsFiles = existsSync(agentsPromptPath)
    ? [{ path: agentsPromptPath, content: readFileSync(agentsPromptPath, "utf-8") }]
    : [];

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
    getAgentsFiles: () => ({ agentsFiles }),
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

  const authStorage = new AuthStorage(resolve(SAM_DIR, "auth.json"));
  if (config.model.apiKey) {
    authStorage.setRuntimeApiKey(config.model.provider, config.model.apiKey);
  }

  const modelRegistry = new ModelRegistry(authStorage);
  const model = getModel(config.model.provider as any, config.model.id as any);

  const tools = [
    createBashTool(cwd, { spawnHook: createTmuxSpawnHook() }),
    createCodingTools(cwd).find((t) => t.name === "read")!,
    createCodingTools(cwd).find((t) => t.name === "edit")!,
    createCodingTools(cwd).find((t) => t.name === "write")!,
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];

  const customTools = [
    createWebSearchTool(config.tools?.webSearch?.apiKey),
    createWebFetchTool(),
    createReportArtifactTool(),
  ];

  // Add memory tools if enabled (default: true)
  if (config.memory?.enabled !== false && config.memory) {
    customTools.push(
      createMemorySaveTool(config.memory),
      createMemoryRecallTool(config.memory),
      createMemoryUpdateTool(config.memory),
      createMemoryForgetTool(config.memory),
    );
  }

  const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 3 },
  });

  const resourceLoader = createResourceLoader(cwd, config.prompts.system, config.prompts.agents, config.skills);

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
