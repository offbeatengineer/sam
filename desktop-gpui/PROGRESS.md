# gpui rebuild — progress & future work

Working notes for the rebuild of the Sam desktop client in gpui, replacing the
Tauri 2 + React app in `../desktop`. Started 2026-06-12. Plan reference:
`~/.claude/plans/i-m-thinking-to-rebuild-federated-sparkle.md`.

## Decisions (agreed with the user)

- Build in `desktop-gpui/` alongside the Tauri app; swap over at parity, then delete `desktop/`.
- Core chat first; skills/memory/kits/artifacts-browser pages are later phases.
- HTML artifacts render **in-app** via gpui-component's wry WebView feature.
- macOS first; keep code portable, no Windows/Linux packaging yet.
- Share `~/.sam/settings.json` with the Tauri client (same schema incl. legacy `samUrl` migration) so both clients stay interchangeable during the transition.

## Architecture

```
crates/
├── sam-protocol   # pure serde wire types — canonical source: agent/src/protocol.ts
│                  # + pi JSONL session entry types (desktop/src/types/session.ts)
│                  # AppResponse has an Unknown fallback variant; session entries
│                  # parse via parse_entry() which degrades to Unknown, never errors
├── sam-client     # tokio IO on a dedicated thread, NO gpui dependency
│                  # ws.rs: connection actor — reconnect 2s→30s backoff, generation
│                  #   counter for stale read-tasks, requestId→oneshot correlation
│                  #   (10s timeout); correlated responses are consumed, the rest
│                  #   stream to the UI as ClientEvent
│                  # audio.rs: cpal→WAV (port of desktop/src-tauri/src/lib.rs)
│                  # upload.rs: POST /upload + GET fetch_bytes
│                  # Boundary rule: only futures-channel types cross to the UI;
│                  #   tokio stays out of sam-app entirely
└── sam-app        # the gpui app
    ├── app.rs           # SamApp root view: event pump (cx.spawn over ClientEvent
    │                    #   stream), dispatch port of ChatContainer.tsx
    ├── settings.rs      # ~/.sam/settings.json (camelCase, BackendInstance)
    ├── markdown.rs      # md() wrapper over gpui-component TextView::markdown
    ├── attachments.rs   # image resize→JPEG ≤1024px q85 (port of imageResize.ts)
    ├── state/
    │   ├── connection.rs  # ConnectionState entity (status pushed, no polling)
    │   ├── sessions.rs    # SessionStore entity: list, active entries,
    │   │                  #   StreamingTurn state machine (port of sessionStore.ts),
    │   │                  #   new-session flow (empty path → adopt after re-list)
    │   └── ui.rs          # UiState + UiStateGlobal (artifact panel open state)
    └── views/
        ├── titlebar.rs / startup = settings_form.rs (one form for both, M1)
        ├── sidebar.rs       # channel groups, context menu (rename dialog/archive)
        ├── chat.rs          # gpui list() rows = entries ++ pending-user ++ streaming;
        │                    #   per-delta: splice last row only (revision counter)
        ├── entries.rs       # render_entry dispatch (port of SessionEntryRenderer/
        │                    #   MessageEntryView); collapsibles via window keyed state
        ├── composer.rs      # input, image chips, record toggle, upload-then-send
        └── artifact_panel.rs# md/code/image native preview, HTML via wry WebView
```

Key version pins (pre-1.0, breaking churn — upgrade both together, exact pins):
`gpui = "=0.2.2"` (with `runtime_shaders`, see gotchas) and
`gpui-component = "=0.5.1"` (features `webview`, `tree-sitter-languages`).
API ground truth when coding: read the vendored sources at
`~/.cargo/registry/src/index.crates.io-*/gpui-0.2.2/` and `gpui-component-0.5.1/`
— do NOT trust memory of Zed's main branch.

## Status by milestone

| Milestone | Implementation | Verification |
|---|---|---|
| M1 connection/settings/reconnect | ✅ | ✅ live agent, settings shared with Tauri app, backoff observed |
| M2 sessions list + history rendering | ✅ | ✅ screenshots: markdown/tables/CJK/emoji, 55-entry session, selection |
| M3 streaming chat + new-session | ✅ | ✅ real streamed turn end-to-end (session `6985FDAD…` created, adopted, 4 entries reloaded) |
| M4 attachments + audio | ✅ | ◐ resize unit tests + live `/upload` smoke pass; **needs eyes**: drag-drop, picker, paste (NOT implemented), mic recording |
| M5 artifact panel + WebView | ✅ | ◐ artifacts HTTP listing verified; **needs eyes**: wry WebView render/layering, live-reload |
| M6 polish + parity sweep | ❌ not started | — |

