#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Dispatcher } from "./dispatcher.js";
import { DiscordChannel } from "./channels/discord-channel.js";
import { PulseChannel } from "./channels/pulse-channel.js";
import { AppChannel } from "./channels/app-channel.js";
import { CliTranscriber } from "./transcriber.js";

async function main() {
  const config = loadConfig();
  console.log("Config:", JSON.stringify({
    model: { ...config.model, apiKey: config.model.apiKey ? "***" : undefined },
    workspace: config.workspace,
    sessions: config.sessions,
    prompts: config.prompts,
    discord: config.discord ? { allowedChannelIds: config.discord.allowedChannelIds } : undefined,
    app: config.app,
    transcription: config.transcription,
    pulse: config.pulse,
  }, null, 2));

  const registry = new SessionRegistry(config);
  const dispatcher = new Dispatcher(registry);

  let discord: DiscordChannel | undefined;
  let appChannel: AppChannel | undefined;

  // Start Discord channel if configured
  if (config.discord) {
    const transcriber = config.transcription?.modelPath
      ? new CliTranscriber(config.transcription.modelPath)
      : undefined;

    discord = new DiscordChannel({
      token: config.discord.token,
      allowedChannelIds: config.discord.allowedChannelIds,
      transcriber,
    });
    dispatcher.addChannel(discord);

    if (config.pulse) {
      const pulseChannel = new PulseChannel(config, discord);
      dispatcher.addChannel(pulseChannel);
      await pulseChannel.start();
    }

    await discord.start();
    console.log("Discord channel started.");
  }

  // Start App channel if configured
  if (config.app?.enabled) {
    appChannel = new AppChannel({
      port: config.app.port,
      host: config.app.host,
      registry,
    });
    await appChannel.start();
  }

  console.log("Sam is running.");

  const shutdown = async () => {
    console.log("Shutting down...");
    if (appChannel) await appChannel.stop();
    await dispatcher.shutdown();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
