"""
Regenerate every OpenDraft icon and logo raster from the master SVGs.

Source of truth: images/brand/*.svg
    opendraft-mark.svg                    full-colour mark, transparent, tight bbox
    opendraft-mark-mono.svg               single colour (currentColor)
    opendraft-mark-white.svg              flat white, for dark surfaces
    opendraft-icon.svg                    1024 square plate, gradient + white mark
    opendraft-icon-macos.svg              1024 canvas, inset squircle plate
    opendraft-icon-plate.svg              1024 gradient plate on its own, no mark
    opendraft-icon-android-foreground.svg 432 canvas, white mark in the 66% safe zone
    opendraft-lockup-horizontal.svg       mark + "OpenDraft" side by side
    opendraft-lockup-stacked.svg          mark above "OpenDraft"
    (each lockup also has a -mono variant; regenerate with generate_lockups.py)

Run from anywhere:  ./venv/bin/python test-script/generate_brand_assets.py

Nothing here is destructive beyond overwriting the icon files it is meant to own;
every write is reported so a bad run is obvious.
"""

import os
import shutil
import subprocess
import sys
import tempfile

try:
    import cairosvg
    from PIL import Image
except ImportError as exc:  # pragma: no cover - environment problem, not logic
    sys.exit(f"Missing dependency: {exc}. Install with ./venv/bin/pip install cairosvg pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "images", "brand")

SQUARE = os.path.join(BRAND, "opendraft-icon.svg")
MACOS = os.path.join(BRAND, "opendraft-icon-macos.svg")
ANDROID_FG = os.path.join(BRAND, "opendraft-icon-android-foreground.svg")
PLATE = os.path.join(BRAND, "opendraft-icon-plate.svg")
MARK = os.path.join(BRAND, "opendraft-mark.svg")
LOCKUP_H = os.path.join(BRAND, "opendraft-lockup-horizontal.svg")
LOCKUP_S = os.path.join(BRAND, "opendraft-lockup-stacked.svg")

# Brand palette, kept in one place so callers can reference it.
INDIGO = "#2B2A86"

written = []


def _p(*parts):
    return os.path.join(ROOT, *parts)


def render(svg_path, out_path, size, height=None, opaque=False):
    """Render an SVG to PNG. `opaque` flattens alpha onto the plate colour."""
    if not os.path.exists(svg_path):
        raise FileNotFoundError(f"missing master SVG: {svg_path}")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        png = cairosvg.svg2png(
            url=svg_path,
            output_width=size,
            output_height=height if height is not None else size,
        )
    except Exception as exc:
        raise RuntimeError(f"failed rendering {svg_path} at {size}px: {exc}") from exc

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(png)
        tmp_path = tmp.name
    try:
        img = Image.open(tmp_path).convert("RGBA")
        if opaque:
            flat = Image.new("RGB", img.size, INDIGO)
            flat.paste(img, mask=img.split()[3])
            img = flat
        img.save(out_path)
    finally:
        os.unlink(tmp_path)
    written.append(out_path)


def render_mark(out_path, height, opaque=False):
    """Render the tight mark at a given height, preserving its aspect ratio."""
    with open(MARK) as fh:
        head = fh.read(400)
    # viewBox="0 0 W H"
    vb = head.split('viewBox="')[1].split('"')[0].split()
    w, h = float(vb[2]), float(vb[3])
    render(MARK, out_path, int(round(height * w / h)), height=height, opaque=opaque)


def make_ico(svg_path, out_path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    frames = []
    for s in sizes:
        png = cairosvg.svg2png(url=svg_path, output_width=s, output_height=s)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(png)
            tmp_path = tmp.name
        try:
            frames.append(Image.open(tmp_path).convert("RGBA").copy())
        finally:
            os.unlink(tmp_path)
    frames[-1].save(out_path, format="ICO", sizes=[(s, s) for s in sizes])
    written.append(out_path)


def make_icns(svg_path, out_path):
    """Build a macOS .icns via iconutil (macOS only; skipped elsewhere)."""
    if not shutil.which("iconutil"):
        print("  ! iconutil not found - skipping icon.icns")
        return
    pairs = [
        ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
    ]
    with tempfile.TemporaryDirectory() as tmpdir:
        iconset = os.path.join(tmpdir, "icon.iconset")
        os.makedirs(iconset)
        for name, size in pairs:
            render(svg_path, os.path.join(iconset, name), size)
            written.pop()  # these are scratch files, not deliverables
        try:
            subprocess.run(
                ["iconutil", "-c", "icns", iconset, "-o", out_path],
                check=True, capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(f"iconutil failed: {exc.stderr.decode(errors='replace')}") from exc
    written.append(out_path)


# --------------------------------------------------------------------------
# Target sets
# --------------------------------------------------------------------------

def desktop_icons():
    """src-tauri/icons - Tauri bundles these for macOS, Windows and Linux."""
    print("Desktop (src-tauri/icons)")
    for name, size in [
        ("32x32.png", 32), ("64x64.png", 64), ("128x128.png", 128),
        ("128x128@2x.png", 256), ("icon.png", 512), ("icon1024.png", 1024),
        ("StoreLogo.png", 50), ("Square30x30Logo.png", 30), ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71), ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107), ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150), ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
    ]:
        render(SQUARE, _p("src-tauri", "icons", name), size)
    make_ico(SQUARE, _p("src-tauri", "icons", "icon.ico"))
    make_icns(MACOS, _p("src-tauri", "icons", "icon.icns"))


