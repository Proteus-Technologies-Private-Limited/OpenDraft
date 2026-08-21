#!/usr/bin/env python3
"""
Convert a text-based screenplay PDF into OpenDraft's native `.odraft` format.

A screenplay PDF carries its element types in its geometry, not in its text:
Courier is monospaced and every element sits at a fixed left margin, so the
x-coordinate of a line tells you whether it is action, dialogue, a parenthetical
or a character cue. This reads those coordinates with PyMuPDF, rebuilds the
element structure, and writes the `.odraft` JSON envelope that
`frontend/src/utils/odraftFormat.ts` parses.

Margins are *derived* from the document rather than hard-coded, so this works on
any conventionally formatted screenplay PDF, not just one particular file:
the leftmost frequently-used x is the action margin, and the standard offsets
(+1.0" dialogue, +1.5" parenthetical, +2.0" character, +4.0" transition) are
measured from it.

Scanned PDFs (page images with no text layer) cannot be converted — run OCR
first.

Usage:
    venv/bin/python test-script/pdf_to_odraft.py INPUT.pdf [-o OUT.odraft]
                                                 [--title T] [--author A]
                                                 [--preview N]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - environment problem, not logic
    sys.exit(
        "PyMuPDF is required. Install it into the project venv:\n"
        "    venv/bin/pip install pymupdf"
    )

ODRAFT_VERSION = 2
PT_PER_INCH = 72.0

# Element left margins, in inches from the action margin. Straight out of the
# standard screenplay layout every word processor and Final Draft template uses.
OFFSETS = {
    "action": 0.0,
    "dialogue": 1.0,
    "parenthetical": 1.5,
    "character": 2.0,
}
TRANSITION_OFFSET = 3.5  # anything this far right is a right-aligned transition

SCENE_HEADING_RE = re.compile(
    r"^(INT\.?/EXT\.?|EXT\.?/INT\.?|I/E\.?|INT\.?|EXT\.?|EST\.?)([\s.]|$)"
)
# All-caps action-margin lines that are camera/shot directions rather than prose.
SHOT_RE = re.compile(
    r"^(ANGLE|CLOSE|CLOSER|WIDE|EXTREME|ESTABLISHING|INSERT|POV|P\.O\.V\.|"
    r"BACK TO|CUT TO|MATCH|AERIAL|TIGHT|TWO SHOT|REVERSE|PAN|TRACKING|"
    r"MONTAGE|QUICK CUTS|QUICK FLASHES|SERIES OF|INTERCUT|FLASHBACK|"
    r"PRESENT DAY|CREDITS|OVER CREDITS|ON THE|ON [A-Z])"
)
TRANSITION_RE = re.compile(r"(TO:|IN:|OUT\.?|OUT:|FADE IN\.?|BLACK\.?)$")
# Page furniture that is not part of the script.
OMIT_RE = re.compile(r"^\(?(CONTINUED|MORE|CONT'D|CONT’D)\)?[:.]?$", re.IGNORECASE)
# Page and scene numbers, tolerating the stray space Ghostscript-produced PDFs
# leave between the digits and the period ("70 ." rather than "70.") — without
# that tolerance a page number lands out in the right margin and imports as a
# transition.
PAGE_NUMBER_RE = re.compile(r"^\d+\s*[.)]?$")
SCENE_NUMBER_RE = re.compile(r"^[0-9]+\s*[A-Za-z]{0,2}\s*[.)]?$")

BLOCK_TYPES = {"sceneHeading", "action", "character", "dialogue", "parenthetical",
               "transition", "shot"}


@dataclass
class Fragment:
    """One run of text as the PDF emits it. Several can share a baseline."""
    page: int
    y: float
    x: float
    text: str


@dataclass
class Line:
    """One visual line of the page: the body fragments sharing a baseline, joined."""
    page: int
    y: float
    x: float
    text: str
    numbers: list[str] = field(default_factory=list)  # scene numbers in the margins


@dataclass
class Element:
    kind: str
    text: str
    scene_number: str | None = None
    start_page: int = 0
    end_page: int = 0


# ── PDF text extraction ─────────────────────────────────────────────────────

def extract_fragments(doc: "fitz.Document") -> list[Fragment]:
    """Every run of text in the document, in page order, with its left edge."""
    fragments: list[Fragment] = []
    for page_index in range(doc.page_count):
        page = doc[page_index]
        try:
            blocks = page.get_text("dict")["blocks"]
        except Exception as exc:  # corrupt page — skip it, keep the rest
            print(f"warning: could not read page {page_index + 1}: {exc}",
                  file=sys.stderr)
            continue
        for block in blocks:
            for line in block.get("lines", []):
                text = re.sub(r"\s+", " ", "".join(s["text"] for s in line["spans"])).strip()
                if not text:
                    continue
                fragments.append(Fragment(page=page_index, y=float(line["bbox"][1]),
                                          x=float(line["bbox"][0]), text=text))
    return fragments


def detect_action_margin(fragments: list[Fragment]) -> float:
    """The x of the action margin, in points.

    Taken as the leftmost x that carries a real share of the *prose*. Short
    fragments are excluded deliberately: the scene numbers printed out in the
    left margin are numerous enough to look like a column of their own, and an
    earlier version of this locked onto them and shifted every element one
    margin to the left.
    """
    counts = Counter(round(f.x) for f in fragments if len(f.text) >= 12)
    total = sum(counts.values())
    if not total:
        raise ValueError(
            "No usable text found in the PDF. If this is a scanned script, "
            "run OCR on it first."
        )
    threshold = max(3, total * 0.03)
    frequent = sorted(x for x, n in counts.items() if n >= threshold)
    if not frequent:
        frequent = sorted(counts)
    return float(frequent[0])


def build_lines(fragments: list[Fragment], action_x: float) -> list[Line]:
    """Merge fragments into visual lines, holding the margin numbers aside.

    PDF text arrives in runs, so `MUSIC UP: "Heat Of the Moment"` can be two
    fragments that are one line on the page — they have to be rejoined or the
    line is split in two. But a numbered script also prints the scene number in
    both margins *on the heading's own baseline*, and joining those in turns
    `EXT. STREET - DAY` into `1 EXT. STREET - DAY 1`. So each baseline is split:
    bare numbers outside the text block are the scene number, and what is left
    is the line.
    """
    by_baseline: dict[tuple[int, int], list[Fragment]] = {}
    for fragment in fragments:
        by_baseline.setdefault((fragment.page, round(fragment.y)), []).append(fragment)

    lines: list[Line] = []
    for (page, y) in sorted(by_baseline):
        body: list[Fragment] = []
        numbers: list[str] = []
        for fragment in sorted(by_baseline[(page, y)], key=lambda f: f.x):
            offset_in = (fragment.x - action_x) / PT_PER_INCH
            in_margin = offset_in < -0.2 or offset_in > TRANSITION_OFFSET
            if in_margin and SCENE_NUMBER_RE.match(fragment.text):
                numbers.append(re.sub(r"[\s.)]", "", fragment.text))
            else:
                body.append(fragment)
        if not body:
            # A numbers-only baseline is a scene number whose heading sits
            # elsewhere, or a page number. Nothing to keep.
            continue
        lines.append(Line(page=page, y=float(y), x=body[0].x,
                          text=" ".join(f.text for f in body).strip(),
                          numbers=numbers))
    return lines


# ── Classification ──────────────────────────────────────────────────────────

def classify(line: Line, action_x: float, page_top: float) -> str | None:
    """The element kind for a line, or None when it is page furniture."""
    text = line.text
    if not text or OMIT_RE.match(text):
        return None

    offset_in = (line.x - action_x) / PT_PER_INCH

    # A bare number in the top margin is the page number.
    if PAGE_NUMBER_RE.match(text) and line.y < page_top:
        return None

    if offset_in >= TRANSITION_OFFSET:
        return "transition"

    kind = min(OFFSETS, key=lambda k: abs(OFFSETS[k] - offset_in))
    # Too far left to be anything (a stray margin mark) — treat as action.
    if offset_in < -0.2:
        return "action"

    if kind == "action":
        upper = text.upper()
        if SCENE_HEADING_RE.match(upper):
            return "sceneHeading"
        if text == upper and re.search(r"[A-Z]", text):
            if TRANSITION_RE.search(text):
                return "transition"
            if SHOT_RE.match(text):
                return "shot"
        return "action"

    if kind == "character":
        # A right-of-centre line that isn't a cue (lower case, or ends in a
        # sentence) is dialogue whose margin drifted, not a character name.
        if text != text.upper() and not re.match(r"^[A-Z][A-Za-z'.\- ]*$", text):
            return "dialogue"
        return "character"

    return kind


# ── Grouping ────────────────────────────────────────────────────────────────

def group_elements(
    doc: "fitz.Document",
    lines: list[Line],
    action_x: float,
    skip_pages: int,
) -> list[Element]:
    """Turn classified lines into screenplay elements.

    Lines of the same kind on consecutive baselines are one element; a blank
    line's worth of vertical gap, or a change of kind, starts a new one. The
    line pitch is measured from the document instead of assumed, because it
    varies with the point size the script was set in.
    """
    pitch = measure_line_pitch(lines)
    page_tops = {i: doc[i].rect.height * 0.08 for i in range(doc.page_count)}

    elements: list[Element] = []
    prev: tuple[int, float, str] | None = None  # page, y, kind

    for line in lines:
        if line.page < skip_pages:
            continue

        kind = classify(line, action_x, page_tops[line.page])
        if kind is None:
            continue

        same_element = (
            prev is not None
            and prev[2] == kind
            and prev[0] == line.page
            and (line.y - prev[1]) <= pitch * 1.6
        )
        if same_element:
            elements[-1].text = join_wrapped(elements[-1].text, line.text)
            elements[-1].end_page = line.page
        else:
            elements.append(Element(kind=kind, text=line.text,
                                    start_page=line.page, end_page=line.page))
            if kind == "sceneHeading" and line.numbers:
                elements[-1].scene_number = line.numbers[0]
        prev = (line.page, line.y, kind)

    return merge_across_pages(elements)


def measure_line_pitch(lines: list[Line]) -> float:
    """Baseline-to-baseline distance within a paragraph, in points."""
    gaps = Counter()
    for a, b in zip(lines, lines[1:]):
        if a.page == b.page and 0 < b.y - a.y < 40:
            gaps[round(b.y - a.y)] += 1
    return float(gaps.most_common(1)[0][0]) if gaps else 12.0


def join_wrapped(existing: str, addition: str) -> str:
    """Join a wrapped line onto the one above it.

    A screenplay word processor breaks lines at a space or straight after a
    hyphen, so a line ending `letter-` followed by a line starting with a letter
    is one hyphenated word ("flat-" / "screen") and must close up with no space.
    The test is deliberately narrow: an em-dash (`--`) or a dash after
    punctuation is an interruption the writer typed, and closing those up runs
    two sentences together.
    """
    if re.search(r"[A-Za-z]-$", existing) and re.match(r"[A-Za-z]", addition):
        return existing + addition
    return f"{existing} {addition}".strip()


def merge_across_pages(elements: list[Element]) -> list[Element]:
    """Rejoin a paragraph split by a page break.

    A page can end mid-sentence, which arrives here as two elements of the same
    kind. Three conditions have to hold together, and each one is load-bearing:

    - the halves must sit on *consecutive pages*. Without this the rule fires
      inside a page and welds a montage list ("--Working out", "--Buying action
      figures", ...) into a single paragraph, because none of its lines end in
      a full stop;
    - the kind must be prose. A character cue or scene heading never continues;
    - the first half must stop without terminal punctuation — including a dash,
      which in a screenplay marks an interruption and ends the line on purpose.
    """
    merged: list[Element] = []
    for element in elements:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and prev.kind == element.kind
            and element.kind in ("action", "dialogue")
            and element.start_page == prev.end_page + 1
            and not re.search(r"[-.!?:;\"”’)\]]$", prev.text)
        ):
            prev.text = f"{prev.text} {element.text}".strip()
            prev.end_page = element.end_page
            continue
        merged.append(element)
    return merged


# ── Title page ──────────────────────────────────────────────────────────────

def parse_title_page(lines: list[Line]) -> tuple[dict[str, str], int]:
    """Read the title/author off the front matter, and say where the script starts.

    The script proper begins at the first page carrying a scene heading; every
    page before it is front matter. Returns the fields found plus that page
    index, so the cover sheet is not imported as stray action lines.
    """
    first_script_page = 0
    for line in lines:
        if SCENE_HEADING_RE.match(line.text.upper()):
            first_script_page = line.page
            break

    fields: dict[str, str] = {}
    front = [l for l in lines if l.page < first_script_page]
    if not front:
        return fields, first_script_page

    texts = [l.text for l in front if l.text]
    for i, text in enumerate(texts):
        low = text.lower().rstrip(":")
        if low in ("written by", "screenplay by", "by") and i + 1 < len(texts):
            fields["tpWrittenBy"] = texts[i + 1]
            break
    # The title is the first line that isn't a credit label or the credit itself.
    for text in texts:
        if text == fields.get("tpWrittenBy"):
            continue
        if text.lower().rstrip(":") in ("written by", "screenplay by", "by"):
            continue
        fields["tpTitle"] = text
        break

    for i, text in enumerate(texts):
        if re.match(r"^(draft|revision|revised|first draft|final draft)\b", text, re.I):
            fields.setdefault("tpDraft", text)
        if re.match(r"^(©|copyright)\b", text, re.I):
            fields.setdefault("tpCopyright", text)
    return fields, first_script_page


def build_title_page_blocks(fields: dict[str, str], lines_per_page: int = 54) -> list[dict]:
    """The laid-out run of `titlePage` nodes.

    Mirrors `frontend/src/utils/titlePageBlocks.ts` — a title page in OpenDraft
    is not one node but a run of them, with blank spacers doing the positioning.
    A single attrs-only node imports as a nearly blank sheet.
    """
    title = fields.get("tpTitle", "").strip()
    written_by = fields.get("tpWrittenBy", "").strip()
    by_line = f"Written by {written_by}" if written_by else ""
    bottom = [(k, fields[a].strip())
              for k, a in (("draft", "tpDraft"), ("contact", "tpContact"),
                           ("copyright", "tpCopyright"))
              if fields.get(a, "").strip()]

    if not (title or by_line or bottom):
        return []

    def blank() -> dict:
        return {"type": "titlePage", "attrs": {"field": "blank"}, "content": []}

    def node(attrs: dict, text: str) -> dict:
        return {
            "type": "titlePage",
            "attrs": attrs,
            "content": [{"type": "text", "text": text}] if text else [],
        }

    title_line = max(3, round(lines_per_page / 3.6))
    page_lines = max(title_line + 4, lines_per_page - 4)

    blocks: list[dict] = []
    top_spacers = max(2, title_line - 1)
    blocks.extend(blank() for _ in range(top_spacers))
    blocks.append(node({**fields, "field": "title"}, title))
    used = top_spacers + 1

    if by_line:
        blocks.extend([blank(), blank(), node({"field": "author"}, by_line)])
        used += 3

    if bottom:
        bottom_lines = sum(text.count("\n") + 1 for _, text in bottom)
        gap = max(2, page_lines - used - bottom_lines)
        blocks.extend(blank() for _ in range(gap))
        blocks.extend(node({"field": f}, text) for f, text in bottom)

    return blocks


# ── .odraft assembly ────────────────────────────────────────────────────────

def to_prosemirror(elements: list[Element], title_blocks: list[dict]) -> dict:
    content: list[dict] = list(title_blocks)
    for element in elements:
        node: dict = {"type": element.kind}
        if element.text:
            node["content"] = [{"type": "text", "text": element.text}]
        else:
            node["content"] = []
        if element.kind == "sceneHeading" and element.scene_number:
            node["attrs"] = {"sceneNumber": element.scene_number}
        content.append(node)
    if not content:
        content = [{"type": "action", "content": []}]
    return {"type": "doc", "content": content}


def page_layout(doc: "fitz.Document", action_x: float) -> dict:
    """A page layout matching the PDF's own paper size and margins."""
    rect = doc[0].rect
    width_in = round(rect.width / PT_PER_INCH, 2)
    height_in = round(rect.height / PT_PER_INCH, 2)
    left_in = round(action_x / PT_PER_INCH, 2)
    return {
        "pageWidth": width_in,
        "pageHeight": height_in,
        "topMargin": 72,
        "bottomMargin": 72,
        "headerMargin": 36,
        "footerMargin": 36,
        "leftMargin": left_in,
        "rightMargin": round(max(0.5, width_in - left_in - 6.0), 2),
        "headerContent": {"left": "", "center": "", "right": "#"},
        "footerContent": {"left": "", "center": "", "right": ""},
        "headerStartPage": 2,
        "footerStartPage": 1,
        "startingPageNumber": 1,
    }


def build_odraft(doc, elements, title_blocks, fields, action_x, page_count) -> dict:
    title = fields.get("tpTitle", "").strip() or "Untitled"
    author = fields.get("tpWrittenBy", "").strip()
    content = to_prosemirror(elements, title_blocks)
    content["_pageLayout"] = page_layout(doc, action_x)
    content["_sceneHeadingSpaceBefore"] = True
    # Numbers lifted off a printed script are the production's own, so show them
    # and lock them: renumbering an imported shooting script would break every
    # reference to it that exists outside the file.
    numbered = any(e.scene_number for e in elements)
    content["_sceneNumbersVisible"] = numbered
    content["_sceneNumbersLocked"] = numbered
    return {
        "odraft_version": ODRAFT_VERSION,
        "format": "opendraft-script",
        "exported_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "meta": {
            "title": title,
            "author": author,
            "color": "",
            "page_count": page_count,
            "project_id": None,
            "script_id": None,
            "app_version": "pdf_to_odraft",
        },
        "content": content,
    }


