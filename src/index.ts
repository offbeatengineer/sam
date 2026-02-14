#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Dispatcher } from "./dispatcher.js";
import { DiscordChannel } from "./channels/discord-channel.js";
import { PulseChannel } from "./channels/pulse-channel.js";

async function main() {
  const config = loadConfig();
  console.log("Config:", JSON.stringify({
    model: { ...config.model, apiKey: config.model.apiKey ? "***" : undefined },
    workspace: config.workspace,
    sessions: config.sessions,
    prompts: config.prompts,
    discord: { allowedChannelIds: config.discord.allowedChannelIds },
    pulse: config.pulse,
  }, null, 2));

  const registry = new SessionRegistry(config);
  const dispatcher = new Dispatcher(registry);

  const discord = new DiscordChannel({
    token: config.discord.token,
    allowedChannelIds: config.discord.allowedChannelIds,
  });
  dispatcher.addChannel(discord);

  if (config.pulse) {
    const pulseChannel = new PulseChannel(config, discord);
    dispatcher.addChannel(pulseChannel);
    await pulseChannel.start();
  }

  await discord.start();
  console.log("Sam is running.");

  const shutdown = () => dispatcher.shutdown();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
