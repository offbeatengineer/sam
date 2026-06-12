#!/usr/bin/env bash
# Assemble Sam.app from a release build.
#
# Usage: scripts/bundle-macos.sh [output-dir]   (default: target/bundle)
#
# The bundle id is com.offbeatengineer.sam-gpui while the Tauri app
# (com.offbeatengineer.sam) still coexists; switch to the canonical id at
# swap-over. Ad-hoc signed so TCC permission grants (microphone) persist
# across rebuilds with an unchanged binary.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(grep -m1 '^version' crates/sam-app/Cargo.toml | sed 's/.*"\(.*\)"/\1/')"
OUT="${1:-target/bundle}"
APP="$OUT/Sam.app"
ICON_SRC="../desktop/src-tauri/icons/icon.icns"

cargo build --release -p sam-app

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp target/release/sam-app "$APP/Contents/MacOS/sam-app"
if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$APP/Contents/Resources/icon.icns"
else
  echo "warning: $ICON_SRC not found, bundling without icon" >&2
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>Sam</string>
	<key>CFBundleExecutable</key>
	<string>sam-app</string>
	<key>CFBundleIconFile</key>
	<string>icon.icns</string>
	<key>CFBundleIdentifier</key>
	<string>com.offbeatengineer.sam-gpui</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Sam</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${VERSION}</string>
	<key>CFBundleVersion</key>
	<string>${VERSION}</string>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSMicrophoneUsageDescription</key>
	<string>Sam records voice messages you send from the composer.</string>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>NSSupportsAutomaticGraphicsSwitching</key>
	<true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "bundled: $APP"