All tests green (15: protocol round-trips, settings schema, resize, URL normalization).
`parse_sessions` example: 6,158 real entries from `~/.sam/sessions`, 0 unknown.

## Needs eyes-on verification (user, or unlocked screen + screencapture)

1. Composer: typing, Enter sends / Shift+Enter newline (custom binding in main.rs), abort button.
2. Image attach: picker button, drag-drop onto composer, chips, send → Sam sees the image.
3. Audio: record toggle (mic permission prompt — bare binary inherits terminal's), chip with duration, send → transcription.
4. Artifact panel: click a `report_artifact` card in an old session → HTML renders in WebView; edit the file on disk → live-reload; check nothing must overlay the webview region (native child view layers above gpui).
5. Sidebar context menu: rename dialog, archive.
6. Live streaming visuals (progressive markdown, no flicker/CPU spike).

## M6 backlog (next major chunk)

- Multi-instance switcher UI (settings page currently only edits the active instance; `BackendInstance` + settings schema already support multiple — port `switchInstance` clear-all + reconnect flow from `settingsStore.ts`).
- Keybindings: Cmd+N new session, etc.
- Notification on turn_end when window unfocused.
- Image paste into composer (clipboard image read) — skipped in M4.
- Thumbnails for pending images (chips are filename-only); render images/audio players inline in history (currently a 📎 count line); audio playback.
- Special tool cards (web_search, web_fetch, memory save/recall, session search/read, kit create) — currently all render via the generic card; port mappings from `StreamingTurnView.tsx:46-106`.
- Streaming `report_artifact` card should also be clickable (history cards are).
- App icon + macOS bundle (cargo-bundle or script), Info.plist with `NSMicrophoneUsageDescription`; fix Metal toolchain and consider dropping `runtime_shaders` for release.
- Parity checklist vs Tauri app, then dogfood for a week.
- Later phases (architecture ready, protocol fully typed): skills editor, memory page, kits page, artifacts browser, session search.

## Environment gotchas (this machine)

- **User's dev agent runs persistently** on port **9223**, apiKey `test123`
  (`watchexec … bun --env-file=.env src/index.ts`, config in `~/.sam/config.yaml`).
  Don't kill it; don't start a second one (EADDRINUSE). Active settings instance:
  "Willy" → `ws://127.0.0.1:9223`.
- **Xcode 26.5 lacks the Metal Toolchain component**, so gpui's build script
  can't run the `metal` CLI → we build gpui with the `runtime_shaders` feature
  (see workspace Cargo.toml comment). `xcodebuild -downloadComponent
  MetalToolchain` itself fails (broken DVTDownloads plug-in); try
  `xcodebuild -runFirstLaunch` (likely sudo) before release packaging.
- `screencapture -x` works for headless UI verification (crop with `sips`),
  but fails/black when the screen is locked or asleep (`caffeinate -u` to wake).

## Dev hooks & verification commands

```bash
RUST_LOG=info cargo run -p sam-app                 # normal run
SAM_AUTOSELECT=3 cargo run -p sam-app              # open Nth session on startup
SAM_AUTOSEND="hi" cargo run -p sam-app             # new session + send on connect

cargo test
cargo run -p sam-protocol --example parse_sessions # parse all real session JSONL
cargo run -p sam-client --example smoke -- "ws://127.0.0.1:9223?apiKey=test123"
cargo run -p sam-client --example upload_smoke -- f.png http://127.0.0.1:9223 test123
```

## Known design notes / debts

- Only the active conversation's streaming events are tracked; events for other
  conversations are dropped (matches the React app's behavior).
- `Composer` stages resized images as temp files; send = upload all → then
  `chat` with attachment refs (uploads deleted after success via `delete_after`).
- `collapsible_card` open-state lives in `window.use_keyed_state` keyed by entry
  id — survives list virtualization re-renders, resets on window close.
- Streaming markdown perf plan if jank shows up: per-item element ids are
  already in place; next lever is a 33ms notify-throttle; worst case render
  streaming text plain and re-render as markdown at turn_end.
- `AppResponse::Unknown` swallows unknown response types; if the agent adds a
  correlated response type, the pending request would time out (10s) instead of
  resolving — extend sam-protocol when the agent protocol grows.
