export interface ExtractedMessage {
  entryId: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export function extractMessages(entries: any[]): ExtractedMessage[] {
  const results: ExtractedMessage[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    const msg = entry.message;
    if (!msg) continue;

    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;

    let text = "";

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textParts: string[] = [];
      for (const c of msg.content) {
        if (c.type === "text") {
          textParts.push(c.text);
        }
      }
      text = textParts.join("\n");
    }

    if (!text.trim()) continue;

    results.push({
      entryId: entry.id ?? entry.entryId ?? `${entry.timestamp ?? Date.now()}`,
      role,
      text: text.trim(),
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
    });
  }

  return results;
}
