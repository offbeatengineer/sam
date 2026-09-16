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

/** Framing the dispatcher puts around Discord and pulse messages before they reach the model. */
export function formatMessage(text: string, metadata: MessageMetadata): string {
  return `[Message]
type: ${metadata.type}
channel: ${metadata.channel}
author: ${metadata.author}
timestamp: ${metadata.timestamp}

[Content]
${text}`;
}

/** Inverse of `formatMessage`: the user's own words, for anything that judges what they said. */
export function stripMessageHeader(text: string): string {
  return text.replace(/^\[Message\]\n[\s\S]*?\n\[Content\]\n/, "");
}

export function sessionKeyToString(key: SessionKey): string {
  return `${key.channelId}:${key.conversationId}`;
}
