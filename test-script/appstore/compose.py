#!/usr/bin/env python3
"""Compose the App Store screenshots from the simulator captures.

    venv/bin/python test-script/appstore/compose.py            # every set
    venv/bin/python test-script/appstore/compose.py duo ipad   # only these sets

Reads   test-script/output/appstore/raw/*.png   (taken with sim.py)
Writes  images/appstore/<set>/NN-name.png       at the exact sizes App Store
        Connect accepts for that slot, as opaque RGB PNGs.

Each image is an HTML page (caption + the capture inside a drawn device)
rendered by headless Chromium, so the type is real text and the layout is CSS.
The captures are never edited: what is on the device's screen is what the app
drew.
"""
import html
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT / "test-script" / "output" / "appstore" / "raw"
WORK = ROOT / "test-script" / "output" / "appstore" / "pages"
OUT = ROOT / "images" / "appstore"
FONT = ROOT / "frontend" / "public" / "fonts" / "CourierPrime-Bold.ttf"
MARK = ROOT / "images" / "brand" / "opendraft-mark-white.svg"

# Slot sizes. "iphone" is the large-display size; the same pages are also
# rendered at the medium-display size App Store Connect lists for this app.
SIZES = {
    "iphone": (1320, 2868),
    "iphone-medium": (1206, 2622),
    "duo": (2853, 2007),
    "ipad": (2064, 2752),
}

CSS = """
@font-face { font-family: 'Courier Prime'; font-weight: 700; src: url('%(font)s'); }
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  width: %(w)spx; height: %(h)spx; overflow: hidden; position: relative; color: #fff;
  font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
  background:
    radial-gradient(90%% 60%% at 88%% 4%%, rgba(93,63,179,.75) 0%%, rgba(93,63,179,0) 60%%),
    radial-gradient(70%% 50%% at 0%% 100%%, rgba(34,184,197,.20) 0%%, rgba(34,184,197,0) 65%%),
    linear-gradient(160deg, #1d1a5c 0%%, #121040 45%%, #0a0924 100%%);
}
.copy { position: absolute; }
.eyebrow {
  font-family: 'Courier Prime', 'Courier New', monospace; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; color: #8fe6ee;
  display: flex; align-items: center; gap: .7em;
}
.eyebrow::before {
  content: ''; width: 2.2em; height: .22em; border-radius: 1em;
  background: linear-gradient(90deg, #E35CA7, #FF8A1F, #22B8C5);
}
h1 { margin: .28em 0 0; font-weight: 800; letter-spacing: -.025em; line-height: 1.04; white-space: pre-line; }
p { margin: .7em 0 0; font-weight: 400; line-height: 1.3; color: rgba(255,255,255,.78); }
.mark { position: absolute; display: flex; align-items: center; gap: .5em; font-weight: 700; letter-spacing: -.01em; }
.mark img { height: 1.5em; }
.dev {
  position: absolute; background: #08080b;
  box-shadow: 0 0 0 1.5px #4a4a57, inset 0 0 0 2px #23232b, 0 50px 130px rgba(0,0,0,.6);
}
.dev img.screen { display: block; width: 100%%; }
.island { position: absolute; left: 50%%; transform: translateX(-50%%); background: #000; border-radius: 999px; }
.camera { position: absolute; background: #000; border-radius: 50%%; box-shadow: inset 0 0 0 2px #15151b; }
.crease { position: absolute; pointer-events: none; }
.crease.v { top: 0; bottom: 0; left: 50%%; width: 1.1%%; transform: translateX(-50%%);
  background: linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,.07) 46%%, rgba(255,255,255,.035) 54%%, rgba(0,0,0,0)); }
.crease.h { left: 0; right: 0; top: 50%%; height: 1.1%%; transform: translateY(-50%%);
  background: linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.07) 46%%, rgba(255,255,255,.035) 54%%, rgba(0,0,0,0)); }
"""


def uri(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"missing capture: {path}")
    return path.resolve().as_uri()


def raw(name: str) -> str:
    return uri(RAW / f"{name}.png")


# ── Devices ────────────────────────────────────────────────────────────────
# Each takes the capture and a box (left, top, width) in canvas pixels and
# returns markup. Proportions follow the devices as Device Hub draws them.

def phone(name: str, left: float, top: float, width: float) -> str:
    pad, radius = width * 0.022, width * 0.15
    return (
        f'<div class="dev" style="left:{left}px;top:{top}px;width:{width}px;padding:{pad}px;border-radius:{radius}px">'
        f'<img class="screen" src="{raw(name)}" style="border-radius:{radius - pad}px">'
        f'<div class="island" style="top:{pad + width * 0.028}px;width:{width * 0.275}px;height:{width * 0.08}px"></div>'
        "</div>"
    )


def tablet(name: str, left: float, top: float, width: float) -> str:
    pad, radius = width * 0.026, width * 0.058
    return (
        f'<div class="dev" style="left:{left}px;top:{top}px;width:{width}px;padding:{pad}px;border-radius:{radius}px">'
        f'<img class="screen" src="{raw(name)}" style="border-radius:{radius - pad}px">'
        "</div>"
    )


