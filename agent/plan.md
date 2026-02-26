# Plan: Project Sam — Lightweight AI Assistant

## Context

The goal is to build a lightweight general-purpose AI assistant that wraps `pi-coding-agent` from the pi-mono project. Unlike OpenClaw (which has 13+ channel integrations, a gateway server, plugin ecosystem, and 50+ skills), Sam is minimal — it reuses pi-coding-agent's SDK for the agent loop, tools, and session management, and adds a thin channel abstraction for chat integrations. Discord is the first channel.

Key decisions made during design:
- **Standalone npm project** (not inside pi-mono)
- **Pi's full built-in toolset** (read, write, edit, bash, grep, find, ls) — no custom tools for now
- **Custom system prompt** for general-purpose use (not coding-focused)
- **ChatChannel interface** for future extensibility
- **No persistent message queue** — OpenClaw operates fine without one
- **followUp mode** for concurrent messages (pi-coding-agent handles serialization internally)

## Project Structure

```
sam/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                  # Entry point / bootstrap
│   ├── config.ts                 # Config loading (env vars + yaml)
│   ├── types.ts                  # Shared types (SessionKey, InboundMessage, OutboundMessage)
│   ├── system-prompt.ts          # Custom system prompt
│   ├── agent-factory.ts          # Wraps createAgentSession() with Sam's config
│   ├── session-registry.ts       # Maps (channelId, conversationId) → AgentSession
│   ├── dispatcher.ts             # Routes inbound → agent, agent responses → channel
│   ├── text-chunker.ts           # Splits text for Discord's 2000 char limit
│   └── channels/
│       ├── chat-channel.ts       # ChatChannel interface
│       └── discord-channel.ts    # Discord implementation
```

10 source files total.

## Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "^0.52.10",
    "@mariozechner/pi-ai": "^0.52.10",
    "discord.js": "^14.18.0",
    "yaml": "^2.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

No dotenv needed — Node 22+ supports `--env-file=.env`.

## Implementation Plan

### Step 1: Project scaffolding

Create `sam/` directory with `package.json`, `tsconfig.json`, `.env.example`.

**tsconfig.json**: target ES2022, module Node16, strict, outDir dist, rootDir src.

**package.json scripts**:
- `build`: `tsc`
- `start`: `node --env-file=.env dist/index.js`
- `dev`: `tsc --watch`

### Step 2: Types and config (`types.ts`, `config.ts`)

**`src/types.ts`** — Shared types:

```typescript
export interface SessionKey {
  channelId: string;        // "discord", "google-chat", etc.
  conversationId: string;   // channel-specific (Discord channel ID, thread ID, etc.)
}

export interface InboundMessage {
  sessionKey: SessionKey;
  text: string;
  authorId: string;
  authorName: string;
}

export interface OutboundMessage {
  sessionKey: SessionKey;
  text: string;
}
```

**`src/config.ts`** — Load config from YAML file + env var overrides:

```typescript
export interface SamConfig {
  discord: { token: string; allowedChannelIds?: string[] };
  model: { provider: string; modelId: string; thinkingLevel: string; apiKey?: string };
  workspace: { dir: string; sessionDir?: string; agentDir?: string };
}
```

- `DISCORD_TOKEN` from env (required)
- `MODEL_PROVIDER`, `MODEL_ID`, `THINKING_LEVEL` from env (optional, defaults to anthropic/claude-sonnet-4-20250514/off)
- Structural config (allowedChannelIds, workspace paths) from `config.yaml`

### Step 3: System prompt (`system-prompt.ts`)

General-purpose assistant prompt that:
- Identifies as "Sam"
- Describes available tools generically (file access and shell execution)
- Sets guidelines: be concise, use markdown, explain tool usage
- Includes `{{cwd}}` and `{{datetime}}` template variables
- Notes it's running in a chat channel (no interactive terminal commands)

### Step 4: Agent factory (`agent-factory.ts`)

Follows the exact pattern from pi-coding-agent's `examples/sdk/12-full-control.ts`:

```typescript
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage, createAgentSession, createExtensionRuntime,
  createCodingTools, createGrepTool, createFindTool, createLsTool,
  ModelRegistry, type ResourceLoader, SessionManager, SettingsManager,
} from "@mariozechner/pi-coding-agent";
```

Key configuration:
- **Tools**: `[...createCodingTools(cwd), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd)]` — all 7 built-in tools with custom cwd
- **ResourceLoader**: Manual implementation (like example 12) — `getSystemPrompt()` returns our custom prompt, all other getters return empty arrays. This avoids file system discovery of `.pi/` directories.
- **SessionManager**: `SessionManager.create(cwd, sessionDir)` — file-based persistence, one session directory per conversation
- **SettingsManager**: `SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 3 } })`
- **Auth**: `AuthStorage` with `setRuntimeApiKey()` if `MODEL_API_KEY` env is set, otherwise pi-ai's standard env var discovery (e.g. `ANTHROPIC_API_KEY`)

### Step 5: Session registry (`session-registry.ts`)

Maps `SessionKey` → `AgentSession`. Lazy creation on first message.

```typescript
class SessionRegistry {
  private sessions: Map<string, { session: AgentSession; lastActivity: number }>;

  async getOrCreate(key: SessionKey): Promise<AgentSession>;  // Creates via agent-factory
  has(key: SessionKey): boolean;
  dispose(key: SessionKey): void;       // Calls session.dispose()
  disposeAll(): Promise<void>;
}
```

Session directory layout:
```
.sam/sessions/
  discord/
    <channelId1>/session.jsonl
    <channelId2>/session.jsonl
```

### Step 6: Text chunker (`text-chunker.ts`)

Pure function: `chunkText(text: string, maxLen?: number): string[]`

