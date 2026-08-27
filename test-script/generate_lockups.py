"""
Regenerate the OpenDraft wordmark lockups (mark + "OpenDraft" side by side and
stacked) as self-contained SVGs.

The wordmark is set in Figtree SemiBold and converted to outline paths, so the
published SVGs carry no font dependency. Figtree is licensed under the SIL Open
Font License with no Reserved Font Name, which is what makes it safe to ship
outlines from it in an MIT repo — see images/brand/FONT-LICENSE.txt.

This is separate from generate_brand_assets.py because it needs the font and a
network fetch on first run. The lockup SVGs it writes are committed, so the
raster pipeline never has to run this.

    ./venv/bin/python test-script/generate_lockups.py

Proportions are taken from the brand sheet: the wordmark's cap height is 34% of
the mark's height beside it and 20.7% below it.
"""

import os
import re
import sys
import urllib.request

try:
    import uharfbuzz as hb
    from fontTools.misc.transform import Transform
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
except ImportError as exc:  # pragma: no cover - environment problem, not logic
    sys.exit(f"Missing dependency: {exc}. Install with "
             "./venv/bin/pip install fonttools brotli uharfbuzz")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "images", "brand")
CACHE = os.path.join(ROOT, "test-script", "output", "fonts")

FONT_URL = "https://github.com/google/fonts/raw/main/ofl/figtree/Figtree%5Bwght%5D.ttf"
LICENSE_URL = "https://github.com/google/fonts/raw/main/ofl/figtree/OFL.txt"
WEIGHT = 600
TEXT = "OpenDraft"
INDIGO = "#2B2A86"

# Ratios measured off the brand sheet, all relative to the mark's height.
H_CAP, H_GAP, H_DROP = 0.34, 0.152, 0.062
S_CAP, S_GAP = 0.207, 0.03


def fetch(url, path, what):
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"  downloading {what}...")
    try:
        with urllib.request.urlopen(url, timeout=60) as r, open(path, "wb") as fh:
            fh.write(r.read())
    except Exception as exc:
        raise RuntimeError(f"could not download {what} from {url}: {exc}") from exc
    return path


def instanced_font():
    var = fetch(FONT_URL, os.path.join(CACHE, "Figtree-variable.ttf"), "Figtree")
    static = os.path.join(CACHE, f"Figtree-{WEIGHT}.ttf")
    if not os.path.exists(static):
        f = TTFont(var)
        if "fvar" in f:
            f = instancer.instantiateVariableFont(f, {"wght": WEIGHT})
        f.save(static)
    return static


def outline_wordmark(font_path):
    """Shape TEXT with HarfBuzz (so kerning applies) and flatten to one path.

    Returns the path data plus the ink bounds, in SVG coordinates with the
    baseline at y = 0 and y increasing downward.
    """
    blob = hb.Blob.from_file_path(font_path)
    face = hb.Face(blob)
    buf = hb.Buffer()
    buf.add_str(TEXT)
    buf.guess_segment_properties()
    hb.shape(hb.Font(face), buf)

    tt = TTFont(font_path)
    glyphs = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    cap = getattr(tt["OS/2"], "sCapHeight", None)
    if not cap:
        raise RuntimeError("font has no sCapHeight; cannot size the wordmark")

    parts, bounds, x = [], BoundsPen(glyphs), 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        t = Transform(1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, t))
        if pen.getCommands():
            parts.append(pen.getCommands())
        glyphs[name].draw(TransformPen(bounds, t))
        x += pos.x_advance

    if bounds.bounds is None:
        raise RuntimeError("wordmark produced no outlines")
    return " ".join(parts), bounds.bounds, cap


