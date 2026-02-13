import { loadConfig } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { Dispatcher } from "./dispatcher.js";
import { DiscordChannel } from "./channels/discord-channel.js";

async function main() {
  const config = loadConfig();

  const registry = new SessionRegistry(config);
  const dispatcher = new Dispatcher(registry);

  const discord = new DiscordChannel({
    token: config.discord.token,
    allowedChannelIds: config.discord.allowedChannelIds,
  });
  dispatcher.addChannel(discord);

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
