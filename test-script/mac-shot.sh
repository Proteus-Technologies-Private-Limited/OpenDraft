#!/bin/bash
# Save a screenshot of the OpenDraft window to test-script/output/feature-review/macos/<name>.png
set -e
name="$1"
out="$(cd "$(dirname "$0")" && pwd)/output/feature-review/macos"
mkdir -p "$out"
# Bounds of OpenDraft's front window, in points
b=$(osascript -e 'tell application "System Events" to tell (first process whose bundle identifier is "com.proteus.opendraft") to get {position, size} of window 1' | tr -d ' ')
IFS=, read -r x y w h <<< "$b"
screencapture -x -R"$x,$y,$w,$h" "$out/$name.png"
echo "$out/$name.png"
