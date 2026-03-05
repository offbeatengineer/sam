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
# From desktop/

# Development (starts Vite + Tauri)
npm run tauri dev

# Production build
npm run build && npm run tauri build
```

## Project Structure

```
desktop/
├── src/                   # React frontend
│   ├── components/        # UI components (chat/, context/, layout/, sidebar/, skills/, memory/, ui/)
│   ├── stores/            # Zustand stores (sessionStore, skillStore, settingsStore, etc.)
│   ├── types/             # TypeScript types (session.ts, chat.ts)
│   └── lib/               # Tauri IPC wrappers, storage utilities
└── src-tauri/             # Rust backend
    ├── src/lib.rs         # WebSocket client, IPC commands
    └── tauri.conf.json    # App config
```

## Key Patterns

**Sessions as Single Source of Truth**:
- The pi-coding-agent JSONL session is the single source of truth for all conversation data
- The desktop app is a GUI for browsing and interacting with sessions
- All channels (app, discord, pulse) are visible in the sidebar
- Sessions from discord/pulse are read-only in the app

**WebSocket Protocol** (JSON messages):
- Requests: `{ type: "chat" | "abort" | "close_session" | "list_sessions" | "get_session_entries", ... }`
- Responses: `{ type: "turn_start" | "text_delta" | "thinking_delta" | "tool_start" | "tool_end" | "turn_end" | "sessions_list" | "session_entries" | ... }`

**State Management** (Zustand stores):
- `sessionStore`: Session list, active session, entries, streaming state. Replaces old taskStore + conversationStore.
- `settingsStore`: Sam connection URL, connection status polling
- `uiStore`: Sidebar state, settings page routing
- Use `getState()` for values needed at execution time (not render time)

**Session Entry Rendering**:
- `SessionEntryRenderer` dispatches on `SessionEntry.type` (message, model_change, compaction, etc.)
- `MessageEntryView` dispatches on `AgentMessage.role` (user, assistant, toolResult, bashExecution, etc.)
- `StreamingTurnView` renders the in-progress streaming turn from sessionStore
- After streaming ends, entries are refreshed from the JSONL file

**Settings Pages**:
- Skills and Memory are accessed via settings links in the sidebar footer
- When a settings page is active, AppLayout renders it instead of the chat view
- Back button returns to chat view

**Path Alias**: `@/` maps to `./src/`

## Important Notes

- Sam agent must be running before connecting (configure `app.enabled: true` in `~/.sam/config.yaml`)
- Default connection URL: `ws://127.0.0.1:9222`
- Sessions are stored in `~/.sam/sessions/{channelId}/{conversationId}/` as JSONL files
- Each conversationId maps to an independent sam session
