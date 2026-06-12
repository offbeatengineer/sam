# Sam Desktop (gpui)

Native Rust rebuild of the Sam desktop client on [gpui](https://www.gpui.rs/)
(Zed's UI framework) + [gpui-component](https://github.com/longbridge/gpui-component).
It speaks the same WebSocket protocol as the Tauri client (`../desktop`) and
shares `~/.sam/settings.json`, so the two are interchangeable during the
transition.

## Crates

| Crate | What it is |
|---|---|
| `crates/sam-protocol` | Pure serde wire types (canonical source: `agent/src/protocol.ts`) + pi JSONL session entry types |
| `crates/sam-client` | Tokio IO layer on a dedicated thread: WebSocket actor with reconnect/backoff, requestId correlation, uploads, cpal audio recording. No gpui dependency. |
| `crates/sam-app` | The gpui app: entities (connection/sessions/ui), views (sidebar, chat, composer, artifact panel) |

## Build & run

```bash
cargo run -p sam-app                       # agent must be running (see ../agent)
RUST_LOG=info cargo run -p sam-app         # with logs
```

gpui is built with the `runtime_shaders` feature because this machine's Xcode
lacks the Metal Toolchain component (`xcodebuild -downloadComponent
MetalToolchain` to fix). Before producing release builds, install it and
consider dropping the feature for precompiled shaders.

`gpui` and `gpui-component` are pinned to exact versions (pre-1.0, breaking
changes between releases). Upgrade deliberately, both together — gpui-component
releases pin a specific gpui version.

## Dev hooks & verification

```bash
SAM_AUTOSELECT=3 cargo run -p sam-app        # open the Nth session on startup
SAM_AUTOSEND="hi" cargo run -p sam-app       # new session + send on connect

cargo test                                   # protocol round-trips, settings schema, image resize
cargo run -p sam-protocol --example parse_sessions     # parse all ~/.sam/sessions JSONL
cargo run -p sam-client --example smoke -- "ws://127.0.0.1:9223?apiKey=..."   # live protocol smoke
cargo run -p sam-client --example upload_smoke -- file.png http://127.0.0.1:9223 <apiKey>
```

## Status

Built so far: connection/settings (shared with Tauri client), sessions sidebar
(grouped by channel, rename/archive context menu), full read-only history
rendering (markdown, thinking, tool cards, bash), streaming chat with abort
and new-session flow, image attachments (picker/drag-drop, resized to JPEG
≤1024px), audio recording (cpal → WAV → upload), artifact panel (native
markdown/code/image preview, wry WebView for HTML with agent live-reload).

Remaining (M6): multi-instance switcher UI, keybindings beyond Enter/Shift+Enter,
notifications, app icon + macOS bundle (needs `NSMicrophoneUsageDescription`),
parity sweep vs the Tauri app.
