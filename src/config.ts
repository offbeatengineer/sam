import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Sam home directory
// ---------------------------------------------------------------------------

export const SAM_DIR = resolve(homedir(), ".sam");

// ---------------------------------------------------------------------------
// Unified config — mirrors config.yaml 1:1
// ---------------------------------------------------------------------------

export interface SamConfig {
  discord: {
    token: string;
    allowedChannelIds?: string[];
  };
  model: {
    provider: string;
    modelId: string;
    thinkingLevel: string;
    apiKey?: string;
  };
  workspace: string;
  sessions: string;
  prompts: {
    system: string;
    pulse: string;
  };
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
  modelId: claude-sonnet-4-20250514
  thinkingLevel: "off"

# workspace: ~/.sam/workspace
# sessions: ~/.sam/sessions

# prompts:
#   system: ~/.sam/prompts/system.md
#   pulse: ~/.sam/prompts/pulse.md

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
`;

// Exported so system-prompt.ts can use it as a template variable
export const DEFAULT_SYSTEM_PROMPT = `You are Sam, a helpful general-purpose AI assistant.

## Capabilities
You have access to tools for interacting with the local filesystem and executing commands:
- **File reading**: Read file contents
- **File writing**: Create or overwrite files
- **File editing**: Make targeted edits to existing files
- **Shell execution**: Run shell commands and scripts
- **Search**: Search file contents with grep patterns
- **Find**: Find files by name patterns
- **List**: List directory contents

## Guidelines
- Be concise and direct in your responses.
- Use markdown formatting when it improves readability.
- When using tools, briefly explain what you're doing and why.
- You are running in a chat channel — do not use interactive terminal commands (e.g. vim, less, top). Use non-interactive alternatives instead.
- If a task is ambiguous, ask for clarification before proceeding.
- When executing shell commands, prefer commands that produce bounded output. Avoid commands that stream indefinitely.`;

// ---------------------------------------------------------------------------
// First-run setup — create ~/.sam/ with defaults
// ---------------------------------------------------------------------------

export function ensureSamDir(): void {
  mkdirSync(resolve(SAM_DIR, "sessions"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "prompts"), { recursive: true });
  mkdirSync(resolve(SAM_DIR, "workspace"), { recursive: true });

  const configPath = resolve(SAM_DIR, "config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CONFIG_YAML);
  }

  const systemPath = resolve(SAM_DIR, "prompts", "system.md");
  if (!existsSync(systemPath)) {
    writeFileSync(systemPath, DEFAULT_SYSTEM_PROMPT);
  }

  const pulsePath = resolve(SAM_DIR, "prompts", "pulse.md");
  if (!existsSync(pulsePath)) {
    writeFileSync(pulsePath, "");
  }
}

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

export function loadConfig(): SamConfig {
  ensureSamDir();

  // Read YAML
  const yamlPath = resolve(SAM_DIR, "config.yaml");
  const yaml: Record<string, any> = existsSync(yamlPath)
    ? (parseYaml(readFileSync(yamlPath, "utf-8")) ?? {})
    : {};

  // Env-var overrides for secrets / model settings
  const discordToken = process.env.DISCORD_TOKEN ?? yaml.discord?.token;
  if (!discordToken) {
    throw new Error("DISCORD_TOKEN environment variable (or discord.token in config.yaml) is required");
  }

  return {
    discord: {
      token: discordToken,
      allowedChannelIds: yaml.discord?.allowedChannelIds,
    },
    model: {
      provider: process.env.MODEL_PROVIDER ?? yaml.model?.provider ?? "anthropic",
      modelId: process.env.MODEL_ID ?? yaml.model?.modelId ?? "claude-sonnet-4-20250514",
      thinkingLevel: process.env.THINKING_LEVEL ?? yaml.model?.thinkingLevel ?? "off",
      apiKey: process.env.MODEL_API_KEY ?? yaml.model?.apiKey,
    },
    workspace: yaml.workspace ?? resolve(SAM_DIR, "workspace"),
    sessions: yaml.sessions ?? resolve(SAM_DIR, "sessions"),
    prompts: {
      system: yaml.prompts?.system ?? resolve(SAM_DIR, "prompts", "system.md"),
      pulse: yaml.prompts?.pulse ?? resolve(SAM_DIR, "prompts", "pulse.md"),
    },
    pulse: yaml.pulse?.enabled ? yaml.pulse : undefined,
  };
}
