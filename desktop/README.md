# Sam Desktop

A native desktop app for chatting with your Sam agent. Built with Tauri 2 —
a lightweight React + Rust shell that runs on macOS, Windows, and Linux.

The desktop app is a **client** — it does not run the AI itself. It connects to
a Sam agent over WebSocket. Start the agent first (see [`../agent`](../agent)).

---

## Requirements

- **[Node](https://nodejs.org) 18+** (or Bun)
- **Rust toolchain** — install via <https://rustup.rs>
- OS-specific build tools for Tauri:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + WebView2
  - **Linux**: `webkit2gtk`, `libayatana-appindicator`, `librsvg` — see the
    [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for
    your distro
- A **running Sam agent** with the app channel enabled (see agent README)

---

## Run in development

```bash
cd desktop

# Install JS dependencies
npm install

# Launch the dev build (starts Vite + Tauri)
npm run tauri dev
```

The window opens automatically. Rust backend changes trigger a rebuild; React
changes hot-reload.

---

## Build a distributable

```bash
npm run build && npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (`.dmg` on macOS,
`.msi`/`.exe` on Windows, `.AppImage`/`.deb` on Linux).

---

## First launch

1. Start the Sam agent in another terminal.
2. Open the desktop app.
3. Open **Settings** (gear icon) and confirm the connection URL.
   The default is `ws://127.0.0.1:9222`. If you set an `apiKey` in the agent
   config, enter it here.
4. The sidebar shows your sessions across all channels (app, Discord, Pulse).
   Sessions from Discord and Pulse are read-only — start a new one from the
   **New Chat** button to chat from the desktop.

---

## What you can do

- **Chat** with Sam, including rich input (Markdown, code, images).
- **Record audio** and send it (microphone permission required on first use).
- **Browse past sessions** across every channel the agent runs.
- **Manage memory** — review and delete facts Sam has saved about you.
- **Manage skills** — browse, edit, and author the Markdown playbooks that
  teach Sam how to do specific tasks.
- **Preview artifacts** — HTML/Markdown reports Sam produces appear inline.

---

## Troubleshooting

- **"Connection failed"** — the agent isn't running, or `app.enabled` is false
  in `~/.sam/config.yaml`. Start it with `bun run start` inside `agent/`.
- **Wrong port** — the agent defaults to `9222`. Match it in desktop settings.
- **Microphone not working (macOS)** — System Settings → Privacy & Security →
  Microphone — make sure Sam is allowed.
- **Tauri dev fails to launch** — run `npm run dev` alone to isolate frontend
  errors, then `npm run tauri dev` once Vite is happy.

---

## License

MIT
