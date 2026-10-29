"""Build sample Highland, Celtx and WriterDuet files for testing OpenDraft's importers.

The shapes mirror the parser unit tests (frontend/src/utils/*Parser.test.ts).
Output: test-script/output/feature-review/fixtures/
"""
import json
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "output" / "feature-review" / "fixtures"


def highland(path: Path) -> None:
    fountain = """Title: HIGHLAND SAMPLE
Credit: Written by
Author: Test Writer

INT. LIGHTHOUSE - NIGHT

The lamp turns. MARA climbs the last step.

MARA
Someone has been keeping this lit.

TOM (O.S.)
Every night for thirty years.

CUT TO:

EXT. CLIFF - DAWN

Waves below.
"""
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Sample.textbundle/text.fountain", fountain)
        z.writestr("Sample.textbundle/info.json", json.dumps({"version": 2, "type": "com.quoteunquoteapps.highland"}))


CELTX_HTML = """<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">
<html>
<head>
  <title>CELTX SAMPLE</title>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta content="Test Writer" name="Author">
  <meta content="Written by" name="CX.byline">
</head>
<body>
<p scenestr="1" class="sceneheading">INT. OBSERVATORY - NIGHT<br>
</p>
<p class="action">The dome opens. <b>Stars.</b><br>
</p>
<p class="character">ELENA<br>
</p>
<p class="parenthetical">(whispering)<br>
</p>
<p class="dialog">It moved. I swear it <i>moved</i>.<br>
</p>
<p class="transition">CUT TO:<br>
</p>
<p scenestr="2" class="sceneheading">EXT. HILLTOP - CONTINUOUS<br>
</p>
<p class="shot">ANGLE ON THE SKY<br>
</p>
</body>
</html>"""

CELTX_RDF = """<?xml version="1.0"?>
<RDF:RDF xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:cx="http://celtx.com/NS/v1/"
         xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <cx:Document RDF:about="http://celtx.com/res/1kEqvojZWTHA"
                   dc:title="Screenplay"
                   cx:localFile="script-bQ9.html">
    <cx:doctype RDF:resource="http://celtx.com/NS/v1/ScriptDocument"/>
  </cx:Document>
</RDF:RDF>"""


def celtx(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("project.rdf", CELTX_RDF)
        z.writestr("script-bQ9.html", CELTX_HTML)


def _line(kind: str, text: str) -> dict:
    return {"type": kind, "content": {"c1": [0, [["i", [1, "", 0, text]]], 1]}}


def _branch(lines: dict) -> dict:
    return {"h": {
        "-": {"a": "s", "l": "", "v": json.dumps({"data": {}})},
        "-M001": {"a": "u", "l": "data", "v": json.dumps(lines)},
    }}


def writerduet(path: Path) -> None:
    script = {"b": {
        "-": _branch({
            "a0": _line("Slugline", "INT. RECORDING STUDIO - DAY"),
            "a1": _line("Action", "Red light on. JUNO adjusts the mic."),
            "a2": _line("EditDialogName", "JUNO"),
            "a3": _line("EditDialogParen", "(into the mic)"),
            "a4": _line("EditDialogContent", "Take one. Let's make it count."),
            "a5": _line("Transition", "SMASH CUT TO:"),
            "a6": _line("Slugline", "EXT. PARKING GARAGE - NIGHT"),
        }),
        "titlePage": _branch({
            "z0": _line("Title", "WRITERDUET SAMPLE"),
            "z1": _line("Text", "Written by"),
            "z2": _line("Text", "Test Writer"),
        }),
    }}
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("script.json", json.dumps(script))


def main() -> int:
    try:
        OUT.mkdir(parents=True, exist_ok=True)
        highland(OUT / "sample.highland")
        celtx(OUT / "sample.celtx")
        writerduet(OUT / "sample.wdz")
    except OSError as err:
        print(f"Could not write fixtures to {OUT}: {err}", file=sys.stderr)
        return 1
    for f in sorted(OUT.iterdir()):
        print(f, f.stat().st_size, "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
