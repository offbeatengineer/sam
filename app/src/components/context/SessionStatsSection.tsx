import { useMemo } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useSessionStore } from "@/stores/sessionStore";
import type {
  SessionMessageEntry,
  AssistantMessage,
  ToolCall,
} from "@/types/session";

interface SessionStats {
  date: string | null;
  models: string[];
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  totalCost: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function SessionStatsSection() {
  const entries = useSessionStore((state) => state.activeEntries);
  const activeHeader = useSessionStore((state) => state.activeHeader);

  const stats = useMemo<SessionStats>(() => {
    let userMessages = 0;
    let assistantMessages = 0;
    let toolCalls = 0;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let totalCost = 0;
    const models = new Set<string>();

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = (entry as SessionMessageEntry).message;

      if (msg.role === "user") userMessages++;
      if (msg.role === "assistant") {
        assistantMessages++;
        const assistant = msg as AssistantMessage;
        if (assistant.model) {
          models.add(
            assistant.provider
              ? `${assistant.provider}/${assistant.model}`
              : assistant.model
          );
        }
        if (assistant.usage) {
          tokens.input += assistant.usage.input || 0;
          tokens.output += assistant.usage.output || 0;
          tokens.cacheRead += assistant.usage.cacheRead || 0;
          tokens.cacheWrite += assistant.usage.cacheWrite || 0;
          if (assistant.usage.cost) {
            totalCost += assistant.usage.cost.total || 0;
          }
        }
        toolCalls += assistant.content.filter(
          (c): c is ToolCall => c.type === "toolCall"
        ).length;
      }
    }

    return {
      date: activeHeader?.timestamp ?? null,
      models: Array.from(models),
      userMessages,
      assistantMessages,
      toolCalls,
      tokens,
      totalCost,
    };
  }, [entries, activeHeader]);

  const tokenParts: string[] = [];
  if (stats.tokens.input) tokenParts.push(`${formatTokens(stats.tokens.input)} in`);
  if (stats.tokens.output) tokenParts.push(`${formatTokens(stats.tokens.output)} out`);
  if (stats.tokens.cacheRead) tokenParts.push(`${formatTokens(stats.tokens.cacheRead)} cache`);

  const totalMessages = stats.userMessages + stats.assistantMessages;

  return (
    <Collapsible defaultOpen={true}>
      <CollapsibleTrigger className="text-sm font-medium">
        Session Stats
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-1 text-xs">
          {stats.date && (
            <Row label="Date" value={new Date(stats.date).toLocaleDateString()} />
          )}
          {stats.models.length > 0 && (
            <Row label="Model" value={stats.models.join(", ")} />
          )}
          <Row
            label="Messages"
            value={`${totalMessages} (${stats.userMessages} user, ${stats.assistantMessages} assistant)`}
          />
          <Row label="Tool calls" value={String(stats.toolCalls)} />
          {tokenParts.length > 0 && (
            <Row label="Tokens" value={tokenParts.join(", ")} />
          )}
          <Row label="Cost" value={`$${stats.totalCost.toFixed(3)}`} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right truncate" title={value}>
        {value}
      </span>
    </div>
  );
}
