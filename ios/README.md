# Sam for iOS

A native SwiftUI client for chatting with your Sam agent from iPhone and iPad.

Like the desktop app, iOS is a **client** — the AI runs inside the Sam agent
and the app talks to it over WebSocket. Start the agent first (see
[`../agent`](../agent)) and make sure it's reachable from your device.

---

## Requirements

- **Xcode 16.0+**
- **iOS 17+** on the target device or simulator
- **[XcodeGen](https://github.com/yonaskolb/XcodeGen)** to generate the project
  (`brew install xcodegen`)
- A **running Sam agent** with the app channel enabled

---

## Build and run

```bash
cd ios/SamApp

# Generate the Xcode project from project.yml
xcodegen generate

# Open it in Xcode
open SamApp.xcodeproj
```

In Xcode:

1. Pick a simulator or a connected device from the scheme selector.
2. If running on a device, set your development team in
   **Signing & Capabilities** (the bundle identifier is `com.sam.SamApp` —
   change it in `project.yml` if it collides with something you already own,
   then re-run `xcodegen generate`).
3. Press **Cmd+R**.

Swift Package Manager resolves the one external dependency
([`swift-markdown-ui`](https://github.com/gonzalezreal/swift-markdown-ui))
on first build.

### Command-line build

```bash
xcodebuild -scheme SamApp \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  build
```

---

## First launch

1. Make sure the Sam agent is running with `app.enabled: true` in
   `~/.sam/config.yaml`.
2. Open the app and go to **Settings**.
3. Enter the WebSocket URL based on where the agent runs:
   - **Simulator on the same Mac**: `ws://127.0.0.1:9222` (no config changes
     needed).
   - **On your LAN** (phone and Mac on the same Wi-Fi): set `app.host:
     0.0.0.0` and `app.apiKey` in the agent config, then connect to
     `ws://<your-mac-lan-ip>:9222` (e.g. `ws://192.168.1.42:9222`).
   - **Away from home** (phone on cellular, agent at your house): expose
     the agent through a Cloudflare Tunnel and connect to
     `wss://your-hostname/`. Follow the **Remote access** section in
     [`../agent/README.md`](../agent/README.md) — it walks through the
     tunnel setup and the API-key rules.
4. Paste the `apiKey` if you set one. The app stores it in the Keychain.
5. Return to the main screen — sessions sync from the agent.

---

## What you can do

- **Chat** with Sam, including text, images, and voice.
- **Browse sessions** across all channels (app, Discord, Pulse) — they're
  read-only unless they were started from an app client.
- **Record audio** for transcription (microphone permission is requested on
  first use).
- **Manage memory, skills, artifacts, and kits** from the settings pages.
- **Adaptive layout** — a tabbed UI on iPhone and a split view on iPad; Sam
  follows scene phase transitions to reconnect cleanly when you return to the
  app.

---

## Troubleshooting

- **"Can't connect"** — verify the agent is reachable (`curl` the host/port
  from another device). For LAN access, the agent must bind to `0.0.0.0`, not
  the default `127.0.0.1`.
- **TLS errors on a real device** — iOS blocks plain `ws://` over non-loopback
  addresses if your Info.plist enforces ATS. For local/dev use, the app ships
  with an ATS exception; for production, run the agent behind TLS and use
  `wss://`.
- **Project won't open** — run `xcodegen generate` again; the `.xcodeproj` is
  derived from `project.yml`.
- **Audio recording silent** — Settings → Privacy & Security → Microphone →
  enable for Sam.

---

## License

MIT
