#!/usr/bin/env python3
"""Record and assemble the iPhone Duo App Preview from real screen footage.

    app_preview.py record <cover|open|book|laptop>   # one take, with the Duo already in that posture
    app_preview.py build                             # cut the takes into the preview

An App Preview has to be captured footage of the app, so every moving pixel
here comes from `simctl io recordVideo` on the Duo simulator. The takes are
placed on a plain backdrop with a short caption, because the Duo's screens are
not the 1920x886 frame App Store Connect asks for.

Writes  images/appstore/motion/opendraft-duo-preview.mp4
        (1920x886, 30 fps, H.264 High, stereo AAC, under 30 seconds)
"""
import json
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import sim  # noqa: E402  (path set just above)

TAKES = ROOT / "test-script" / "output" / "appstore" / "takes"
OUT = ROOT / "images" / "appstore" / "motion" / "opendraft-duo-preview.mp4"
FONT = ROOT / "frontend" / "public" / "fonts" / "CourierPrime-Bold.ttf"
MARK = ROOT / "images" / "brand" / "opendraft-mark-white.svg"
WIDTH, HEIGHT, FPS, FADE = 1920, 886, 30, 0.5

READ_ALOUD = "od.caretAt({line}); od.click('.table-read-from-cursor', 'From cursor');"

# What happens on screen during each take, how long it runs, and its caption.
SEGMENTS = {
    "cover": {"display": 1, "seconds": 4.5, "action": "od.glide(520, 0, 3600);",
              "eyebrow": "Folded", "headline": "Your script on\nthe cover screen."},
    "open": {"display": 3, "seconds": 5.0, "action": "od.glide(620, 0, 4000);",
             "eyebrow": "Fully open", "headline": "A full page.\nScenes beside it."},
    "book": {"display": 3, "seconds": 5.5, "action": READ_ALOUD.format(line="'Eleven. The couple'"),
             "eyebrow": "Like a book", "headline": "Read along,\nside by side."},
    "laptop": {"display": 3, "seconds": 5.0, "action": READ_ALOUD.format(line="'The offer stands'"),
               "eyebrow": "Like a laptop", "headline": "Half open,\nit stands alone."},
}
ORDER = ["cover", "open", "book", "laptop"]


def record(name: str) -> None:
    segment = SEGMENTS[name]
    TAKES.mkdir(parents=True, exist_ok=True)
    movie = TAKES / f"{name}.mov"
    command = ["xcrun", "simctl", "io", sim.UDID["duo"], "recordVideo", "--codec=h264",
               f"--display={segment['display']}", "--force", str(movie)]
    recorder = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    started = time.time()
    # An inspector call takes an unpredictable few seconds, so the page is told
    # to act at a set clock time instead of whenever the call lands.
    action_at = started + 14.0
    try:
        time.sleep(2.0)  # the recorder needs a moment before its first frame
        print(sim.evaluate("duo", f"(setTimeout(() => {{ {segment['action']} }}, {int(action_at * 1000)} - Date.now()), 'scheduled')"))
        if time.time() > action_at - 0.5:
            raise RuntimeError("the inspector call took too long; the action was not on time")
        time.sleep(action_at + segment["seconds"] + 1.0 - time.time())
    finally:
        stopped = time.time()
        recorder.send_signal(signal.SIGINT)  # simctl finalises the file on interrupt
        try:
            output, _ = recorder.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            recorder.kill()
            raise RuntimeError("simctl recordVideo did not stop")
    if not movie.exists() or movie.stat().st_size < 10_000:
        raise RuntimeError(f"no usable recording for {name}: {output[-300:]}")
    # The file starts when the recorder got its first frame, not when it was launched.
    late_start = max(0.0, (stopped - started) - probe(movie)[2])
    lead_in = round(action_at - started - late_start - 0.3, 2)
    (TAKES / f"{name}.json").write_text(json.dumps({"lead_in": lead_in}))
    print(f"{movie.name}  {movie.stat().st_size / 1e6:.1f} MB  action at {lead_in + 0.3:.1f}s into the file")


def probe(movie: Path) -> tuple:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:stream_side_data=rotation:format=duration", "-of", "json", str(movie)],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    # A landscape take is stored as the portrait panel plus a quarter-turn flag,
    # which ffmpeg applies on decode: size the footage by what comes out.
    turn = [abs(int(float(item["rotation"]))) for item in stream.get("side_data_list", []) if "rotation" in item]
    if turn and turn[0] % 180 == 90:
        width, height = height, width
    return width, height, float(data["format"]["duration"])


def motion_start(movie: Path) -> float:
    """When the screen first changes in a take.

    simctl writes a frame only when the screen changes, so the still wait
    before the scheduled action is one long gap between frames. Clock
    arithmetic was off by nearly two seconds; the gap is exact.
    """
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time",
                          "-of", "csv=p=0", str(movie)], capture_output=True, text=True, check=True).stdout
    times = [float(line.strip(",")) for line in out.split() if line.strip(",")]
    for before, after in zip(times, times[1:]):
        if after - before > 3.0:
            return after
    raise RuntimeError(f"{movie.name} has no still lead-in followed by motion; record it again")