ANDROID_DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""

BACKGROUND_COLOR_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{INDIGO}</color>
</resources>
"""


def android_icons(base):
    """Legacy launcher icons plus the adaptive foreground/background layers."""
    print(f"Android ({os.path.relpath(base, ROOT)})")
    for density, (legacy, adaptive) in ANDROID_DENSITIES.items():
        d = os.path.join(base, f"mipmap-{density}")
        render(SQUARE, os.path.join(d, "ic_launcher.png"), legacy, opaque=True)
        render(SQUARE, os.path.join(d, "ic_launcher_round.png"), legacy, opaque=True)
        # Adaptive layers: the system masks and animates these independently.
        render(ANDROID_FG, os.path.join(d, "ic_launcher_foreground.png"), adaptive)
        # The background layer carries the gradient only - the mark lives in the
        # foreground layer, and drawing it in both would double it up.
        render(PLATE, os.path.join(d, "ic_launcher_background.png"), adaptive, opaque=True)

    anydpi = os.path.join(base, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        path = os.path.join(anydpi, name)
        with open(path, "w") as fh:
            fh.write(ADAPTIVE_XML)
        written.append(path)

    values = os.path.join(base, "values")
    os.makedirs(values, exist_ok=True)
    path = os.path.join(values, "ic_launcher_background.xml")
    with open(path, "w") as fh:
        fh.write(BACKGROUND_COLOR_XML)
    written.append(path)


IOS_ICONS = {
    "AppIcon-20x20@1x.png": 20, "AppIcon-20x20@2x.png": 40, "AppIcon-20x20@2x-1.png": 40,
    "AppIcon-20x20@3x.png": 60, "AppIcon-29x29@1x.png": 29, "AppIcon-29x29@2x.png": 58,
    "AppIcon-29x29@2x-1.png": 58, "AppIcon-29x29@3x.png": 87, "AppIcon-40x40@1x.png": 40,
    "AppIcon-40x40@2x.png": 80, "AppIcon-40x40@2x-1.png": 80, "AppIcon-40x40@3x.png": 120,
    "AppIcon-60x60@2x.png": 120, "AppIcon-60x60@3x.png": 180, "AppIcon-76x76@1x.png": 76,
    "AppIcon-76x76@2x.png": 152, "AppIcon-83.5x83.5@2x.png": 167, "AppIcon-512@2x.png": 1024,
}


def ios_icons():
    """App Store rejects icons with an alpha channel, so these are flattened.

    Two locations: images/ios-icons is the staging copy, and the Xcode asset
    catalogue under src-tauri/gen/apple is what actually gets compiled into the
    app. Unlike gen/android, that catalogue is tracked, so it has to be written
    here too or the iOS build keeps the old icon.
    """
    appiconset = _p("src-tauri", "gen", "apple", "Assets.xcassets", "AppIcon.appiconset")
    for base in (_p("images", "ios-icons"), appiconset):
        if not os.path.isdir(base):
            print(f"  ! {os.path.relpath(base, ROOT)} not present - skipping")
            continue
        print(f"iOS ({os.path.relpath(base, ROOT)})")
        for name, size in IOS_ICONS.items():
            render(SQUARE, os.path.join(base, name), size, opaque=True)

    # Launch screen: shown centred on white, so the squircle keeps its shape.
    launch = _p("src-tauri", "gen", "apple", "Assets.xcassets", "LaunchIcon.imageset")
    if os.path.isdir(launch):
        print("iOS (LaunchIcon.imageset)")
        for suffix, size in (("@1x", 256), ("@2x", 512), ("@3x", 768)):
            render(MACOS, os.path.join(launch, f"LaunchIcon{suffix}.png"), size)


def web_assets():
    """Favicons, the touch icon, the splash screen and the in-app logo."""
    print("Web / splash")
    for base in ("frontend/public", "backend/static", "frontend/dist"):
        target = _p(*base.split("/"))
        if base != "frontend/public" and not os.path.isdir(target):
            continue  # build output not present yet; the build will copy it over
        shutil.copyfile(SQUARE, os.path.join(target, "favicon.svg"))
        written.append(os.path.join(target, "favicon.svg"))
        make_ico(SQUARE, os.path.join(target, "favicon.ico"), sizes=(16, 32, 48))
        render(MACOS, os.path.join(target, "splash-logo.png"), 256)
        # iOS "Add to Home Screen" ignores SVG and needs an opaque PNG.
        render(SQUARE, os.path.join(target, "apple-touch-icon.png"), 180, opaque=True)

    # Bundled by Vite so WelcomeDialog gets a hashed, base-correct URL.
    assets = _p("frontend", "src", "assets")
    os.makedirs(assets, exist_ok=True)
    for src in (SQUARE, MARK):
        dst = os.path.join(assets, os.path.basename(src))
        shutil.copyfile(src, dst)
        written.append(dst)


def lockups():
    """PNG exports of the wordmark lockups, for press kits and social."""
    print("Lockups")
    for svg, name, width in ((LOCKUP_H, "opendraft-lockup-horizontal.png", 2400),
                             (LOCKUP_S, "opendraft-lockup-stacked.png", 1200)):
        if not os.path.exists(svg):
            print(f"  ! {os.path.basename(svg)} missing - run generate_lockups.py")
            continue
        with open(svg) as fh:
            vb = fh.read(400).split('viewBox="')[1].split('"')[0].split()
        w, h = float(vb[2]), float(vb[3])
        render(svg, os.path.join(BRAND, name), width, height=int(round(width * h / w)))


def marketing_assets():
    """Files referenced by the README, landing pages and user manual."""
    print("Marketing / docs")
    render(SQUARE, _p("images", "OpenDraft-1024x1024.png"), 1024)
    render(SQUARE, _p("images", "OpenDraft.png"), 512)
    render_mark(_p("images", "OpenDraft_icon.png"), 1024)
    render(SQUARE, _p("images", "android-icons", "ic_launcher-playstore.png"), 512, opaque=True)
    render(SQUARE, _p("fastlane", "metadata", "android", "en-US", "images", "icon.png"), 512, opaque=True)


def main():
    if not os.path.isdir(BRAND):
        sys.exit(f"Brand SVG directory not found: {BRAND}")
    try:
        desktop_icons()
        android_icons(_p("images", "android-icons"))
        android_icons(_p("src-tauri", "icons", "android"))
        ios_icons()
        web_assets()
        lockups()
        marketing_assets()
    except Exception as exc:
        print(f"\nFAILED: {exc}", file=sys.stderr)
        print(f"{len(written)} file(s) had already been written.", file=sys.stderr)
        raise

    print(f"\nWrote {len(written)} files.")
    print("Play Store feature graphic is generated separately:")
    print("  ./venv/bin/python test-script/generate_feature_graphic.py")


if __name__ == "__main__":
    main()
