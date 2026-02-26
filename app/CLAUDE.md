# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sam desktop app — a Tauri frontend that connects to a running sam agent instance via WebSocket.

## Architecture

Two-tier desktop app:
- **Frontend**: React 19 + TypeScript + Tailwind CSS (Vite build)
- **Backend**: Rust (Tauri v2) — WebSocket client connecting to sam agent

Sam agent runs separately (locally or on a VPS) and exposes a WebSocket server on a configurable port.

**Communication Flow:**
```
Frontend → Tauri IPC Commands → Rust → WebSocket → Sam Agent
Frontend ← Tauri Events ← Rust WS reader ← WebSocket ← Sam Agent
```

## Build Commands

```bash
# From app/

# Development (starts Vite + Tauri)
npm run tauri dev

# Production build
npm run build && npm run tauri build
```

## Project Structure

```
app/
├── src/                   # React frontend
│   ├── components/        # UI components (chat/, context/, layout/, skills/, ui/)
│   ├── stores/            # Zustand stores (conversationStore, taskStore, skillStore, etc.)
│   ├── types/             # TypeScript types
│   └── lib/               # Tauri IPC wrappers, storage utilities
└── src-tauri/             # Rust backend
    ├── src/lib.rs         # WebSocket client, IPC commands
    └── tauri.conf.json    # App config
```

## Key Patterns

**WebSocket Protocol** (JSON messages):
- Requests: `{ type: "chat" | "abort" | "close_session", conversationId, ... }`
- Responses: `{ type: "turn_start" | "text_delta" | "thinking_delta" | "tool_start" | "tool_end" | "turn_end" | ... }`

**State Management** (Zustand stores with subscriptions):
- `conversationStore`: Multi-task conversations, messages, streaming, artifacts
- `taskStore`: Task list, active task, persistence to `~/.sam/tasks/`
- `settingsStore`: Sam connection URL
- Use `getState()` for values needed at execution time (not render time)

**Path Alias**: `@/` maps to `./src/`

## Important Notes

- Sam agent must be running before connecting (configure `app.enabled: true` in `~/.sam/config.yaml`)
- Default connection URL: `ws://127.0.0.1:9222`
- **Multi-task**: Each task maps to an independent sam session (conversationId = taskId)