def duo_open(name: str, left: float, top: float, width: float, crease: str = "v") -> str:
    """The Duo's inner screen. `crease` is 'v' held as a book, 'h' as a laptop."""
    short = width * (2007 / 2853) if crease == "v" else width
    pad, radius = short * 0.02, short * 0.09
    return (
        f'<div class="dev" style="left:{left}px;top:{top}px;width:{width}px;padding:{pad}px;border-radius:{radius}px">'
        f'<div style="position:relative;overflow:hidden;border-radius:{radius - pad}px">'
        f'<img class="screen" src="{raw(name)}"><div class="crease {crease}"></div></div>'
        "</div>"
    )


def duo_cover(name: str, left: float, top: float, width: float) -> str:
    """The Duo folded: the cover screen, with the hinge spine down the left edge."""
    pad, spine, radius = width * 0.028, width * 0.07, width * 0.13
    hole = width * 0.078
    return (
        f'<div class="dev" style="left:{left}px;top:{top}px;width:{width}px;'
        f'padding:{pad}px {pad}px {pad}px {spine}px;border-radius:{radius * 0.35}px {radius}px {radius}px {radius * 0.35}px">'
        f'<div style="position:relative;overflow:hidden;border-radius:{radius * 0.3}px {radius - pad}px {radius - pad}px {radius * 0.3}px">'
        f'<img class="screen" src="{raw(name)}">'
        f'<div class="camera" style="width:{hole}px;height:{hole}px;right:5.2%;top:2.6%"></div></div>'
        "</div>"
    )


# ── Pages ──────────────────────────────────────────────────────────────────

def copy(eyebrow: str, headline: str, body: str, left: float, top: float, width: float, scale: float) -> str:
    """Caption block. `scale` is the headline size in pixels; the rest follows it."""
    return (
        f'<div class="copy" style="left:{left}px;top:{top}px;width:{width}px">'
        f'<div class="eyebrow" style="font-size:{scale * 0.3}px">{html.escape(eyebrow)}</div>'
        f'<h1 style="font-size:{scale}px">{html.escape(headline)}</h1>'
        f'<p style="font-size:{scale * 0.37}px">{html.escape(body)}</p></div>'
    )


def mark(left: float, top: float, size: float) -> str:
    return f'<div class="mark" style="left:{left}px;top:{top}px;font-size:{size}px"><img src="{uri(MARK)}">OpenDraft</div>'


# No prices and no competitor names in captions: App Review guideline 2.3.7 covers screenshots too.
CAPTIONS = {
    "write": ("Fade in", "Write your\nscreenplay.", "Industry-standard formatting that takes care of itself."),
    "tableread": ("Table Read", "Hear every line\nread aloud.", "A voice for each character, with every word lit as it is spoken."),
    "cards": ("Index Cards", "See your story\nscene by scene.", "Colour-coded cards with a synopsis, a page count and a running time."),
    "outline": ("Outline", "Shape the\nwhole script.", "Acts, sequences and scenes in one list. Drag a scene to move it."),
    "navigator": ("Navigator", "Jump to\nany scene.", "Every scene with its synopsis, one tap away."),
    "duo": ("iPhone Duo", "Folded or open,\nit fits.", "OpenDraft lays itself out for each way you hold your iPhone Duo."),
    "free": ("Yours to keep", "Your script,\nin any format.", "Works offline. Export to PDF, Fountain and the formats studios ask for."),
}


def portrait_page(key: str, device: str, width: int, height: int) -> str:
    """iPhone-shaped canvas: caption on top, one phone underneath."""
    eyebrow, headline, body = CAPTIONS[key]
    side = width * 0.085
    text = copy(eyebrow, headline, body, side, height * 0.052, width - 2 * side, width * 0.098)
    device_width = width * 0.665  # as tall as fits under the caption without leaving the canvas
    return text + phone(device, (width - device_width) / 2, height * 0.30, device_width)


def duo_on_phone_page(width: int, height: int) -> str:
    """iPhone-shaped canvas showing the Duo folded and open."""
    eyebrow, headline, body = CAPTIONS["duo"]
    side = width * 0.085
    text = copy(eyebrow, headline, body, side, height * 0.052, width - 2 * side, width * 0.098)
    cover_width, open_width = width * 0.40, width * 0.90
    return (
        text
        + duo_cover("duo-01-cover", (width - cover_width) / 2, height * 0.30, cover_width)
        + duo_open("duo-06-open-navigator", (width - open_width) / 2, height * 0.64, open_width)
    )


def tablet_page(key: str, device: str, width: int, height: int) -> str:
    eyebrow, headline, body = CAPTIONS[key]
    side = width * 0.08
    text = copy(eyebrow, headline, body, side, height * 0.03, width - 2 * side, width * 0.058)
    device_width = width * 0.70
    return text + tablet(device, (width - device_width) / 2, height * 0.215, device_width)


