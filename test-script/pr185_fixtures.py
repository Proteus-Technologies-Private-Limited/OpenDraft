"""Build Fade In / OSF fixtures for manually testing PR #185 (#181 layout fidelity).

A4 page with custom margins and non-default Character/Dialogue indents, long
enough to run to many pages. Writes to test-script/output/pr185/.
"""
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent / "output" / "pr185"


def build_osf() -> str:
    paras = []
    for n in range(1, 41):
        paras += [
            ('Scene Heading', f'INT. TEST LOCATION {n} - DAY'),
            ('Action', 'A long line of action that should wrap at the text column width so we can see the right margin in use on the page.'),
            ('Character', 'MAYA'),
            ('Dialogue', f'This is speech number {n}, long enough to wrap across more than one line of dialogue.'),
            ('Character', 'LEO'),
            ('Parenthetical', '(quietly)'),
            ('Dialogue', 'And a reply.'),
        ]
    body = "\n".join(
        f'<para><style basestylename="{s}"/><text>{t}</text></para>' for s, t in paras
    )
    return f'''<?xml version="1.0" encoding="utf-8"?>
<document type="Open Screenplay Format document" version="30">
<info/>
<settings page_width="2100" page_height="2970" margin_left="381" margin_right="254" margin_top="254" margin_bottom="254" normal_linesperinch="6.0" element_spacing="1.00"/>
<styles>
<style name="Normal Text" builtin="1" builtin_index="0" font="Courier Prime" size="12"/>
<style name="Scene Heading" builtin="1" builtin_index="1" basestylename="Normal Text" spacebefore="2.0" keepwithnext="1" allcaps="1" bold="1"/>
<style name="Action" builtin="1" builtin_index="2" basestylename="Normal Text" spacebefore="1.0"/>
<style name="Character" builtin="1" builtin_index="3" basestylename="Normal Text" spacebefore="1.0" keepwithnext="1" leftindent="889" allcaps="1"/>
<style name="Parenthetical" builtin="1" builtin_index="4" basestylename="Normal Text" keepwithnext="1" leftindent="635" rightindent="635"/>
<style name="Dialogue" builtin="1" builtin_index="5" basestylename="Normal Text" leftindent="381" rightindent="508"/>
<style name="Transition" builtin="1" builtin_index="6" basestylename="Normal Text" spacebefore="1.0" align="right" allcaps="1"/>
<style name="Shot" builtin="1" builtin_index="7" basestylename="Normal Text" spacebefore="1.0" allcaps="1"/>
</styles>
<titlepage><para bookmark="title"><text>PR 185 A4 FIXTURE</text></para><para bookmark="author"><text>Test Writer</text></para></titlepage>
<paragraphs>
{body}
</paragraphs>
</document>
'''


FOUNTAIN = """Title: Save Test
Author: Test Writer

INT. KITCHEN - NIGHT

A kettle starts to whistle.

MAYA
Nobody touches the original.
"""

FDX = """<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. GARAGE - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>A door creaks.</Text></Paragraph>
    <Paragraph Type="Character"><Text>LEO</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>This file is reached through a symlink.</Text></Paragraph>
  </Content>
</FinalDraft>
"""


def build_app_fixtures(app_dir: Path) -> None:
    """Files for the desktop save-protection test, reset to a clean state.

    app/Save Test.fountain   opened in place and saved repeatedly
    app/real/Linked.fdx      the real file
    app/Linked alias.fdx     a symlink to it, which is what gets opened
    """
    import shutil
    if app_dir.exists():
        shutil.rmtree(app_dir)
    (app_dir / "real").mkdir(parents=True)
    (app_dir / "Save Test.fountain").write_text(FOUNTAIN, encoding="utf-8")
    (app_dir / "real" / "Linked.fdx").write_text(FDX, encoding="utf-8")
    (app_dir / "Linked alias.fdx").symlink_to(app_dir / "real" / "Linked.fdx")


def main() -> int:
    try:
        OUT.mkdir(parents=True, exist_ok=True)
        xml = build_osf()
        (OUT / "pr185-a4.osf").write_text(xml, encoding="utf-8")
        with zipfile.ZipFile(OUT / "pr185-a4.fadein", "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("document.xml", xml)
        build_app_fixtures(OUT / "app")
    except OSError as e:
        print(f"Could not write fixtures: {e}", file=sys.stderr)
        return 1
    for f in sorted(OUT.rglob("*")):
        if f.is_file() or f.is_symlink():
            print(f, "->", f.resolve() if f.is_symlink() else f.stat().st_size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
