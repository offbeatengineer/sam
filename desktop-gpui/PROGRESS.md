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
`gpui = "=0.2.2"`, `gpui-component = "=0.5.1"` (features `webview`,
`tree-sitter-languages`), and `gpui-component-assets = "=0.5.1"` (embeds the
IconName SVGs — without `.with_assets(...)` in main.rs every icon renders
blank, including inside gpui-component's own widgets).
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
| M6 polish + parity sweep | ✅ | ✅ multi-instance, menu bar, notifications, bundle |
| M7 swap-over gaps | ✅ | ◐ build/tests/round-trips/right-sidebar shot; interactive flows need eyes-on (see M7 section) |

### M6 progress (2026-06-12, second session)

- ✅ **Metal Toolchain installed** → dropped `runtime_shaders`; shaders now
  compile at build time (verified: app renders).
- ✅ **Icon assets fixed**: added `gpui-component-assets` +
  `Application::with_assets(...)` — icons were silently blank app-wide before.
- ✅ **Multi-instance settings page**: instance list with active badge,
  Connect (switch), Edit, remove (✕), New instance + edit form
  (`settings_form.rs`); `ConnectionState::{save_instance, switch_instance,
  remove_instance}` port the settingsStore.ts flows; switch/remove-active
  clears the SessionStore and auto-selects the newest app session after the
  next sessions list (`auto_select_latest`). Verified visually
  (SAM_OPEN_SETTINGS=1); live switch to the remote instance not exercised.
- ✅ **Keybindings**: Cmd+N new session, Cmd+, toggle settings, Cmd+W close
  window, Cmd+Q quit (actions in main.rs, handlers on SamApp root).
- ✅ **Turn-end notification** when window unfocused (`notify.rs`, osascript
  `display notification`, preview = last streamed text). Verified end-to-end
  with a real backgrounded turn.
- ✅ **Image paste**: Cmd+V with a clipboard image stages it as an attachment
  (capture-phase interception of the Input's Paste action in composer.rs).
- ✅ **Special tool cards** (streaming view): web_search / web_fetch /
  memory_save·update·forget / memory_recall / session_search / session_read /
  manage_kit / report_artifact (clickable → artifact panel) in
  `views/tool_cards.rs`; `StreamItem::Tool` now carries `details` from
  tool_end. Verified visually mid-stream (query + "SearXNG · 5 results").
- ✅ **Special tool cards in history** + inline results: toolResult entries
  no longer render their own row; `ActiveSession::tool_results`
  (toolCallId → text/isError/details) renders the result at the assistant's
  tool-call position — special card when known, collapsible generic card
  with the output otherwise (port of MessageList/MessageEntryView). Verified
  visually.
- ✅ **Inline images in history**: user-message images render as thumbnails
  above the bubble (base64 `data` and upload `url` refs). `state/images.rs`
  is an async ImageCache entity — needed because gpui's `img(uri)` is dead
  weight with the default `NullHttpClient`. ChatView observes the cache;
  visible list rows re-measure on notify. Verified visually with a synthetic
  session. Composer chips now show file thumbnails (local temp path).
- ✅ **Audio playback (MVP)**: voice-message chips in history play via
  `afplay` on a temp download (`state/audio_player.rs`, one clip at a time,
  poll-reaps for chip flip-back). Untested — no session with audio refs
  exists yet; verify together with mic recording.
- ✅ **macOS bundle**: `scripts/bundle-macos.sh` → `target/bundle/Sam.app`
  (release build, Tauri icon.icns reused, Info.plist with
  NSMicrophoneUsageDescription, ad-hoc codesign). Launched + rendered +
  connected. Bundle id is `com.offbeatengineer.sam-gpui` while the Tauri app
  coexists — switch to `com.offbeatengineer.sam` at swap-over. Note: bare
  `osascript` notifications still; a bundled-notification API (and
  notification-click-to-focus) can come later.

All tests green (15: protocol round-trips, settings schema, resize, URL normalization).
`parse_sessions` example: 6,158 real entries from `~/.sam/sessions`, 0 unknown.

## Needs eyes-on verification (user, or unlocked screen + screencapture)

1. Composer: typing, Enter sends / Shift+Enter newline (custom binding in main.rs), abort button.
2. Image attach: picker button, drag-drop onto composer, chips, send → Sam sees the image.
3. Audio: record toggle (mic permission prompt — bare binary inherits terminal's), chip with duration, send → transcription.
4. Artifact panel: click a `report_artifact` card in an old session → HTML renders in WebView; edit the file on disk → live-reload; check nothing must overlay the webview region (native child view layers above gpui).
5. Sidebar context menu: rename dialog, archive.
6. Live streaming visuals (progressive markdown, no flicker/CPU spike).
7. Keybindings: Cmd+N / Cmd+, / Cmd+W / Cmd+Q (synthetic keystrokes blocked
   without Accessibility permission, so untested).
8. Image paste: copy a screenshot region (Cmd+Ctrl+Shift+4), Cmd+V in the
   composer → chip appears; plain-text paste must still work.
9. Special tool cards: expanding rows (web_search results open the browser,
   memory recall / session search lists); streaming report_artifact card
   click opens the panel. Collapsed render verified in both streaming and
   history.
10. Instance switch: Settings → Connect on "Sam" (remote) → sessions clear
    and reload from the remote, newest app session auto-selected; switch back
    to "Willy". Also remove/re-add an instance.
11. Audio: open the `AUDIO-PLAYER-TEST` session → click "voice message" →
    plays, slider tracks progress, dragging scrubs, time label counts up,
    chip flips back at the end. Then record a real voice message and send.
12. Bundled app (target/bundle/Sam.app): mic permission prompt shows the
    Info.plist string; notification fires from the bundle and **clicking it
    focuses Sam**; app menu reads "Sam".
13. Menu bar: Sam → Settings…, Session → New Session, Edit items work in the
    composer (undo/copy/paste/select-all), Window → Close Window.

### M6 progress (2026-06-12, third session)

- ✅ **App menu bar**: Sam (Settings…/Services/Quit), Session (New Session),
  Edit (undo/redo/cut/copy/paste/select-all → focused input, OsAction-tagged),
  Window (Close). App-menu title shows the process name for the bare binary;
  reads "Sam" in the bundle.
- ✅ **Notification click focuses the app**: bundled builds deliver through
  NSUserNotificationCenter via `mac-notification-sys` attributed to the
  bundle id; bare dev binary keeps the osascript fallback (click inert).
  Delivery from the bundle verified live.
- ✅ **Audio mini-player with seek**: rodio replaces afplay. Idle chip →
  playing row with a shared gpui-component Slider (drag scrubs via
  `sink.try_seek`) and elapsed/total label; 300 ms poll drives progress and
  reaps drained sinks. Voice messages persist as `audio_attachment` custom
  entries (data.url injected by the agent at serve time) — these now render
  as right-aligned players; `SessionEntry::Custom` was previously filtered
  entirely. Decode/duration unit-tested; click-to-play needs eyes
  (see `AUDIO-PLAYER-TEST` session).
- ✅ **Live dark mode**: `observe_window_appearance` → 
  `Theme::sync_system_appearance` (init only synced once). Verified by
  toggling system appearance while running.

## Parity sweep vs Tauri client (2026-06-12)

Scope notes: ⏭ items are the agreed later phases; ❌ items are real gaps in
the core-chat scope; ◐ partial.

| Area | Status |
|---|---|
| Connection status, instance name in chrome | ✅ titlebar dot + name |
| Settings: instance CRUD + switch | ✅ (◐ no API-key show/hide toggle; switcher lives in settings, not a sidebar dropdown) |
| Sidebar: channel groups, counts, selection, rename/archive | ✅ |
| Sidebar: archived section + unarchive | ✅ lazy-loaded group + Unarchive menu |
| Sidebar: session search box | ✅ Enter searches, filters the loaded list |
| Sidebar: streaming dot on non-active sessions | ✅ for sessions started here then left (agent streams only to the conversation owner) |
| Chat: markdown/GFM, thinking, tool cards, bash, dividers, custom | ✅ |
| Chat: special tool cards (8 kinds) | ✅ streaming + history |
| Chat: user images inline | ✅ (base64 + upload refs) |
| Chat: voice-message player | ✅ play/seek/time (◐ no volume control) |
| Chat: pending-user bubble | ✅ text + image thumbnails + audio chip |
| Chat: empty states | ◐ ours plainer ("Select a session"; no "Describe your task…" hero) |
| Chat: auto-scroll | ✅ bottom-aligned list |
| Read-only channels (discord/pulse) | ✅ badge + hidden composer |
| Composer: auto-grow, Enter/Shift+Enter, abort | ✅ (8 lines vs Tauri's 15) |
| Composer: image picker/drag-drop/paste, 5-image cap, resize | ✅ |
| Composer: mic recording → WAV | ✅ implemented (eyes-on pending) |
| Artifact panel: md/code/image/HTML + live reload + open-in-browser | ✅ (◐ no Preview/Code toggle, no Open-in-Finder) |
| Right sidebar: working-dir file tree, @file insert, drop-to-cwd | ✅ (lazy tree, no live file-watch) |
| Right sidebar: session artifacts list | ✅ report_artifact calls, click opens panel |
| Right sidebar: session stats (models, tokens, cost) | ✅ |
| Notifications | ✅ turn-end when unfocused, active + background sessions, click focuses (bundle) |
| Dark/light theme | ✅ follows system, live |
| Keybindings + menu bar | ✅ (gpui app only; Tauri has none) |
| Memory / Skills / Artifacts / Kits pages, icon rail | ⏭ later phases |

**Gap list for swap-over decision** — all closed in M7 (2026-06-14, see below):
archived sessions, sidebar session search, the right-sidebar trio (file tree /
artifacts list / session stats), background-session streaming dots +
notifications, and pending-attachment previews. What remains before retiring
`desktop/` is eyes-on verification of the M7 interactive flows and the
later-phase pages.

## M7 — swap-over gaps closed (2026-06-14)

All five swap-over gaps are implemented and committed on `gpui-rebuild`. No
protocol changes were needed — `sam-protocol` already typed every op.

- ✅ **Sidebar session search** (`SessionStore::search_sessions/clear_search`,
  search `Input` in `sidebar.rs`): Enter runs `session_search`; results filter
  the loaded list by conversationId; clearing the box restores the full list.
- ✅ **Archived sessions** (`load_archived`/`unarchive_session`): a lazy-loaded
  "Archived" group at the bottom with an Unarchive context-menu item.
- ✅ **Background-session streaming dots + notifications**
  (`background_turns`, `demote_streaming_to_background`,
  `handle_background_stream`, `turn_preview`): a turn left running when you
  switch sessions keeps a blue dot on its row and fires a turn-end notification
  (titled with the session name) when the window is unfocused. Limited to app
  conversations started here — the agent streams only to the conversation owner.
- ✅ **Pending-attachment previews** (`PendingUser { text, images, audio_secs }`,
  `set_pending`/`clear_pending`): the optimistic bubble shows staged image
  thumbnails + an audio chip (preview-temp copies, deleted on refresh).
- ✅ **Right sidebar** (`views/right_sidebar.rs`): always-on when a session is
  active (the artifact panel replaces it when open). Artifacts list
  (report_artifact details, dedup by path → opens panel), working-dir file tree
  (lazy `read_dir`, `@file` insert via `ComposerInputGlobal`, drop-to-cwd), and
  session stats (models, messages, tool calls, token in/out/cache, cost).

Verified autonomously: clean build (no `runtime_shaders`, no warnings), 17 tests
green, live `session_search`/`list_archived_sessions` round-trips
(`examples/search_smoke`: 20 hits / 14 archived), and a live screenshot of the
right sidebar (stats = minimax-cn/MiniMax-M3, 14 in / 442 out / 6.6k cache,
$0.002; file tree listing the real cwd). **Needs eyes-on** (synthetic input is
blocked here): type-to-filter search, expand archived + Unarchive, the
background dot + notification (start a turn → switch away → background the
window), attachment previews in the optimistic bubble, file-tree `@`-insert,
and drop-to-cwd.

## Remaining

- Dogfood daily, fix as found; then decide swap-over (rename bundle id to
  com.offbeatengineer.sam, retire `desktop/`).
- Gap list above, then later phases: skills editor, memory page, kits page,
  artifacts browser.

## Environment gotchas (this machine)

- **User's dev agent runs persistently** on port **9223**, apiKey `test123`
  (`watchexec … bun --env-file=.env src/index.ts`, config in `~/.sam/config.yaml`).
  Don't kill it; don't start a second one (EADDRINUSE). Active settings instance:
  "Willy" → `ws://127.0.0.1:9223`.
- **Metal Toolchain is installed** (`xcrun -f metal` resolves), so gpui's
  shaders compile at build time and the workspace carries no `runtime_shaders`
  feature. (Historically Xcode 26.5 lacked it and we used `runtime_shaders`.)
- `screencapture -x` works for headless UI verification (crop with `sips`),
  but fails/black when the screen is locked or asleep (`caffeinate -u` to wake).
  It captures the *active* Space only — if a fullscreen app is foregrounded, the
  Sam window (on another Space) won't appear; `pyobjc`/`Quartz` is not installed,
  so per-window capture isn't available. Synthetic clicks/keys are also blocked
  (no Accessibility permission), so interactive flows need eyes-on verification.

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
