"""Crop an iPad simulator screenshot to the app: drop the status bar above the menu bar.

    venv/bin/python test-script/manual_shots/crop.py <raw.png> <out.png> [top_px=64]
"""
import sys

from PIL import Image

raw, out = sys.argv[1], sys.argv[2]
top = int(sys.argv[3]) if len(sys.argv) > 3 else 64
im = Image.open(raw).convert("RGB")
im.crop((0, top, im.width, im.height)).save(out, optimize=True)
print(out, im.width, im.height - top)
