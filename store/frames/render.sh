#!/bin/sh
# Renders every store scene to PNG (1280x800) with headless Chrome.
# Usage: store/frames/render.sh [raw-dir-relative-to-frames] [out-dir]
set -e
cd "$(dirname "$0")"
RAW="${1:-../raw/en}"
OUT="${2:-../screenshots/en}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"
i=1
for slide in hero history addById compact mobile features; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1280,800 --virtual-time-budget=4000 \
    --screenshot="$OUT/$i-$slide.png" \
    "file://$PWD/frame.html?slide=$slide&raw=$RAW" >/dev/null 2>&1
  i=$((i + 1))
done
ls -la "$OUT"