def duo_page(eyebrow: str, headline: str, body: str, devices: str, width: int, height: int) -> str:
    """iPhone Duo canvas (landscape): caption in a left column, devices to its right."""
    return (
        mark(width * 0.05, height * 0.075, width * 0.017)
        + copy(eyebrow, headline, body, width * 0.05, height * 0.30, width * 0.30, width * 0.044)
        + devices
    )


def build_pages() -> dict:
    """Every page as (set, file name, markup), in the order the store shows them."""
    pages = {}
    for size_name in ("iphone", "iphone-medium"):
        w, h = SIZES[size_name]
        pages[size_name] = [
            ("01-write", portrait_page("write", "iphone-01-editor", w, h)),
            ("02-table-read", portrait_page("tableread", "iphone-02-tableread", w, h)),
            ("03-iphone-duo", duo_on_phone_page(w, h)),
            ("04-index-cards", portrait_page("cards", "iphone-03-cards", w, h)),
            ("05-outline", portrait_page("outline", "iphone-04-outline", w, h)),
            ("06-free", portrait_page("free", "iphone-06-export", w, h)),
        ]

    w, h = SIZES["duo"]
    right, full = w * 0.385, w * 0.585  # where the big device starts, and how wide it is
    open_top = (h - full * 2007 / 2853) / 2 - h * 0.01
    pages["duo"] = [
        ("01-unfold", duo_page(
            "iPhone Duo", "Unfold your\nscreenplay.", "Made for iPhone Duo: OpenDraft lays itself out for each way you hold it.",
            duo_cover("duo-01-cover", w * 0.05, h * 0.575, w * 0.125)
            + duo_open("duo-05-open", right, open_top, full), w, h)),
        ("02-book", duo_page(
            "Like a book", "Read along,\nside by side.", "Script on one page, Table Read on the other, each line in its character's voice.",
            duo_open("duo-03-book-tableread", right, open_top, full), w, h)),
        ("03-laptop", duo_page(
            "Like a laptop", "Half open,\nit stands\non its own.", "The script stays above the fold. Table Read sits below it.",
            duo_open("duo-07-laptop-tableread", w * 0.47, h * 0.035, h * 0.93 * 2007 / 2853, crease="h"), w, h)),
        ("04-open", duo_page(
            "Fully open", "A full page.\nEvery scene\nbeside it.", "A whole screenplay page with the Navigator docked next to it.",
            duo_open("duo-06-open-navigator", right, open_top, full), w, h)),
        ("05-folded", duo_page(
            "Folded", "Your script\nfills the\ncover screen.", "A compact toolbar on top, and the menu one tap away.",
            # the folded device is 1.368 times as tall as it is wide, spine and bezel included
            duo_cover("duo-01-cover", right + (full - h * 0.9 / 1.368) / 2, h * 0.05, h * 0.9 / 1.368), w, h)),
    ]

    w, h = SIZES["ipad"]
    pages["ipad"] = [
        ("01-write", tablet_page("write", "ipad-01-editor", w, h)),
        ("02-table-read", tablet_page("tableread", "ipad-03-tableread", w, h)),
        ("03-index-cards", tablet_page("cards", "ipad-04-cards", w, h)),
        ("04-navigator", tablet_page("navigator", "ipad-02-navigator", w, h)),
    ]
    return pages


def render(wanted: list) -> int:
    WORK.mkdir(parents=True, exist_ok=True)
    pages = build_pages()
    written = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for set_name, items in pages.items():
                if wanted and set_name not in wanted:
                    continue
                width, height = SIZES[set_name]
                target = OUT / set_name
                target.mkdir(parents=True, exist_ok=True)
                page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
                for file_name, markup in items:
                    source = WORK / f"{set_name}-{file_name}.html"
                    style = CSS % {"font": uri(FONT), "w": width, "h": height}
                    source.write_text(f"<!doctype html><meta charset='utf-8'><style>{style}</style><body>{markup}</body>",
                                      encoding="utf-8")
                    page.goto(source.as_uri())
                    page.wait_for_load_state("networkidle")
                    page.evaluate("document.fonts.ready")
                    out = target / f"{file_name}.png"
                    page.screenshot(path=str(out), full_page=False)
                    # App Store Connect refuses an alpha channel, and wants the exact size.
                    image = Image.open(out).convert("RGB")
                    if image.size != (width, height):
                        raise ValueError(f"{out.name} came out {image.size}, expected {(width, height)}")
                    image.save(out, optimize=True)
                    written += 1
                    print(f"{set_name}/{out.name}  {width}x{height}")
                page.close()
        finally:
            browser.close()
    return written


if __name__ == "__main__":
    try:
        count = render(sys.argv[1:])
    except (FileNotFoundError, ValueError, OSError, PlaywrightError) as error:
        sys.exit(f"compose failed: {error}")
    if not count:
        sys.exit(f"no set matched {sys.argv[1:]}; choose from {list(SIZES)}")
    print(f"{count} images in {OUT}")
