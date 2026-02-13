import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface SamConfig {
  discord: { token: string; allowedChannelIds?: string[] };
  model: { provider: string; modelId: string; thinkingLevel: string; apiKey?: string };
  workspace: { dir: string; sessionDir: string };
}

interface YamlConfig {
  discord?: { allowedChannelIds?: string[] };
  workspace?: { dir?: string; sessionDir?: string };
}

export function loadConfig(): SamConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  if (!discordToken) {
    throw new Error("DISCORD_TOKEN environment variable is required");
  }

  let yaml: YamlConfig = {};
  const yamlPath = resolve("config.yaml");
  if (existsSync(yamlPath)) {
    yaml = parseYaml(readFileSync(yamlPath, "utf-8")) ?? {};
  }

  const workspaceDir = yaml.workspace?.dir ?? process.cwd();

  return {
    discord: {
      token: discordToken,
      allowedChannelIds: yaml.discord?.allowedChannelIds,
    },
    model: {
      provider: process.env.MODEL_PROVIDER ?? "anthropic",
      modelId: process.env.MODEL_ID ?? "claude-sonnet-4-20250514",
      thinkingLevel: process.env.THINKING_LEVEL ?? "off",
      apiKey: process.env.MODEL_API_KEY,
    },
    workspace: {
      dir: workspaceDir,
      sessionDir: yaml.workspace?.sessionDir ?? resolve(workspaceDir, ".sam", "sessions"),
    },
  };
}
