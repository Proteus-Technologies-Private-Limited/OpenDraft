"""Write a small screenplay-formatted PDF (Courier 12, standard indents) for
exercising the PDF import review dialog. No third-party libraries.

    python test-script/make_screenplay_pdf.py [output.pdf]
"""

import sys
from pathlib import Path

# (indent in inches from the page's left edge, text). Blank text = blank line.
LINES = [
    (1.5, "FADE IN:"),
    (1.5, ""),
    (1.5, "INT. LIGHTHOUSE - NIGHT"),
    (1.5, ""),
    (1.5, "Rain hammers the glass. MARA (40s) climbs the last steps,"),
    (1.5, "lantern swinging."),
    (1.5, ""),
    (3.7, "MARA"),
    (2.5, "Somebody has been keeping this"),
    (2.5, "light burning."),
    (1.5, ""),
    (1.5, "She sets the lantern down beside a fresh cup of tea."),
    (1.5, ""),
    (3.7, "ELI (O.S.)"),
    (3.1, "(from below)"),
    (2.5, "You found my tea."),
    (1.5, ""),
    (1.5, "EXT. CLIFF PATH - CONTINUOUS"),
    (1.5, ""),
    (1.5, "ELI (60s) leans on a walking stick, grinning up at her."),
    (1.5, ""),
    (3.7, "ELI"),
    (2.5, "Forty years and nobody ever"),
    (2.5, "climbed up to check."),
    (1.5, ""),
    (6.0, "CUT TO:"),
]

for n in range(1, 31):
    LINES += [(1.5, ""), (1.5, f"INT. KEEPER'S ROOM - NIGHT {n}"), (1.5, ""),
              (1.5, f"Line {n}: the storm keeps rising outside the window.")]


def escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pages(lines, per_page=54):
    for start in range(0, len(lines), per_page):
        yield lines[start:start + per_page]


def build(path: Path) -> None:
    objects = []  # 1-based PDF object bodies

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    pages_id = add(b"")  # filled in once the page ids are known
    page_ids = []
    for chunk in pages(LINES):
        ops = ["BT", "/F1 12 Tf"]
        y = 792 - 72  # one inch from the top of a US Letter page
        for indent, text in chunk:
            if text:
                ops.append(f"1 0 0 1 {indent * 72:.1f} {y} Tm ({escape(text)}) Tj")
            y -= 12
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (pages_id, font, content)))
    kids = " ".join(f"{p} 0 R" for p in page_ids).encode()
    objects[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1, catalog, xref)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(out))


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "test-script/output/lighthouse.pdf")
    try:
        build(target)
    except OSError as error:
        sys.exit(f"Could not write {target}: {error}")
    print(f"wrote {target} ({target.stat().st_size} bytes)")