PLATE = """<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Courier Prime'; font-weight: 700; src: url('%(font)s'); }
html, body { margin: 0; }
body { width: %(w)spx; height: %(h)spx; overflow: hidden; position: relative; color: #fff;
  font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
  background: radial-gradient(60%% 90%% at 70%% 45%%, rgba(93,63,179,.5) 0%%, rgba(93,63,179,0) 70%%),
    linear-gradient(160deg, #1d1a5c 0%%, #121040 45%%, #0a0924 100%%); }
.mark { position: absolute; left: 90px; top: 78px; display: flex; align-items: center; gap: 14px; font-size: 28px; font-weight: 700; }
.mark img { height: 40px; }
.cap { position: absolute; left: 90px; top: 300px; width: 580px; }
.eyebrow { font-family: 'Courier Prime', monospace; font-weight: 700; font-size: 23px; letter-spacing: .16em;
  text-transform: uppercase; color: #8fe6ee; display: flex; align-items: center; gap: 16px; }
.eyebrow::before { content: ''; width: 50px; height: 6px; border-radius: 6px; background: linear-gradient(90deg, #E35CA7, #FF8A1F, #22B8C5); }
h1 { margin: 18px 0 0; font-size: 66px; font-weight: 800; letter-spacing: -.025em; line-height: 1.06; white-space: pre-line; }
</style><body><div class="mark"><img src="%(mark)s">OpenDraft</div>
<div class="cap"><div class="eyebrow">%(eyebrow)s</div><h1>%(headline)s</h1></div></body>"""


def build() -> None:
    from PIL import Image, ImageDraw
    from playwright.sync_api import sync_playwright

    missing = [name for name in ORDER if not (TAKES / f"{name}.mov").exists()]
    if missing:
        raise RuntimeError(f"record these takes first: {missing}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
            for name in ORDER:
                source = TAKES / f"plate-{name}.html"
                source.write_text(PLATE % {"font": FONT.as_uri(), "mark": MARK.as_uri(), "w": WIDTH, "h": HEIGHT,
                                           "eyebrow": SEGMENTS[name]["eyebrow"], "headline": SEGMENTS[name]["headline"]},
                                  encoding="utf-8")
                page.goto(source.as_uri())
                page.wait_for_load_state("networkidle")
                page.screenshot(path=str(TAKES / f"plate-{name}.png"))
        finally:
            browser.close()

    inputs, filters, offset = [], [], 0.0
    box_width, box_height, centre_x = 1130, 790, 1300  # where the footage sits, right of the caption
    for index, name in enumerate(ORDER):
        seconds = SEGMENTS[name]["seconds"]
        width, height, _ = probe(TAKES / f"{name}.mov")
        scale = min(box_width / width, box_height / height)
        w, h = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=30, fill=255)
        mask.save(TAKES / f"mask-{name}.png")
        lead_in = max(0.0, motion_start(TAKES / f"{name}.mov") - 0.35)
        inputs += ["-i", str(TAKES / f"{name}.mov"),
                   "-loop", "1", "-framerate", str(FPS), "-t", str(seconds), "-i", str(TAKES / f"mask-{name}.png"),
                   "-loop", "1", "-framerate", str(FPS), "-t", str(seconds), "-i", str(TAKES / f"plate-{name}.png")]
        video, mask_in, plate = index * 3, index * 3 + 1, index * 3 + 2
        filters.append(
            f"[{video}:v]fps={FPS},tpad=stop_mode=clone:stop_duration=8,trim=start={max(lead_in, 0)}:duration={seconds},"
            f"setpts=PTS-STARTPTS,scale={w}:{h}:flags=lanczos,format=rgba[v{index}];"
            f"[{mask_in}:v]format=gray[m{index}];[v{index}][m{index}]alphamerge[a{index}];"
            f"[{plate}:v][a{index}]overlay={centre_x - w // 2}:{(HEIGHT - h) // 2}:shortest=1,format=yuv420p,setsar=1[s{index}]")
    previous = "s0"
    for index, name in enumerate(ORDER[1:], start=1):
        offset += SEGMENTS[ORDER[index - 1]]["seconds"] - FADE
        filters.append(f"[{previous}][s{index}]xfade=transition=fade:duration={FADE}:offset={offset:.2f}[x{index}]")
        previous = f"x{index}"
    total = offset + SEGMENTS[ORDER[-1]]["seconds"]
    if not 15 <= total <= 30:
        raise RuntimeError(f"the preview would run {total:.1f}s; App Store Connect takes 15 to 30 seconds")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    silent = len(ORDER) * 3
    command = (["ffmpeg", "-y"] + inputs + ["-f", "lavfi", "-t", f"{total:.2f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
               "-filter_complex", ";".join(filters), "-map", f"[{previous}]", "-map", f"{silent}:a",
               "-r", str(FPS), "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-crf", "16",
               "-c:a", "aac", "-b:a", "256k", "-t", f"{total:.2f}", "-movflags", "+faststart", str(OUT)])
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr[-1800:]}")
    print(f"{OUT}  {OUT.stat().st_size / 1e6:.1f} MB  {total:.1f}s")


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "record" and sys.argv[2] in SEGMENTS:
            record(sys.argv[2])
        elif len(sys.argv) == 2 and sys.argv[1] == "build":
            build()
        else:
            sys.exit(__doc__)
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError) as error:
        sys.exit(f"app preview failed: {error}")
