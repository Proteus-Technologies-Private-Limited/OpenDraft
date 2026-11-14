#!/usr/bin/env python3
"""Render the iPhone Duo fold animation from the simulator captures.

    venv/bin/python test-script/appstore/fold_animation.py

Writes  images/appstore/motion/opendraft-duo-fold.gif   (960x443, 15 fps: web, README, social)
        images/appstore/motion/opendraft-duo-fold.mp4   (1920x886, 30 fps, H.264 + silent AAC)

The device is two CSS 3D panels hinged down the middle. The cover panel swings
open like a book cover; its outside carries the cover-screen capture and its
inside the left half of the inner-screen capture. Every screen shown is an
unedited capture from the iPhone Duo simulator; only the device around it is
drawn. One page exposes `render(t)`, and each frame is a screenshot of it.
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT / "test-script" / "output" / "appstore" / "raw"
WORK = ROOT / "test-script" / "output" / "appstore" / "motion"
OUT = ROOT / "images" / "appstore" / "motion"
FONT = ROOT / "frontend" / "public" / "fonts" / "CourierPrime-Bold.ttf"
MARK = ROOT / "images" / "brand" / "opendraft-mark-white.svg"

WIDTH, HEIGHT, FPS, SECONDS = 1920, 886, 30, 17.0

PAGE = """<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Courier Prime'; font-weight: 700; src: url('%(font)s'); }
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  width: %(w)spx; height: %(h)spx; overflow: hidden; position: relative; color: #fff;
  font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
  background:
    radial-gradient(60%% 90%% at 70%% 45%%, rgba(93,63,179,.55) 0%%, rgba(93,63,179,0) 70%%),
    radial-gradient(60%% 60%% at 0%% 100%%, rgba(34,184,197,.18) 0%%, rgba(34,184,197,0) 65%%),
    linear-gradient(160deg, #1d1a5c 0%%, #121040 45%%, #0a0924 100%%);
}
.mark { position: absolute; left: 110px; top: 84px; display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 700; }
.mark img { height: 44px; }
.cap { position: absolute; left: 110px; top: 300px; width: 560px; opacity: 0; }
.eyebrow { font-family: 'Courier Prime', monospace; font-weight: 700; font-size: 24px; letter-spacing: .16em;
  text-transform: uppercase; color: #8fe6ee; display: flex; align-items: center; gap: 16px; }
.eyebrow::before { content: ''; width: 52px; height: 6px; border-radius: 6px; background: linear-gradient(90deg, #E35CA7, #FF8A1F, #22B8C5); }
h1 { margin: 18px 0 0; font-size: 78px; font-weight: 800; letter-spacing: -.025em; line-height: 1.04; white-space: pre-line; }
p { margin: 22px 0 0; font-size: 29px; line-height: 1.32; color: rgba(255,255,255,.78); }

.stage { position: absolute; inset: 0; perspective: 2600px; perspective-origin: 1270px 440px; }
.device, .flap { position: absolute; transform-style: preserve-3d; }
.panel { position: absolute; left: 0; top: %(top)spx; width: %(hw)spx; height: %(ph)spx; transform-origin: left center; }
.shell { position: absolute; inset: 0; background: #08080b; padding: 12px; backface-visibility: hidden;
  box-shadow: 0 0 0 1.5px #4a4a57, inset 0 0 0 2px #23232b; }
.outer-right { border-radius: 0 54px 54px 0; padding-left: 0; }
.outer-left  { border-radius: 54px 0 0 54px; padding-right: 0; }
.glass { position: relative; width: 100%%; height: 100%%; overflow: hidden; background: #2b2b2b; }
.outer-right .glass { border-radius: 0 43px 43px 0; }
.outer-left .glass  { border-radius: 43px 0 0 43px; }
.glass img { position: absolute; top: 0; height: 100%%; width: 200%%; }
.glass img.cover { width: 100%%; object-fit: cover; }
.right-half img { left: -100%%; }
.left-half img { left: 0; }
.camera { position: absolute; right: 5.2%%; top: 2.6%%; width: 34px; height: 34px; border-radius: 50%%; background: #000; }
.shade { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
</style>
<body>
<div class="mark"><img src="%(mark)s">OpenDraft</div>
<div class="cap" id="cap1"><div class="eyebrow">Folded</div><h1>Your script on
the cover screen.</h1><p>A compact toolbar, and the menu one tap away.</p></div>
<div class="cap" id="cap2"><div class="eyebrow">Fully open</div><h1>A full page.
Every scene beside it.</h1><p>The whole screenplay page, with the Navigator docked next to it.</p></div>
<div class="cap" id="cap3"><div class="eyebrow">Like a book</div><h1>Read along,
side by side.</h1><p>Script on one page, Table Read on the other.</p></div>
<div class="cap" id="cap4"><div class="eyebrow">Like a laptop</div><h1>Half open,
it stands alone.</h1><p>The script above the fold, Table Read below it.</p></div>

<div class="stage"><div class="device" id="device">
  <div class="panel" id="base"><div class="shell outer-right"><div class="glass right-half">
    <img src="%(open)s"><img id="baseBook" src="%(book)s"><img id="baseLap" src="%(laptop)s"><div class="shade" id="baseShade"></div>
  </div></div></div>
  <div class="panel flap" id="flap">
    <div class="shell outer-right" style="transform: translateZ(1px)"><div class="glass">
      <img class="cover" src="%(cover)s"><div class="camera"></div><div class="shade" id="coverShade"></div>
    </div></div>
    <div class="shell outer-left" style="transform: rotateY(180deg)"><div class="glass left-half">
      <img src="%(open)s"><img id="flapBook" src="%(book)s"><img id="flapLap" src="%(laptop)s"><div class="shade" id="flapShade"></div>
    </div></div>
  </div>
</div></div>
<script>
const HW = %(hw)s, CX = 1270, CY = 440;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const ramp = (t, a, b) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
const $ = (id) => document.getElementById(id);
window.render = (t) => {
  const open = ramp(t, 2.2, 4.0) - ramp(t, 15.0, 16.4);          // cover swings open, and shut again
  const book = ramp(t, 6.4, 7.2) - ramp(t, 10.0, 10.6);          // both pages lean in
  const turn = ramp(t, 10.6, 11.8) - ramp(t, 13.9, 15.0);        // device turns on its side
  const prop = ramp(t, 11.4, 12.4) - ramp(t, 13.4, 14.2);        // lower half folds toward the viewer
  const flapAngle = 180 * open - 14 * book;
  const baseAngle = 14 * book + 62 * prop;
  const x = CX - (HW / 2) * (1 - open), y = CY + 92 * turn;
  $('device').style.transform = `translate(${x}px, ${y}px) rotateZ(${90 * turn}deg)`;
  $('flap').style.transform = `rotateY(${-flapAngle}deg)`;
  $('base').style.transform = `rotateY(${-baseAngle}deg)`;
  const bookImage = ramp(t, 6.2, 6.9) - ramp(t, 10.2, 10.8);
  const lapImage = ramp(t, 10.5, 11.1) - ramp(t, 14.2, 14.8);
  for (const id of ['baseBook', 'flapBook']) $(id).style.opacity = bookImage;
  for (const id of ['baseLap', 'flapLap']) $(id).style.opacity = lapImage;
  // A panel turned away from the light gets a little darker: it reads as depth.
  const mid = Math.sin((flapAngle * Math.PI) / 180);
  $('coverShade').style.opacity = 0.35 * mid;
  $('flapShade').style.opacity = 0.30 * mid * (open < 1 ? 1 : 0) + 0.05 * book;
  $('baseShade').style.opacity = 0.05 * book + 0.14 * prop;
  const caps = [
    1 - ramp(t, 2.0, 2.6) + ramp(t, 15.8, 16.4),
    ramp(t, 3.3, 3.9) - ramp(t, 6.0, 6.5),
    ramp(t, 6.7, 7.3) - ramp(t, 10.0, 10.5),
    ramp(t, 11.2, 11.8) - ramp(t, 13.6, 14.1),
  ];
  caps.forEach((value, index) => {
    const el = $('cap' + (index + 1));
    el.style.opacity = value;
    el.style.transform = `translateY(${(1 - value) * 14}px)`;
  });
};
window.render(0);
</script></body>"""


def uri(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"missing file: {path}")
    return path.resolve().as_uri()


def prepare_laptop_capture() -> Path:
    """The laptop capture is portrait; the device is drawn on its side and turned
    upright, so the capture goes in turned a quarter the other way."""
    source = RAW / "duo-07-laptop-tableread.png"
    if not source.exists():
        raise FileNotFoundError(f"missing capture: {source}")
    turned = WORK / "laptop-turned.png"
    Image.open(source).rotate(90, expand=True).save(turned)
    return turned


def run(command: list) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{command[0]} failed:\n{result.stderr[-1500:]}")


def main() -> None:
    frames = WORK / "frames"
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)
    OUT.mkdir(parents=True, exist_ok=True)

    half_width = 500
    panel_height = round(half_width * 2007 / (2853 / 2))  # one half of the inner screen
    page_source = WORK / "fold.html"
    page_source.write_text(PAGE % {
        "font": uri(FONT), "mark": uri(MARK), "w": WIDTH, "h": HEIGHT,
        "hw": half_width, "ph": panel_height, "top": -panel_height // 2,
        "cover": uri(RAW / "duo-01-cover.png"), "open": uri(RAW / "duo-06-open-navigator.png"),
        "book": uri(RAW / "duo-03-book-tableread.png"), "laptop": uri(prepare_laptop_capture()),
    }, encoding="utf-8")

    total = round(SECONDS * FPS)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
            page.goto(page_source.as_uri())
            page.wait_for_load_state("networkidle")
            page.evaluate("document.fonts.ready")
            for index in range(total):
                page.evaluate("t => window.render(t)", index / FPS)
                page.screenshot(path=str(frames / f"f{index:04d}.png"))
                if index % 90 == 0:
                    print(f"frame {index}/{total}")
        finally:
            browser.close()

    pattern = str(frames / "f%04d.png")
    movie, gif = OUT / "opendraft-duo-fold.mp4", OUT / "opendraft-duo-fold.gif"
    # App previews want H.264 with a stereo AAC track, so a silent one is added.
    run(["ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern,
         "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
         "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-crf", "17",
         "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(movie)])
    palette = WORK / "palette.png"
    scale = "fps=15,scale=960:-1:flags=lanczos"
    run(["ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern, "-vf", f"{scale},palettegen=stats_mode=diff", str(palette)])
    run(["ffmpeg", "-y", "-framerate", str(FPS), "-i", pattern, "-i", str(palette),
         "-lavfi", f"{scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", str(gif)])
    for path in (movie, gif):
        print(f"{path}  {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, RuntimeError, OSError, PlaywrightError) as error:
        sys.exit(f"fold animation failed: {error}")
