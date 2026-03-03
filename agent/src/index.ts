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
    app: config.app ? { ...config.app, apiKey: config.app.apiKey ? "***" : undefined } : undefined,
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

  // Create transcriber once, shared by all channels
  const transcriber = config.transcription?.modelPath
    ? new CliTranscriber(config.transcription.modelPath)
    : undefined;

  let discord: DiscordChannel | undefined;
  let appChannel: AppChannel | undefined;
  let artifactsServer: ArtifactsServer | undefined;

  // Start Discord channel if configured
  if (config.discord) {
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

  // Start artifacts server if configured
  if (config.artifacts?.enabled) {
    const artifactsHost = config.artifacts.host ?? config.app?.host ?? "127.0.0.1";
    artifactsServer = new ArtifactsServer({
      port: config.artifacts.port ?? config.app?.port ?? 9222,
      host: artifactsHost,
      rootDir: resolve(SAM_DIR, "artifacts"),
      onChange: (event, path) => {
        appChannel?.broadcastArtifactsChanged(event, path);
      },
    });
  }

  // Start App channel if configured
  if (config.app?.enabled) {
    const appHost = config.app.host ?? "127.0.0.1";

    // In attached mode, artifacts shares the app channel's HTTP server
    if (artifactsServer) {
      artifactsServer.startAttached(`ws://${appHost}:${config.app.port}`);
    }

    appChannel = new AppChannel({
      port: config.app.port,
      host: config.app.host,
      apiKey: config.app.apiKey,
      registry,
      memoryConfig: config.memory,
      sessionsDir: config.sessions,
      skillsDir: config.skills,
      artifactsServer,
      transcriber,
    });
    await appChannel.start();
  } else if (artifactsServer) {
    // Standalone mode — artifacts runs its own HTTP server
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
