#!/usr/bin/env bun
import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Dispatcher } from "./dispatcher.js";
import { DiscordChannel } from "./channels/discord-channel.js";
import { PulseChannel } from "./channels/pulse-channel.js";
import { AppChannel } from "./channels/app-channel.js";
import { VocalTranscriber } from "./transcriber.js";
import { MemoryStore } from "./memory/store.js";
import { SessionSearchStore } from "./session-search/store.js";
import { SessionIndexer } from "./session-search/indexer.js";
import { ArtifactsServer } from "./artifacts-server.js";
import { KitsServer } from "./kits-server.js";
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
    kits: config.kits,
  }, null, 2));

  // Eagerly download memory dependencies so they're ready before first use
  if (config.memory?.enabled) {
    MemoryStore.getInstance(config.memory).catch((err) => {
      console.error("[memory] Failed to pre-initialize memory store:", err);
    });
  }

  // Start background session search indexing
  let sessionIndexer: SessionIndexer | undefined;
  if (config.memory?.enabled) {
    SessionSearchStore.getInstance(config.memory).catch((err) => {
      console.error("[session-search] Failed to pre-initialize session search store:", err);
    });
    sessionIndexer = new SessionIndexer(config.memory, config.sessions);
    sessionIndexer.indexAll().catch((err) => {
      console.error("[session-search] Indexing failed:", err);
    });
  }

  const registry = new SessionRegistry(config);
  const dispatcher = new Dispatcher(registry);

  // Create transcriber once, shared by all channels.
  // Setup (brew install + model download) runs in the background — never blocks startup.
  const transcriber = config.transcription?.enabled
    ? new VocalTranscriber(config.transcription)
    : undefined;
  if (transcriber) {
    transcriber.ensureReady().catch((err) => {
      console.error("[transcription] Background setup failed:", err);
    });
  }

  let discord: DiscordChannel | undefined;
  let appChannel: AppChannel | undefined;
  let artifactsServer: ArtifactsServer | undefined;
  let kitsServer: KitsServer | undefined;

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

  // Start kits server if enabled
  if (config.kits?.enabled !== false && config.app?.enabled) {
    kitsServer = new KitsServer({
      dir: config.kits?.dir ?? resolve(SAM_DIR, "kits"),
    });
    await kitsServer.init();
    registry.setKitsServer(kitsServer);
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
      kitsServer,
      transcriber,
      sessionIndexer,
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
