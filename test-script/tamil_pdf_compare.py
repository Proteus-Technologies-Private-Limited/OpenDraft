"""Compare the Tamil PDFs written by tamil_pdf_compare.test.ts (issue #226).

    venv/bin/python -I test-script/tamil_pdf_compare.py test-script/output/issue-226/tamil

For each case, compares <dir>/head/<case>.pdf (committed code) with
<dir>/new/<case>.pdf (working tree):

  * bytes     - identical once the creation date and file ID are removed?
  * glyphs    - the same glyphs painted, in the same order, in the same fonts?
  * fonts     - the same fonts embedded, byte for byte?
  * pixels    - rendered with pdftoppm, where do the pages differ?

Writes side-by-side PNGs to <dir>/diff-<case>.png for anything that differs.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

STAMP = re.compile(rb"/CreationDate \([^)]*\)|/ModDate \([^)]*\)|/ID \[[^\]]*\]")
SHOW = re.compile(rb"<([0-9A-Fa-f]+)>\s*Tj|\(((?:\\.|[^()\\])*)\)\s*Tj|\[([^\]]*)\]\s*TJ")
FONT = re.compile(rb"/(F\d+) [\d.]+ Tf")


def normalised(data: bytes) -> bytes:
    return STAMP.sub(b"", data)


def glyph_stream(data: bytes) -> list[tuple[str, str]]:
    """(font, shown glyphs) per font switch, merged across pieces, in drawing order.

    Pieces are merged per font because the new code may split a line into more
    pieces at a colour boundary; what matters is that the same glyphs come out
    in the same order and face.
    """
    out: list[tuple[str, str]] = []
    font = "?"
    pos = 0
    tokens = sorted(
        [(m.start(), "font", m) for m in FONT.finditer(data)]
        + [(m.start(), "show", m) for m in SHOW.finditer(data)],
        key=lambda x: x[0],
    )
    for _, kind, m in tokens:
        if kind == "font":
            font = m.group(1).decode()
            continue
        if m.group(1) is not None:
            shown = m.group(1).decode().upper()
        elif m.group(2) is not None:
            shown = m.group(2).decode("latin-1")
        else:
            shown = "".join(h.decode().upper() for h in re.findall(rb"<([0-9A-Fa-f]+)>", m.group(3)))
            shown += "".join(s.decode("latin-1") for s in re.findall(rb"\(((?:\\.|[^()\\])*)\)", m.group(3)))
        if out and out[-1][0] == font:
            out[-1] = (font, out[-1][1] + shown)
        else:
            out.append((font, shown))
    return out


def font_files(data: bytes) -> list[int]:
    """Lengths of the embedded font programs, as a fingerprint."""
    return sorted(int(n) for n in re.findall(rb"/FontFile2 \d+ 0 R|/Length1 (\d+)", data) if n)


def render(pdf: Path, out_dir: Path) -> Image.Image:
    stem = out_dir / pdf.stem
    subprocess.run(["pdftoppm", "-png", "-r", "100", "-f", "1", "-l", "1", str(pdf), str(stem)], check=True)
    return Image.open(next(out_dir.glob(f"{pdf.stem}*.png"))).convert("RGB")


def main(root: Path) -> int:
    head_dir, new_dir = root / "head", root / "new"
    failures = 0
    for head in sorted(head_dir.glob("*.pdf")):
        new = new_dir / head.name
        a, b = head.read_bytes(), new.read_bytes()
        same_bytes = normalised(a) == normalised(b)
        ga, gb = glyph_stream(a), glyph_stream(b)
        same_glyphs = ga == gb
        same_fonts = font_files(a) == font_files(b)
        with tempfile.TemporaryDirectory() as tmp:
            ta, tb = Path(tmp, "a"), Path(tmp, "b")
            ta.mkdir(), tb.mkdir()
            ia, ib = render(head, ta), render(new, tb)
        diff = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v > 40 else 0)
        box = diff.getbbox()
        print(f"\n== {head.stem}")
        print(f"   bytes identical : {same_bytes}")
        print(f"   glyphs identical: {same_glyphs}")
        print(f"   fonts identical : {same_fonts}")
        print(f"   pixels differ in: {box if box else 'nowhere'}")
        if not same_glyphs:
            for i, (x, y) in enumerate(zip(ga, gb)):
                if x != y:
                    print(f"   first glyph difference at #{i}: head={x[0]} {x[1][:80]!r}")
                    print(f"                                 new ={y[0]} {y[1][:80]!r}")
                    break
            if len(ga) != len(gb):
                print(f"   font switches: head={len(ga)} new={len(gb)}")
        if box:
            w, h = ia.size
            side = Image.new("RGB", (w * 2 + 10, h), "white")
            side.paste(ia, (0, 0))
            side.paste(ib, (w + 10, 0))
            side.save(root / f"diff-{head.stem}.png")
        if not same_fonts:
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
