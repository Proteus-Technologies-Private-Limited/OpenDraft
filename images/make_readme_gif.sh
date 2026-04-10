#!/bin/bash
# Generates the animated GIF used in README.md from the intro video.
# Requires: ffmpeg
# Usage: ./images/make_readme_gif.sh

set -e

INPUT="images/OpenDraft-intro.mp4"
OUTPUT="images/opendraft-demo.gif"

if [ ! -f "$INPUT" ]; then
  echo "Error: $INPUT not found. Run from project root."
  exit 1
fi

echo "Generating README GIF from $INPUT..."
ffmpeg -y -i "$INPUT" \
  -vf "setpts=PTS/3,fps=10,scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a" \
  -loop 0 "$OUTPUT" 2>/dev/null

FILESIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
echo "Done: $OUTPUT ($FILESIZE)"
