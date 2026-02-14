import type { InboundMessage, OutboundMessage } from "../types.js";

export type MessageHandler = (message: InboundMessage) => void;

export interface ChatChannel {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  onMessage(handler: MessageHandler): void;
  startTyping(conversationId: string): Promise<void>;
}
