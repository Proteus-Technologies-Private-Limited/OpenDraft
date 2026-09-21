"""Check what the bundled Noto Sans Devanagari subset can actually draw.

Reports cmap coverage for the sample Hindi text and whether the glyphs the
cmap points at have outlines (a subset can keep a mapping but drop the glyf
entry, which draws as blank).
"""
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fontTools missing: ./venv/bin/pip install fonttools")

SAMPLE = (
    "अंग्रेजी कीबोर्ड पर हिंदी शब्दों को बोल के अनुसार "
    "जीवन से भरी तेरी आँखें मजबूर करें जीने के लिए "
    "सागर भी तरसते रहते हैं तेरे रूप का रस पीने के लिए"
)

def report(path: Path) -> int:
    try:
        font = TTFont(path)
    except Exception as exc:
        print(f"  !! cannot parse: {exc}")
        return 1

    cmap = font.getBestCmap()
    glyf = font["glyf"] if "glyf" in font else None
    print(f"  tables: {sorted(font.keys())}")
    print(f"  cmap entries: {len(cmap)}")
    print(f"  glyph order: {len(font.getGlyphOrder())}")

    chars = sorted({c for c in SAMPLE if not c.isspace()})
    missing = [c for c in chars if ord(c) not in cmap]
    blank = []
    if glyf is not None:
        for c in chars:
            gid = cmap.get(ord(c))
            if gid is None:
                continue
            g = glyf[gid]
            if g.numberOfContours == 0 and ord(c) not in (0x20, 0xA0):
                blank.append(c)

    print(f"  sample chars: {len(chars)}")
    print(f"  not in cmap : {len(missing)} {''.join(missing)}")
    print(f"  empty glyph : {len(blank)} {''.join(blank)}")
    for c in chars:
        gid = cmap.get(ord(c))
        mark = "OK " if gid else "MISS"
        print(f"    {mark} U+{ord(c):04X} {c!r} -> {gid}")
    return 0 if not missing and not blank else 2

rc = 0
for arg in sys.argv[1:]:
    p = Path(arg)
    print(f"== {p.name} ({p.stat().st_size:,} bytes)")
    rc |= report(p)
    print()
sys.exit(rc)
