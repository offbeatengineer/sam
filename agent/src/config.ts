import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { MemoryConfig } from "./memory/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_PROMPTS_DIR = resolve(__dirname, "..", "prompts");

// ---------------------------------------------------------------------------
// Sam home directory
// ---------------------------------------------------------------------------

export const SAM_DIR = resolve(homedir(), ".sam");

// ---------------------------------------------------------------------------
// Unified config — mirrors config.yaml 1:1
// ---------------------------------------------------------------------------

export interface SamConfig {
  discord?: {
    token: string;
    allowedChannelIds?: string[];
  };
  app?: {
    enabled: boolean;
    port: number;
    host?: string;
    apiKey?: string;
  };
  model: {
    provider: string;
    id: string;
    thinking: string;
    apiKey?: string;
  };
  workspace: string;
  sessions: string;
  skills: string;
  prompts: {
    system: string;
    pulse: string;
    agents: string;
  };
  transcription?: {
    modelPath: string;
  };
  tools?: {
    webSearch?: { apiKey?: string };
  };
  artifacts?: {
    enabled: boolean;
    port?: number;
    host?: string;
  };
  memory?: MemoryConfig;
  pulse?: {
    enabled: boolean;
    every: string;
    delivery: { channel: string; targetChannelId: string };
    activeHours?: { start: string; end: string; timezone: string };
  };
}

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

export function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration format: "${duration}"`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms": return value;
    case "s": return value * 1000;
    case "m": return value * 60_000;
    case "h": return value * 3_600_000;
    case "d": return value * 86_400_000;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

// ---------------------------------------------------------------------------
// Default file contents
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG_YAML = `# Sam configuration — ~/.sam/config.yaml

discord:
  # allowedChannelIds:
  #   - "1234567890123456789"

model:
  provider: anthropic
  id: claude-sonnet-4-20250514
  thinking: "off"

# workspace: ~/.sam/workspace
# sessions: ~/.sam/sessions

# prompts:
#   system: ~/.sam/prompts/SYSTEM.md
#   pulse: ~/.sam/prompts/PULSE.md
#   agents: ~/.sam/prompts/AGENTS.md

# pulse:
#   enabled: true
#   every: "30m"
#   delivery:
#     channel: discord
#     targetChannelId: "1234567890123456789"
#   activeHours:
#     start: "08:00"
#     end: "22:00"
#     timezone: "America/Los_Angeles"

# app:
#   enabled: true
#   port: 9222
#   host: 127.0.0.1
#   apiKey: ""  # or set SAM_APP_API_KEY env var — required for remote access

# artifacts:
#   enabled: true
#   host: 127.0.0.1

# tools:
#   webSearch:
#     apiKey: ""  # or set BRAVE_API_KEY env var

# memory:
#   enabled: true
#   storagePath: ~/.sam/memory
#   modelsPath: ~/.sam/models
#   embeddingModel: mixedbread-ai/mxbai-embed-xsmall-v1
#   embeddingDimensions: 384
`;

// ---------------------------------------------------------------------------
// First-run setup — create ~/.sam/ with defaults
// ---------------------------------------------------------------------------

export function ensureSamDir(): void {
  mkdirSync(resolve(SAM_DIR, "sessions"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "prompts"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "workspace"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "skills"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "memory"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "models"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "artifacts"), { recursive: true });

  const configPath = resolve(SAM_DIR, "config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CONFIG_YAML);
  }

  // Copy bundled prompts to ~/.sam/prompts/ on first run
  for (const name of ["SYSTEM.md", "PULSE.md", "AGENTS.md"]) {
    const dest = resolve(SAM_DIR, "prompts", name);
    if (!existsSync(dest)) {
      const src = resolve(BUNDLED_PROMPTS_DIR, name);
      if (existsSync(src)) {
        copyFileSync(src, dest);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

function expandHome(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p;
}

export function loadConfig(): SamConfig {
  ensureSamDir();

  // Read YAML
  const yamlPath = resolve(SAM_DIR, "config.yaml");
  const yaml: Record<string, any> = existsSync(yamlPath)
    ? (parseYaml(readFileSync(yamlPath, "utf-8")) ?? {})
    : {};

  // Env-var overrides for secrets / model settings
  const discordToken = process.env.DISCORD_TOKEN ?? yaml.discord?.token;

  // App channel config
  const appEnabled = yaml.app?.enabled !== false;
  const appApiKey = process.env.SAM_APP_API_KEY ?? yaml.app?.apiKey;
  const appConfig = appEnabled
    ? { enabled: true as const, port: yaml.app?.port ?? 9222, host: yaml.app?.host, apiKey: appApiKey }
    : undefined;

  // Artifacts server config — defaults to enabled when app channel is enabled.
  // When sharing the app channel port, artifacts.port is omitted.
  const artifactsEnabled = yaml.artifacts?.enabled ?? appEnabled;
  const artifactsConfig = artifactsEnabled
    ? {
        enabled: true as const,
        port: yaml.artifacts?.port as number | undefined,
        host: yaml.artifacts?.host ?? appConfig?.host,
      }
    : undefined;

  // At least one channel must be configured
  if (!discordToken && !appEnabled) {
    throw new Error(
      "At least one channel must be configured: set DISCORD_TOKEN (or discord.token in config.yaml) and/or enable the app channel (app.enabled: true)",
    );
  }

  return {
    discord: discordToken
      ? { token: discordToken, allowedChannelIds: yaml.discord?.allowedChannelIds }
      : undefined,
    app: appConfig,
    artifacts: artifactsConfig,
    model: {
      provider: process.env.MODEL_PROVIDER ?? yaml.model?.provider ?? "anthropic",
      id: process.env.MODEL_ID ?? yaml.model?.id ?? "claude-sonnet-4-20250514",
      thinking: process.env.MODEL_THINKING ?? yaml.model?.thinking ?? "off",
      apiKey: process.env.MODEL_API_KEY ?? yaml.model?.apiKey,
    },
    workspace: expandHome(yaml.workspace ?? resolve(SAM_DIR, "workspace")),
    sessions: expandHome(yaml.sessions ?? resolve(SAM_DIR, "sessions")),
    skills: expandHome(yaml.skills ?? resolve(SAM_DIR, "skills")),
    prompts: {
      system: expandHome(yaml.prompts?.system ?? resolve(SAM_DIR, "prompts", "SYSTEM.md")),
      pulse: expandHome(yaml.prompts?.pulse ?? resolve(SAM_DIR, "prompts", "PULSE.md")),
      agents: expandHome(yaml.prompts?.agents ?? resolve(SAM_DIR, "prompts", "AGENTS.md")),
    },
    transcription: yaml.transcription?.modelPath
      ? { modelPath: expandHome(yaml.transcription.modelPath) }
      : undefined,
    tools: {
      webSearch: {
        apiKey: process.env.BRAVE_API_KEY ?? yaml.tools?.webSearch?.apiKey,
      },
    },
    memory: {
      enabled: yaml.memory?.enabled !== false,
      storagePath: expandHome(yaml.memory?.storagePath ?? resolve(SAM_DIR, "memory")),
      modelsPath: expandHome(yaml.memory?.modelsPath ?? resolve(SAM_DIR, "models")),
      embeddingModel: yaml.memory?.embeddingModel,
      embeddingDimensions: yaml.memory?.embeddingDimensions,
    },
    pulse: yaml.pulse?.enabled ? yaml.pulse : undefined,
  };
}
