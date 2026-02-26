import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import type { ChatChannel, MessageHandler } from "./chat-channel.js";
import type { InboundMessage, OutboundMessage } from "../types.js";
import { chunkText } from "../text-chunker.js";

export interface DiscordChannelOptions {
  token: string;
  allowedChannelIds?: string[];
}

export class DiscordChannel implements ChatChannel {
  readonly id = "discord";

  private client: Client;
  private token: string;
  private allowedChannelIds?: Set<string>;
  private handlers: MessageHandler[] = [];

  constructor(options: DiscordChannelOptions) {
    this.token = options.token;
    this.allowedChannelIds = options.allowedChannelIds
      ? new Set(options.allowedChannelIds)
      : undefined;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.client.on(Events.MessageCreate, (msg) => this.handleMessage(msg));
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
    console.log(`Discord channel started as ${this.client.user?.tag}`);
  }

  async stop(): Promise<void> {
    this.client.destroy();
    console.log("Discord channel stopped");
  }

  async send(message: OutboundMessage): Promise<void> {
    const channel = await this.client.channels.fetch(message.sessionKey.conversationId);
    if (!channel || !channel.isTextBased() || channel.isVoiceBased()) {
      console.error(`Cannot send to channel ${message.sessionKey.conversationId}`);
      return;
    }

    const chunks = chunkText(message.text);
    for (const chunk of chunks) {
      await (channel as any).send(chunk);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async startTyping(conversationId: string): Promise<void> {
    const channel = await this.client.channels.fetch(conversationId);
    if (!channel || !channel.isTextBased() || channel.isVoiceBased()) {
      return;
    }
    await (channel as any).sendTyping();
  }

  private handleMessage(msg: Message): void {
    // Ignore bots
    if (msg.author.bot) return;

    const isDM = !msg.guild;
    const isMentioned = msg.mentions.has(this.client.user!);

    // In guilds: require bot mention. In DMs: always respond.
    if (!isDM && !isMentioned) return;

    // Check allowed channels (only for guild messages)
    if (!isDM && this.allowedChannelIds && !this.allowedChannelIds.has(msg.channelId)) {
      return;
    }

    // Strip bot mention from text
    let text = msg.content;
    if (this.client.user) {
      text = text.replace(new RegExp(`<@!?${this.client.user.id}>`, "g"), "").trim();
    }

    if (!text) return;

    const inbound: InboundMessage = {
      sessionKey: {
        channelId: this.id,
        conversationId: msg.channelId,
      },
      text,
      authorId: msg.author.id,
      authorName: msg.author.displayName ?? msg.author.username,
      metadata: {
        type: "user",
        channel: this.id,
        author: msg.author.displayName ?? msg.author.username,
        timestamp: msg.createdAt.toISOString(),
      },
    };

    for (const handler of this.handlers) {
      handler(inbound);
    }
  }
}
