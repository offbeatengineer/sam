# Sam Agent

The Sam agent is the backend brain of Sam. It hosts an AI assistant and
exposes it through several channels at once:

- **App channel** — a WebSocket server used by the Sam desktop and iOS apps.
- **Discord channel** — an optional Discord bot.
- **Pulse channel** — optional autonomous check-ins on a schedule.

The agent is built on [`pi-coding-agent`](https://github.com/earendil-works/pi)
and gives the assistant access to filesystem tools, bash, web search and fetch,
long-term memory, skills, and project kits.

---

## Requirements

- **[Bun](https://bun.sh)** 1.1+ (runtime — installs fast: `curl -fsSL https://bun.sh/install | bash`)
- **Credentials for an AI provider** supported by
  [pi-ai](https://github.com/earendil-works/pi) — Sam works with any provider
  pi-ai knows about
- Optional: a **Discord bot token** if you want to chat with Sam from Discord
- Optional: a **web search provider** if you want Sam to search the web —
  either a hosted [Brave Search](https://brave.com/search/api/) API key or a
  self-hosted [SearXNG](https://github.com/searxng/searxng) instance

---

## Quick start

```bash
cd agent

# 1. Install dependencies
bun install

# 2. Create your secrets file
cp .env.example .env
# then edit .env and fill in your model provider credentials
# (and DISCORD_TOKEN if using Discord)

# 3. Run the agent
bun run start
```

On first launch the agent creates its data directory at `~/.sam/` and writes a
starter config file to `~/.sam/config.yaml`. Edit that file to enable the channels
you want (see below), then restart the agent.

For development with automatic reload on source/prompt changes:

```bash
bun run dev
```

---

## Configuration

Sam reads two places for configuration:

1. **`agent/.env`** — secrets (API keys, Discord token). See `.env.example`.
2. **`~/.sam/config.yaml`** — everything else. A template lives at
   `agent/config.yaml.example`.

### Enable the desktop / iOS app channel

The desktop and iOS clients connect to the agent over a WebSocket. Enable it by
uncommenting the `app` section in `~/.sam/config.yaml`:

```yaml
app:
  enabled: true
  host: 127.0.0.1   # use 0.0.0.0 to expose to your network
  port: 9222
  apiKey: ""        # set to a secret string if host is not 127.0.0.1
```

When `host` is not `127.0.0.1`, an `apiKey` is required (or set the
`SAM_APP_API_KEY` env var). The clients will ask for it on first connect.

### Enable Discord

Create a bot at <https://discord.com/developers/applications>, invite it to your
server, then set the token in `.env`:

```env
DISCORD_TOKEN=your-bot-token
```

Optionally restrict the bot to specific channels:

```yaml
discord:
  allowedChannelIds:
    - "1234567890123456789"
```

Sam responds when @mentioned.

### Enable Pulse (autonomous check-ins)

Pulse lets Sam keep working on long-running goals on its own schedule:

```yaml
pulse:
  enabled: true
  every: "30m"
  delivery:
    channel: discord
    targetChannelId: "1234567890123456789"
  activeHours:
    start: "08:00"
    end: "22:00"
    timezone: "America/Los_Angeles"
```

### Model

Pick a provider and model in `~/.sam/config.yaml`. Sam passes this straight
through to [pi-ai](https://github.com/earendil-works/pi), so any provider and
model ID pi-ai supports will work:

```yaml
model:
  provider: <provider-name>   # whichever pi-ai provider you want to use
  id: <model-id>              # e.g. the specific model id for that provider
  thinking: "off"             # "on" enables extended reasoning (if supported)
  # apiKey: "..."             # or set MODEL_API_KEY in .env
```

Credentials can live in `agent/.env` (`MODEL_API_KEY=...`) or inline under
`model.apiKey` in the YAML. Some providers also honour their own standard
env var name — see pi-ai for the list.

### Use your Claude Pro/Max subscription (Agent SDK backend)

By default Sam runs the pi-coding-agent loop and bills **per token** against
whatever API key you configure. Even logging pi in with a Claude subscription
keeps billing per-token — Anthropic treats a re-implemented harness as
"third-party usage." To draw on your **Claude Pro/Max plan** instead, Sam can
route turns through the **Claude Agent SDK**, the genuine Claude Code client,
which Anthropic bills against your subscription.

Enable it in `~/.sam/config.yaml`:

```yaml
model:
  provider: anthropic            # required — the SDK backend is Anthropic-only
  id: claude-sonnet-4-20250514   # any Claude model your plan can use
  thinking: "off"
  backend: agent-sdk             # default is "pi"
```

Then authenticate the genuine `claude` client (no `ANTHROPIC_API_KEY` /
`MODEL_API_KEY` — an API key takes precedence and would bill per token):

```bash
# Headless-friendly: a one-year subscription token (recommended for a daemon)
claude setup-token
# copy the printed token into agent/.env:
#   CLAUDE_CODE_OAUTH_TOKEN=...
```

or, for a local desktop run, just be logged in via `claude` (`/login`). On the
first turn the agent logs the active auth source, e.g.
`[agent-sdk] auth=CLAUDE_CODE_OAUTH_TOKEN model=…`. Confirm turns draw from the
plan with `claude` → `/status`.

Everything else is unchanged: Sam's tools (bash, web, memory, sessions, kits),
session history, the WebSocket protocol, and all clients work exactly as before.
The SDK backend uses Claude Code's native file tools (Read/Edit/Write/Glob/Grep)
and bridges Sam's own tools in-process.

**Good to know (v1):**

- **Anthropic provider only.** Any other `provider` falls back to the pi backend
  (logged at startup). The default `backend: pi` is untouched, so non-Anthropic
  providers keep working.
- **Feature gaps vs. the pi backend:** no mid-turn steering, no pi
  compaction/retry knobs, and no incremental tool-output streaming. Per-message
  token counts are recorded; per-message cost is not (the SDK reports cost per
  turn).
- **Policy volatility.** Anthropic announced — then *paused* (June 15, 2026) —
  restricting Agent SDK / `claude -p` subscription billing to interactive use.
  It works today, but if that changes, switch `backend` back to `pi`. Re-check
  with `claude` → `/status` if billing behaves unexpectedly.

### Web search

Sam's `web_search` tool supports two providers. Pick one.

**Option A — Brave Search (hosted, paid tier available)**

Add `BRAVE_API_KEY` to `agent/.env`. Get a key at
<https://brave.com/search/api/>.

```env
WEB_SEARCH_PROVIDER=brave
BRAVE_API_KEY=your-key
```

**Option B — SearXNG (self-hosted, free)**

[SearXNG](https://github.com/searxng/searxng) is a privacy-respecting
metasearch engine you run yourself. It aggregates results from Google, Bing,
DuckDuckGo, and dozens of other engines without exposing your queries to
them. Once it's running, point Sam at it:

```env
WEB_SEARCH_PROVIDER=searxng
SEARXNG_URL=http://localhost:8888
```

Or in `~/.sam/config.yaml`:

```yaml
tools:
  webSearch:
    provider: searxng
    searxngUrl: http://localhost:8888
```

#### Running SearXNG with Docker

The quickest way to get a local SearXNG up:

```bash
# 1. Create a place for SearXNG's config
mkdir -p ~/searxng && cd ~/searxng

# 2. Generate a random secret key (required)
SECRET_KEY=$(openssl rand -hex 32)

# 3. Start the container
docker run -d \
  --name searxng \
  --restart unless-stopped \
  -p 8888:8080 \
  -v ~/searxng:/etc/searxng \
  -e "BASE_URL=http://localhost:8888/" \
  -e "INSTANCE_NAME=sam-searxng" \
  docker.io/searxng/searxng:latest

# 4. Enable the JSON API (Sam needs this)
#    Wait a couple of seconds for SearXNG to write its default config,
#    then edit ~/searxng/settings.yml and ensure the `search.formats`
#    block contains `json`:
#
#      search:
#        formats:
#          - html
#          - json
#
# 5. Restart to pick up the config
docker restart searxng
```

Verify it works:

```bash
curl 'http://localhost:8888/search?q=hello&format=json' | head
```

You should get JSON back. If you get HTML or a 403, the JSON format isn't
enabled yet — recheck `settings.yml`.

Then restart the Sam agent and try a query that needs fresh info ("what's
the latest release of Bun?"). Sam will call `web_search` and you'll see the
results in the client.

> Tip: prefer `docker compose`? SearXNG ships a ready-to-use compose file at
> <https://github.com/searxng/searxng-docker>.

### Memory

Sam keeps long-term memories in a local LanceDB table under `~/.sam/memory`.
By default the model decides when to use them, through the `memory_save`,
`memory_recall`, `memory_update`, and `memory_forget` tools.

#### Automatic memory (opt-in)

With automatic memory on, Sam stops relying on the model to remember to
remember:

- **Before every turn**, each saved memory is judged against the conversation,
  and the relevant ones are handed to the model as background notes. This finds
  memories that share no words with the message ("find a dinner spot" surfaces
  "User is vegetarian"), which similarity search does not.
- **After every turn**, what you said is checked for lasting facts, preferences,
  and decisions. New ones are saved as one fact per memory, a memory that your
  new statement makes outdated is replaced, and "forget that..." is honored.
- **What you learn is kept too.** When you had something explained or researched,
  the exchange is judged for whether it is worth building on later. If it is, the
  writer reads Sam's full answer and the tool results behind it (fetched pages,
  search results, files) and saves short reference notes with their source and
  date. These are a separate kind of memory, because they do not come from you:
  they are never treated as facts about you, can never become an always-on
  profile memory, can only replace other reference notes, and reach the model
  in their own section marked as possibly outdated.
- Nothing is destroyed. Replaced and forgotten memories stay in the store with
  a status, and the Memory screen can restore them or delete them for good.
- The model keeps only `memory_recall`, for explicit deeper searches.

The judgments come from [TypeSafe](https://typesafe.ai)'s Jev model, which is
fast (about 0.3 s) and cheap (well under $0.001 per turn). Jev only judges; the
memory text itself is written by a small LLM: Claude Haiku through the Agent SDK
when `model.backend` is `agent-sdk` (so it draws on your subscription), or the
`memory.writer` model through pi otherwise.

> **Privacy.** Memory is otherwise fully local. With this on, the text of your
> active memories and the last few messages of the conversation are sent to
> `api.typesafe.ai` on every turn. TypeSafe is in early access and had no
> published data-retention policy when this was written. Memories you have asked
> Sam to forget are no longer sent.
>
> Reference notes widen this. Judging an exchange sends Sam's answer (up to 6000
> characters) and the list of tool calls with their arguments, not their
> results, to TypeSafe. When an exchange passes, the full tool results of that
> turn go to the writer model, which can include local files and command output
> Sam read. On the `agent-sdk` backend that is Claude Haiku, the same provider as
> your main model; on pi it is whichever provider `memory.writer` names. Set
> `knowledgeTools: [web_fetch, web_search]` to limit the writer to public web
> content, or `knowledge: false` to turn reference notes off.

Enable it in `~/.sam/config.yaml`, and put the key in `agent/.env`:

```yaml
memory:
  typesafe:
    enabled: true
  # Only used on the pi backend:
  writer:
    provider: deepseek
    id: deepseek-v4-flash
```

```sh
TYPESAFE_API_KEY=...
```

Other `memory.typesafe` settings and their defaults: `model` (`jev-1.13.0`),
`recall` / `write` (`true`; turn either half off), `timeoutMs` (`2500`),
`recallThreshold` (`0.5`), `maxRecalled` (`8`), `saveScoreThreshold` (`1.3`),
`supersedeConfidence` (`0.6`), `shardTokenBudget` (`24000`), `maxShards` (`4`),
`knowledge` (`true`), `knowledgeScoreThreshold` (`1.5`), `knowledgeTools`
(`all`, or a list of tool names), `knowledgeMaterialTokens` (`100000`, the
budget for tool results handed to the writer; larger results are cut to fit,
smallest sources kept whole first).

If TypeSafe is slow, down, or the key is missing, turns run normally without
the situational notes; nothing is saved without a judgment. The model is pinned
because the thresholds were calibrated against it. TypeSafe retires old
versions, and when that happens Sam falls back to `jev-latest` and logs a
warning: re-run `bun run eval:memory:all` and update `model`. The same harness
is the check to run before changing any threshold or question wording; see
`evals/memory/README.md`.

Known limits: the reference-note threshold rests on a dozen labeled cases, so
watch the `[memory] knowledge gate` log lines and adjust
`knowledgeScoreThreshold` if it keeps too much or too little; pulse check-ins neither recall nor save; in a shared Discord
channel every author is recorded as "User"; and when what you say is only
*probably* an update to an old memory, Sam saves the new fact and leaves the old
one for you to review rather than replacing it.

### Prompts

Sam's behaviour is steered by three Markdown prompt files. The agent ships
with defaults in `agent/prompts/` and, on first run, copies them to
`~/.sam/prompts/`. The runtime reads from `~/.sam/prompts/` on every session,
so edit the copies there to customise Sam without touching the source tree.

| File | Purpose |
|---|---|
| `SYSTEM.md` | The base system prompt. Defines Sam's identity, capabilities, tool overview, and the message-metadata format the agent sees. Sam automatically appends a `## Environment` footer with the current working directory. |
| `AGENTS.md` | Agent-specific context loaded alongside `SYSTEM.md`. A good place for behavioural rules ("prefer action over clarification", coding conventions, tone). Ship edits you want to keep out of the main system prompt here. |
| `PULSE.md` | The message sent to Sam on each Pulse tick. Use it to tell autonomous Sam what to focus on between user interactions. **If this file is empty, the Pulse channel skips that tick** — handy for pausing autonomous work without turning off the whole channel. |

Changes take effect on the next new conversation / next Pulse tick; existing
live sessions keep using the prompt they were started with.

#### Overriding paths

To load prompts from somewhere other than `~/.sam/prompts/`, set explicit
paths in `~/.sam/config.yaml`:

```yaml
prompts:
  system: ~/.sam/prompts/SYSTEM.md
  pulse:  ~/.sam/prompts/PULSE.md
  agents: ~/.sam/prompts/AGENTS.md
```

This is useful for keeping your prompt customisations in a dotfiles repo —
point the paths at wherever you check them in.

#### Restoring a default

If you want to revert one of the files to the bundled default, delete it
from `~/.sam/prompts/` and restart the agent. Sam re-copies any missing
prompt from the bundled version on startup.

### Browser automation (optional)

For tools that drive a real browser:

```bash
npm install -g @playwright/cli
playwright-cli install
cd ~/.sam/skills && playwright-cli install --skills
```

---

## Remote access

By default the agent listens on `127.0.0.1:9222` — reachable from the same
machine only. To use the iOS app on cellular, or connect from another
computer, you need to expose the agent over the internet.

The path of least resistance is a **Cloudflare Tunnel**: free, no port
forwarding, TLS included, WebSockets work out of the box. Start here and
follow Cloudflare's own guide:

- <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/>

Point the tunnel at `http://127.0.0.1:9222` and connect your client to the
resulting `wss://<your-hostname>/` URL.

### Before you expose anything: set an API key

**This is non-negotiable.** The agent only enforces authentication when an
API key is configured — without one, your tunnel URL lets anyone on the
internet talk to your assistant and, through it, reach your files.

Generate a strong random secret and put it in `agent/.env`:

```bash
echo "SAM_APP_API_KEY=$(openssl rand -base64 32)" >> agent/.env
```

(Or set `app.apiKey` in `~/.sam/config.yaml` — same effect.) Restart the
agent. Clients that don't present the key now get `401`.

Clients pass the key either as `Authorization: Bearer <key>` or as a
`?apiKey=<key>` query parameter on the WebSocket URL.

Prefer a private network? [Tailscale](https://tailscale.com) and SSH reverse
tunnels work equally well — the API-key rule applies either way.

---

## Where things live

```
~/.sam/
├── config.yaml        Main configuration
├── prompts/           SYSTEM.md, AGENTS.md, PULSE.md — edit to customise Sam
├── sessions/          Conversation history (JSONL, one folder per conversation)
├── workspace/         Default directory Sam works in
├── memory/            Long-term facts Sam has saved
├── skills/            Markdown playbooks that teach Sam how to do specific tasks
└── kits/              Custom mini-apps embedded in the desktop & iOS clients
    └── kits.db        Shared SQLite database used by every kit
```

Sessions are the single source of truth — the desktop and iOS apps read and
stream from these same files.

---

### Running a second, isolated instance

`SAM_HOME` points Sam at a different data directory, with its own config,
sessions, and memory. Use it to try changes without touching your real data:

```sh
SAM_HOME=/tmp/sam-dev/.sam bun src/index.ts
```

Give that instance its own `app.port` in its `config.yaml`. `HOME` is left
alone, so the Claude login used by the Agent SDK backend still works. Note that
`bun run dev` restarts on every file change, and a restart runs startup work
such as schema migrations against whatever data directory it points at.

## Using Sam

Once the agent is running, talk to it from any client:

- **Desktop / iOS** — launch the app and connect to `ws://127.0.0.1:9222`
  (configurable in app settings).
- **Discord** — mention the bot in any allowed channel.

You can chat normally, or give Sam high-level goals:

> @Sam build me a small dashboard that tracks my Postgres backup size each day

Sam will plan, execute, and — if Pulse is on — keep making progress in the
background.

---

## Kits — custom mini-apps inside Sam

**Kits** are small self-contained apps that live inside the Sam desktop and
iOS clients. Each kit has its own React UI and its own TypeScript backend,
and shows up as a first-class tab alongside the chat view — on desktop in the
left-hand icon rail, on iOS in the Kits tab.

Unlike skills — which are Markdown playbooks Sam reads to figure out *how*
to do something during a conversation — a kit is something **you** open and
use directly. Typical kits are personal tools
like a feed reader, a habit tracker, a recipe box, a reading-list inbox, or
a dashboard over your own data.

The point is that **you don't build kits by hand — Sam builds them for you.**
You describe what you want, Sam scaffolds the kit, writes the frontend and
backend, builds it, and reloads it live. Then it shows up in your client.

### Asking Sam to build a kit

Just ask, conversationally. For example:

> Build me a kit called "Reading List" that lets me paste URLs, tags them
> automatically, and shows me a list I can mark as read.

Sam will:

1. **Scaffold** — create `~/.sam/kits/reading-list/` from the kit template
   (`kit.json` manifest + React + Hono starter).
2. **Implement** — edit files inside that directory to add your feature,
   including creating tables in the shared SQLite DB.
3. **Build** — compile the frontend with Vite (`bun install` + `vite build`).
4. **Reload** — hot-swap the backend Hono router without restarting the agent.

After that, a new icon appears in the desktop icon rail and in the iOS Kits
tab. Click it and your kit is live.

Follow-up prompts iterate on it — "add dark mode", "export to CSV",
"remember the last filter I picked". Sam re-edits, re-builds, and re-reloads.

### The `manage_kit` tool

Under the hood Sam uses a `manage_kit` tool with these actions — you can
trigger any of them in natural language too:

| Action | What it does |
|---|---|
| `create` | Scaffold a new kit from the template. |
| `build` | Run `bun install` + `vite build` on the kit's frontend. |
| `reload` | Hot-reload the kit's Hono backend router. |
| `enable` / `disable` | Toggle visibility in the clients without deleting. |
| `delete` | Remove the kit directory entirely. |
| `list` | Show all installed kits and their status. |

So you can say things like "disable the reading-list kit for now" or "show
me all my kits" and Sam will pick the right action.

### Anatomy of a kit

Each kit is a normal Bun/Vite project under `~/.sam/kits/<kitId>/`:

```
~/.sam/kits/reading-list/
├── kit.json              Manifest: id, name, description, icon, version, enabled
├── package.json          All dependencies (frontend + backend)
├── vite.config.ts        Vite config with the @/ path alias
├── tsconfig.json
├── index.html            Vite entry
├── src/                  React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css         Tailwind 4 + shadcn/ui theme variables
│   ├── lib/kit.ts        The host bridge (kit.fetch, setTitle, setMenu, …)
│   └── components/ui/    shadcn/ui components added on demand
├── server/
│   └── index.ts          Hono router (default export) — the backend
├── AGENTS.md             Kit-dev guidelines Sam reads when implementing
└── dist/                 Built frontend (generated; don't hand-edit)
```

**Frontend:** React + Vite + Tailwind CSS 4, with shadcn/ui pre-wired for
components. Styled to work in both a desktop iframe and an iOS WKWebView.

**Backend:** A [Hono](https://hono.dev) router that the agent mounts under a
per-kit URL prefix. It receives a `KitContext`:

```ts
export default function (ctx: KitContext): Hono {
  const app = new Hono();
  app.get("/items", (c) => c.json(ctx.db.prepare("SELECT * FROM rl_items").all()));
  return app;
}
```

`ctx` exposes `kitId`, `db` (the shared SQLite database — kits namespace
their tables with a prefix to avoid collisions), `config` (the parsed
manifest), and `kitsDir`.

**The `kit` bridge** (`src/lib/kit.ts`) is what the frontend uses to talk
to its own backend and to the host app:

```ts
import { kit } from "@/lib/kit";

// Call your own backend — routes match your Hono paths
await kit.fetch("/items");

// Drive the host's header bar (iOS nav bar or desktop kit header)
kit.setTitle("Reading List");
kit.setMenu([{ id: "add", label: "Add URL", systemImage: "plus", icon: "pen" }]);
kit.onMenuAction((id) => { if (id === "add") openDialog(); });

// Open a URL in the system browser
kit.openUrl("https://example.com");
```

`systemImage` is used on iOS (SF Symbols); `icon` is used on the desktop
(from Sam's built-in icon set).

### Shared database

All kits share a single SQLite file at `~/.sam/kits/kits.db` (Bun's built-in
driver, WAL mode, foreign keys on). Each kit namespaces its tables by
prefix:

```ts
ctx.db.exec(`
  CREATE TABLE IF NOT EXISTS rl_items (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
```

Always use prepared statements with bound parameters — never interpolate
user input into SQL strings.

### Editing a kit by hand

If you want to tweak a kit yourself, `~/.sam/kits/<kitId>/` is just a normal
project — open it in your editor, change files, then ask Sam (or run the
`manage_kit` tool) to **build** and **reload**. There's no file watcher: the
reload action is what makes your changes live.

The `AGENTS.md` inside every scaffolded kit (symlinked as `CLAUDE.md` for
Claude Code / compatible editors) contains the full kit-development
guidelines — UI conventions, backend patterns, mobile-first layout rules,
etc. Read it if you're hacking a kit directly.

### Turning kits off

Kits are on by default. To disable the whole system, add to
`~/.sam/config.yaml`:

```yaml
kits:
  enabled: false
  # dir: ~/.sam/kits   # optional override
```

The icon rail / Kits tab disappears from the clients on next connect.

---

## Troubleshooting

- **Desktop/iOS can't connect** — confirm `app.enabled: true` in the config and
  that the agent process is running. Check the port isn't blocked.
- **"Invalid API key"** — re-check your provider credentials in `agent/.env`
  (`MODEL_API_KEY`, or the provider-specific variable listed in
  `.env.example`).
- **Discord bot silent** — make sure the bot has the *Message Content* and
  *Server Members* intents enabled in the Discord developer portal, and that
  it has permission to read/send messages in the channel.
- **Starting over** — delete `~/.sam/` to reset all Sam state (sessions,
  memory, workspace). Back it up first if you care about the history.

---

## License

MIT