def mark_pieces():
    """Lift the gradients and the drawn mark straight out of the master SVG."""
    src = open(os.path.join(BRAND, "opendraft-mark.svg")).read()
    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', src)
    grads = re.search(r"<defs>(.*?)</defs>", src, re.S)
    group = re.search(r'(<g transform="matrix.*?</g>)', src, re.S)
    if not (vb and grads and group):
        raise RuntimeError("could not parse images/brand/opendraft-mark.svg")
    return float(vb.group(1)), float(vb.group(2)), grads.group(1).strip(), group.group(1)


def write(path, w, h, defs, mark, word, mono):
    fill = "currentColor" if mono else INDIGO
    root_fill = ' fill="currentColor"' if mono else ""
    body_mark = re.sub(r'fill="url\(#od[A-Za-z]+\)"', 'fill="currentColor"', mark) if mono else mark
    defs_block = "" if mono else f"  <defs>\n{defs}\n  </defs>\n"
    with open(path, "w") as fh:
        fh.write(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}"'
            f'{root_fill} role="img" aria-label="OpenDraft">\n'
            f"  <title>OpenDraft</title>\n{defs_block}{mark}\n{word.format(fill=fill)}\n</svg>\n"
            .replace(mark, body_mark)
        )


def build():
    mw, mh, defs, mark_g = mark_pieces()
    d, (ix0, iy0, ix1, iy1), cap = outline_wordmark(instanced_font())
    ink_w = ix1 - ix0

    def emit(name, total_w, total_h, mx, my, wx, baseline, s):
        mark = (f'  <g transform="translate({mx:.2f} {my:.2f})">\n'
                f"    {mark_g}\n  </g>")
        word = ('  <path fill="{fill}" transform="translate('
                f'{wx:.2f} {baseline:.2f}) scale({s:.6f})" d="{d}"/>')
        for mono in (False, True):
            suffix = "-mono" if mono else ""
            write(os.path.join(BRAND, f"opendraft-lockup-{name}{suffix}.svg"),
                  round(total_w, 2), round(total_h, 2), defs, mark, word, mono)
        print(f"  opendraft-lockup-{name}.svg  {total_w:.0f} x {total_h:.0f}")

    # Horizontal: wordmark to the right, cap-height box centred on the mark.
    s = (H_CAP * mh) / cap
    gap = H_GAP * mh
    baseline = mh / 2 + H_DROP * mh + (cap / 2) * s
    top = min(0.0, baseline + iy0 * s)
    emit("horizontal", mw + gap + ink_w * s, max(mh, baseline + iy1 * s) - top,
         0, -top, mw + gap - ix0 * s, baseline - top, s)

    # Stacked: wordmark centred beneath the mark.
    s = (S_CAP * mh) / cap
    total_w = max(mw, ink_w * s)
    baseline = mh + S_GAP * mh + (-iy0) * s
    emit("stacked", total_w, baseline + iy1 * s,
         (total_w - mw) / 2, 0, (total_w - ink_w * s) / 2 - ix0 * s, baseline, s)


def write_license():
    src = fetch(LICENSE_URL, os.path.join(CACHE, "Figtree-OFL.txt"), "the Figtree licence")
    out = os.path.join(BRAND, "FONT-LICENSE.txt")
    with open(out, "w") as fh:
        fh.write(
            "The 'OpenDraft' wordmark in opendraft-lockup-*.svg is set in Figtree\n"
            "SemiBold and converted to outline paths. Figtree carries no Reserved\n"
            "Font Name. Its licence follows and covers those outlines.\n\n"
            "Source: https://github.com/erikdkennedy/figtree\n"
            + "=" * 72 + "\n\n"
            + open(src).read()
        )
    print(f"  FONT-LICENSE.txt")


if __name__ == "__main__":
    if not os.path.isdir(BRAND):
        sys.exit(f"Brand SVG directory not found: {BRAND}")
    print("Lockups")
    try:
        build()
        write_license()
    except Exception as exc:
        sys.exit(f"FAILED: {exc}")
    print("\nNow re-run generate_brand_assets.py to refresh the PNG exports.")
