import type { ChatChannel } from "./channels/chat-channel.js";
import type { SessionRegistry } from "./session-registry.js";
import type { InboundMessage, OutboundMessage, MessageMetadata } from "./types.js";
import { sessionKeyToString } from "./types.js";
import { logger } from "./logger.js";

function formatMessage(text: string, metadata: MessageMetadata): string {
  return `[Message]
type: ${metadata.type}
channel: ${metadata.channel}
author: ${metadata.author}
timestamp: ${metadata.timestamp}

[Content]
${text}`;
}

export class Dispatcher {
  private channels = new Map<string, ChatChannel>();
  private subscriptions = new Set<string>();

  constructor(private registry: SessionRegistry) {}

  addChannel(channel: ChatChannel): void {
    this.channels.set(channel.id, channel);
    channel.onMessage((msg) => this.handleInbound(msg));
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down...");
    for (const [, channel] of this.channels) {
      await channel.stop();
    }
    await this.registry.disposeAll();
    logger.info("Shutdown complete");
    process.exit(0);
  }

  private async handleInbound(message: InboundMessage): Promise<void> {
    const { sessionKey, text, metadata } = message;
    const channel = this.channels.get(sessionKey.channelId);
    if (!channel) {
      logger.error(`No channel registered for ${sessionKey.channelId}`);
      return;
    }

    // Show typing indicator
    await channel.startTyping(sessionKey.conversationId);

    try {
      const session = await this.registry.getOrCreate(sessionKey);
      this.ensureSubscription(sessionKey, session, channel);
      const formattedMessage = formatMessage(text, metadata);
      await session.prompt(formattedMessage, { streamingBehavior: "followUp" } as any);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      logger.error(`Error handling message: ${errorText}`);
      await channel.send({
        sessionKey,
        text: `Sorry, I encountered an error: ${errorText}`,
      });
    }
  }

  private ensureSubscription(
    sessionKey: InboundMessage["sessionKey"],
    session: any,
    channel: ChatChannel,
  ): void {
    const id = sessionKeyToString(sessionKey);
    if (this.subscriptions.has(id)) return;

    let textBuffer = "";

    session.subscribe((event: any) => {
      if (event.type === "message_update") {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
          textBuffer += assistantEvent.delta;
        }
      } else if (event.type === "message_end") {
        if (textBuffer.length > 0) {
          const text = textBuffer;
          textBuffer = "";
          channel.send({ sessionKey, text }).catch((err) => {
            logger.error(`Failed to send response: ${err}`);
          });
        }
      }
    });

    this.subscriptions.add(id);
  }
}
