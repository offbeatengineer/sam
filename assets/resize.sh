#!/bin/bash
#
# Resize a 1024x1024 icon to 840x840 and center it on a 1024x1024 transparent canvas.
# Uses sips (macOS native) for resizing and ImageMagick convert for padding.
#
# Usage:
#   ./resize_icon.sh <input.png> [output.png]
#
# If output is not specified, saves to <input>_macos.png

set -e

if [ $# -lt 1 ]; then
    echo "Usage: resize_icon.sh <input.png> [output.png]"
    echo ""
    echo "Resizes a 1024x1024 icon to 840x840 and centers it on a"
    echo "1024x1024 transparent canvas for proper macOS Dock appearance."
    exit 1
fi

INPUT="$1"
BASENAME="${INPUT%.*}"

if [ $# -ge 2 ]; then
    OUTPUT="$2"
else
    OUTPUT="${BASENAME}_macos.png"
fi

TEMP_RESIZED=$(mktemp /tmp/icon_resized_XXXXXX.png)
trap "rm -f '$TEMP_RESIZED'" EXIT

# Step 1: Resize to 840x840 using sips
sips -z 840 840 "$INPUT" --out "$TEMP_RESIZED" > /dev/null

# Step 2: Pad to 1024x1024 with transparent background using convert
convert "$TEMP_RESIZED" -background none -gravity center -extent 1024x1024 "$OUTPUT"

echo "Created: $OUTPUT"