# ── Entry point ─────────────────────────────────────────────────────────────

def convert(pdf_path: Path, title: str | None, author: str | None) -> tuple[dict, list[Element]]:
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        raise SystemExit(f"Could not open {pdf_path}: {exc}")

    try:
        fragments = extract_fragments(doc)
        if not fragments:
            raise SystemExit(
                f"{pdf_path.name} has no extractable text — it is probably a scan. "
                "Run OCR on it first, then convert the OCR'd PDF."
            )

        action_x = detect_action_margin(fragments)
        lines = build_lines(fragments, action_x)
        fields, first_script_page = parse_title_page(lines)
        if title:
            fields["tpTitle"] = title
        if author:
            fields["tpWrittenBy"] = author

        elements = group_elements(doc, lines, action_x, first_script_page)
        title_blocks = build_title_page_blocks(fields)
        data = build_odraft(doc, elements, title_blocks, fields, action_x, doc.page_count)
        return data, elements
    finally:
        doc.close()


def preview(elements: list[Element], limit: int) -> str:
    out = []
    for element in elements[:limit]:
        label = element.kind + (f" #{element.scene_number}" if element.scene_number else "")
        out.append(f"{label:>16}  {element.text[:88]}")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--title")
    parser.add_argument("--author")
    parser.add_argument("--preview", type=int, default=0,
                        help="print the first N parsed elements and exit")
    args = parser.parse_args()

    if not args.pdf.is_file():
        return _fail(f"No such file: {args.pdf}")

    data, elements = convert(args.pdf, args.title, args.author)

    if args.preview:
        print(preview(elements, args.preview))
        return 0

    out_path = args.output or (Path(__file__).parent / "output" /
                               f"{data['meta']['title'] or args.pdf.stem}.odraft")
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        return _fail(f"Could not write {out_path}: {exc}")

    counts = Counter(e.kind for e in elements)
    print(f"Wrote {out_path}")
    print(f"  title    {data['meta']['title']}")
    print(f"  author   {data['meta']['author'] or '(none)'}")
    print(f"  elements {len(elements)}  " +
          "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    return 0


def _fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
