export interface SessionKey {
  channelId: string; // "discord", "google-chat", etc.
  conversationId: string; // channel-specific (Discord channel ID, thread ID, etc.)
}

export interface MessageMetadata {
  type: "user" | "pulse";
  channel: string;
  author: string;
  timestamp: string;
}

export interface InboundMessage {
  sessionKey: SessionKey;
  text: string;
  authorId: string;
  authorName: string;
  metadata: MessageMetadata;
}

export interface OutboundMessage {
  sessionKey: SessionKey;
  text: string;
}

export function sessionKeyToString(key: SessionKey): string {
  return `${key.channelId}:${key.conversationId}`;
}
