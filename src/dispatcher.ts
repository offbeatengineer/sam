import type { ChatChannel } from "./channels/chat-channel.js";
import type { SessionRegistry } from "./session-registry.js";
import type { InboundMessage, OutboundMessage } from "./types.js";
import { sessionKeyToString } from "./types.js";

export class Dispatcher {
  private channels = new Map<string, ChatChannel>();
  private subscriptions = new Set<string>();

  constructor(private registry: SessionRegistry) {}

  addChannel(channel: ChatChannel): void {
    this.channels.set(channel.id, channel);
    channel.onMessage((msg) => this.handleInbound(msg));
  }

  async shutdown(): Promise<void> {
    console.log("Shutting down...");
    for (const [, channel] of this.channels) {
      await channel.stop();
    }
    await this.registry.disposeAll();
    console.log("Shutdown complete");
    process.exit(0);
  }

  private async handleInbound(message: InboundMessage): Promise<void> {
    const { sessionKey, text } = message;
    const channel = this.channels.get(sessionKey.channelId);
    if (!channel) {
      console.error(`No channel registered for ${sessionKey.channelId}`);
      return;
    }

    try {
      const session = await this.registry.getOrCreate(sessionKey);
      this.ensureSubscription(sessionKey, session, channel);
      await session.prompt(text, { streamingBehavior: "followUp" } as any);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      console.error(`Error handling message: ${errorText}`);
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
            console.error(`Failed to send response: ${err}`);
          });
        }
      }
    });

    this.subscriptions.add(id);
  }
}
