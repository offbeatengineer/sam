#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Dispatcher } from "./dispatcher.js";
import { DiscordChannel } from "./channels/discord-channel.js";
import { PulseChannel } from "./channels/pulse-channel.js";
import { AppChannel } from "./channels/app-channel.js";
import { CliTranscriber } from "./transcriber.js";
import { MemoryStore } from "./memory/store.js";
import { ArtifactsServer } from "./artifacts-server.js";
import { SAM_DIR } from "./config.js";
import { resolve } from "node:path";

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

  // Eagerly download memory dependencies so they're ready before first use
  if (config.memory?.enabled) {
    MemoryStore.getInstance(config.memory).catch((err) => {
      console.error("[memory] Failed to pre-initialize memory store:", err);
    });
  }

  const registry = new SessionRegistry(config);
  const dispatcher = new Dispatcher(registry);

  let discord: DiscordChannel | undefined;
  let appChannel: AppChannel | undefined;
  let artifactsServer: ArtifactsServer | undefined;

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
      memoryConfig: config.memory,
      sessionsDir: config.sessions,
    });
    await appChannel.start();
  }

  // Start artifacts server if configured
  if (config.artifacts?.enabled) {
    artifactsServer = new ArtifactsServer({
      port: config.artifacts.port,
      host: config.artifacts.host ?? "127.0.0.1",
      rootDir: resolve(SAM_DIR, "artifacts"),
      onChange: (event, path) => {
        appChannel?.broadcastArtifactsChanged(event, path);
      },
    });
    await artifactsServer.start();
  }

  console.log("Sam is running.");

  const shutdown = async () => {
    console.log("Shutting down...");
    if (artifactsServer) await artifactsServer.stop();
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
