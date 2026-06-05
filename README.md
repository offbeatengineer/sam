# Sam

Sam is a personal, always-on AI assistant built on top of
[`pi-coding-agent`](https://github.com/earendil-works/pi). You run Sam yourself, keep your data local, and talk to the
same assistant from Discord, a desktop app, or your iPhone.

Sam can:

- Chat like a normal assistant, with tools for files, bash, web search, and
  web fetch.
- Pursue long-running goals on its own — give it a high-level task and it
  will check in on a schedule ("pulse") and keep making progress.
- Remember things across conversations via a persistent memory system.
- Be extended with **skills** (Markdown playbooks that teach Sam how to do
  specific tasks) and **kits** (self-contained mini-apps with their own UI).
- Produce **artifacts** — HTML/Markdown reports, dashboards, small apps —
  and render them live inside the desktop and iOS clients.

---

## Architecture

Sam has one backend and multiple clients. The **agent** hosts the AI and
exposes it on several channels at once. Clients connect in.

```
                   ┌──────────────────────────────────┐
                   │            Sam Agent             │
                   │   (Bun + pi-coding-agent)        │
                   │                                  │
   Discord  ◀────▶ │  Discord channel                 │
                   │                                  │
   Desktop  ◀────▶ │  App channel (WebSocket :9222)   │ ◀────▶  iOS
                   │                                  │
                   │  Pulse (autonomous schedule)     │
                   └──────────────────────────────────┘
                                   │
                                   ▼
                           ~/.sam/  (sessions, memory, skills, workspace)
```

All conversation state lives in `~/.sam/sessions/` as JSONL files. Every
client — desktop, iOS, Discord — is a view on top of those files.

---

## Repository layout

| Folder | What it is | README |
|---|---|---|
| [`agent/`](agent) | The Sam backend. Bun + TypeScript. Runs the AI and exposes channels. | [agent/README.md](agent/README.md) |
| [`desktop/`](desktop) | Cross-platform desktop client. Tauri 2 + React. | [desktop/README.md](desktop/README.md) |
| [`ios/`](ios) | Native iOS client. SwiftUI, iOS 17+. | [ios/README.md](ios/README.md) |
| [`extensions/`](extensions) | Optional add-ons for the agent (e.g. `web-tools`). | — |
| [`assets/`](assets) | App icons and shared media. | — |

---

## Getting started

You need at minimum the **agent** running. Then pick a client.

### 1. Run the agent

```bash
cd agent
bun install
cp .env.example .env            # add your model provider & credentials
bun run start
```

On first run Sam creates `~/.sam/config.yaml`. Open it and set:

```yaml
app:
  enabled: true     # lets desktop & iOS clients connect
  port: 9222
```

Restart the agent. Full details: [agent/README.md](agent/README.md).

### 2. Run a client

**Desktop** (macOS, Windows, Linux):

```bash
cd desktop
npm install
npm run tauri dev
```

**iOS** (iPhone, iPad):

```bash
cd ios/SamApp
xcodegen generate
open SamApp.xcodeproj
```

Then configure the WebSocket URL in the client's settings. On the same
machine that's `ws://127.0.0.1:9222`.

### 3. (Optional) Add Discord

Create a bot at <https://discord.com/developers/applications>, set
`DISCORD_TOKEN` in `agent/.env`, invite the bot to your server, and
@mention it.

---

## Requirements at a glance

| Component | Needs |
|---|---|
| Agent | Bun 1.1+, AI provider credentials |
| Desktop | Node 18+, Rust toolchain, platform build tools for Tauri |
| iOS | Xcode 16+, iOS 17+, XcodeGen |

API keys and other secrets go in `agent/.env`. Everything else is in
`~/.sam/config.yaml`.

---

## Data you own

All Sam state lives under `~/.sam/`:

- `sessions/` — every conversation, as JSONL.
- `memory/` — facts Sam has saved for the long term.
- `workspace/` — the default directory Sam works in.
- `skills/` — Markdown playbooks that teach Sam how to do specific tasks.
- `config.yaml` — runtime configuration.

Back up the folder, copy it to another machine, or delete it to start fresh —
Sam is entirely local unless you configure remote access.

---

## Credits

Sam is built on top of the excellent
[pi](https://github.com/earendil-works/pi) project by Mario Zechner
(`pi-coding-agent`, `pi-ai`).

## License

MIT