Split strategy (in priority order):
1. If text fits in maxLen (default 2000), return as-is
2. Check if splitting would break a code block (odd number of ``` fences) — if so, split before the opening fence
3. Try to split at double newline (paragraph boundary)
4. Try to split at single newline
5. Hard split at maxLen

~60-80 lines.

### Step 7: ChatChannel interface (`channels/chat-channel.ts`)

```typescript
export type MessageHandler = (message: InboundMessage) => void;

export interface ChatChannel {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  onMessage(handler: MessageHandler): void;
}
```

Deliberately minimal — 4 methods. Channels don't know about sessions, agents, or other channels.

### Step 8: Discord channel (`channels/discord-channel.ts`)

Uses `discord.js` v14 with:
- Intents: Guilds, GuildMessages, MessageContent, DirectMessages
- Listens on `Events.MessageCreate`
- Filters: ignore bots, check allowedChannelIds (if configured), require bot mention or DM
- Strips `<@botId>` mention from text before forwarding
- `send()`: fetches channel by conversationId, calls `chunkText()`, sends each chunk via `channel.send()`

~80-100 lines.

### Step 9: Dispatcher (`dispatcher.ts`)

The central routing component.

```typescript
class Dispatcher {
  private channels: Map<string, ChatChannel>;
  private registry: SessionRegistry;
  private subscriptions: Map<string, () => void>;  // session key → unsubscribe fn

  addChannel(channel: ChatChannel): void;     // Register + wire onMessage
  shutdown(): Promise<void>;                   // Stop channels, dispose sessions
}
```

**Inbound flow** (`handleInbound`):
1. Get or create session from registry
2. Subscribe to session events (if not already subscribed)
3. Call `session.prompt(text, { streamingBehavior: "followUp" })`

**Event subscription** (`ensureSubscription`):
- Accumulate `text_delta` from `message_update` events into a buffer
- On `message_end`: if buffer has text, send to channel via `channel.send()`, reset buffer
- This naturally handles multi-turn agent loops (tool calls produce intermediate messages with no text, which we skip)

**Error handling**:
- Wrap `session.prompt()` in try/catch, send error message to channel on failure

~80-100 lines.

### Step 10: Entry point (`index.ts`)

```typescript
async function main() {
  const config = loadConfig();
  // validate required config (discord token)

  const registry = new SessionRegistry(config);
  const dispatcher = new Dispatcher(registry);

  const discord = new DiscordChannel({
    token: config.discord.token,
    allowedChannelIds: config.discord.allowedChannelIds,
  });
  dispatcher.addChannel(discord);

  await discord.start();

  // Graceful shutdown on SIGINT/SIGTERM
  process.on("SIGINT", () => dispatcher.shutdown());
  process.on("SIGTERM", () => dispatcher.shutdown());
}
```

~30 lines.

## Key pi-coding-agent APIs Used

| API | File | Purpose |
|---|---|---|
| `createAgentSession(options)` | `sdk.ts` | Session factory |
| `createCodingTools(cwd)` | `tools/index.ts` | read, bash, edit, write tools |
| `createGrepTool(cwd)`, `createFindTool(cwd)`, `createLsTool(cwd)` | `tools/index.ts` | Additional tools |
| `SessionManager.create(cwd, sessionDir)` | `session-manager.ts` | File-based session persistence |
| `SettingsManager.inMemory(settings)` | `settings-manager.ts` | In-memory settings |
| `AuthStorage` + `setRuntimeApiKey()` | `auth-storage.ts` | API key management |
| `ModelRegistry` | `model-registry.ts` | Model discovery |
| `createExtensionRuntime()` | `extensions/index.ts` | Empty runtime for ResourceLoader |
| `getModel(provider, modelId)` | `pi-ai/models.ts` | Resolve model config |
| `session.prompt(text, { streamingBehavior })` | `agent-session.ts` | Send message, auto-queues if streaming |
| `session.subscribe(listener)` | `agent-session.ts` | Event stream for responses |
| `session.dispose()` | `agent-session.ts` | Cleanup |

Reference examples:
- `packages/coding-agent/examples/sdk/12-full-control.ts` — Manual ResourceLoader, AuthStorage, tools pattern
- `packages/coding-agent/examples/sdk/03-custom-prompt.ts` — System prompt override patterns
- `packages/coding-agent/examples/sdk/05-tools.ts` — Tool factory usage with custom cwd

## Implementation Order

1. **Scaffolding** — package.json, tsconfig.json, .env.example
2. **types.ts** — No logic, just interfaces
3. **config.ts** — Config loading
4. **system-prompt.ts** — Prompt template
5. **text-chunker.ts** — Pure function, easy to test
6. **agent-factory.ts** — Core SDK integration (test with a simple script)
7. **session-registry.ts** — Session management
8. **channels/chat-channel.ts** — Interface only
9. **channels/discord-channel.ts** — Discord integration
10. **dispatcher.ts** — Wire everything together
11. **index.ts** — Entry point

## Verification

1. **Smoke test the agent** (after step 6): Write a quick test script that creates a session, sends "What is 2+2?", prints the response via event subscription. Confirms SDK integration works.

2. **Test text chunker** (after step 5): Feed it strings of various lengths, strings with code blocks, verify chunks are all ≤2000 chars and code blocks aren't split.

3. **End-to-end test** (after step 11):
   - Set `DISCORD_TOKEN` and `ANTHROPIC_API_KEY` (or equivalent) in `.env`
   - Run `npm run build && npm start`
   - In Discord, DM the bot or @mention it: "Hello, what can you do?"
   - Verify: bot responds with a coherent message
   - Send: "List the files in the current directory" — verify tool use works
   - Send two messages rapidly — verify both get answered (followUp mode)
   - Send a prompt that produces >2000 chars — verify response is chunked properly
