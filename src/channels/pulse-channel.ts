import { readFileSync, existsSync } from "node:fs";
import type { SamConfig } from "../config.js";
import { parseDurationMs } from "../config.js";
import type { ChatChannel, MessageHandler } from "./chat-channel.js";
import type { OutboundMessage } from "../types.js";

const PULSE_OK = /PULSE_OK/i;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export class PulseChannel implements ChatChannel {
  readonly id = "pulse";

  private handler: MessageHandler | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private recentAlerts = new Map<string, number>(); // hash → timestamp

  constructor(
    private config: SamConfig,
    private deliveryChannel: ChatChannel,
  ) {}

  async start(): Promise<void> {
    const pulse = this.config.pulse!;
    const intervalMs = parseDurationMs(pulse.every);
    console.log(`Pulse: starting (every ${intervalMs}ms)`);
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("Pulse: stopped");
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async startTyping(_conversationId: string): Promise<void> {
    // No-op: PulseChannel doesn't have real-time conversations
  }

  async send(message: OutboundMessage): Promise<void> {
    const text = message.text.trim();

    // Suppress PULSE_OK responses
    if (PULSE_OK.test(text)) {
      console.log("Pulse: PULSE_OK — all clear");
      return;
    }

    // Dedup: suppress if we sent an identical alert within 24h
    const hash = simpleHash(text);
    const lastSent = this.recentAlerts.get(hash);
    if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
      console.log("Pulse: suppressing duplicate alert");
      return;
    }
    this.recentAlerts.set(hash, Date.now());
    this.pruneAlerts();

    // Forward to delivery channel
    const { delivery } = this.config.pulse!;
    console.log("Pulse: forwarding alert to", delivery.channel);
    await this.deliveryChannel.send({
      sessionKey: {
        channelId: delivery.channel,
        conversationId: delivery.targetChannelId,
      },
      text,
    });
  }

  private tick(): void {
    if (!this.handler) return;

    const pulse = this.config.pulse!;

    // Check active hours
    if (pulse.activeHours && !this.isWithinActiveHours(pulse.activeHours)) {
      console.log("Pulse: outside active hours, skipping");
      return;
    }

    // Check prompt file
    const promptPath = this.config.prompts.pulse;
    if (!existsSync(promptPath)) {
      console.log(`Pulse: ${promptPath} not found, skipping`);
      return;
    }

    const pulseContent = readFileSync(promptPath, "utf-8").trim();
    if (!pulseContent) {
      console.log("Pulse: prompt file is empty, skipping");
      return;
    }

    console.log("Pulse: checking...");

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    this.handler({
      sessionKey: {
        channelId: this.id,
        conversationId: `pulse:${today}`,
      },
      text: pulseContent,
      authorId: "pulse",
      authorName: "Pulse",
    });
  }

  private isWithinActiveHours(hours: { start: string; end: string; timezone: string }): boolean {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: hours.timezone,
    });
    return timeStr >= hours.start && timeStr < hours.end;
  }

  private pruneAlerts(): void {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [hash, ts] of this.recentAlerts) {
      if (ts < cutoff) this.recentAlerts.delete(hash);
    }
  }
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
