#!/usr/bin/env python3
"""Write a GitHub release's description from the app's own What's New list.

The release notes are written once, in the About dialog
(frontend/src/components/MenuBar.tsx), as part of the release checklist
(docs/RELEASE.md step 3). This turns that version's entry into Markdown and
adds a download table built from the files actually attached to the release,
so the GitHub page says what changed without anyone writing it twice.

    release-notes.py 2.12.0 --check
        exit 1 unless MenuBar.tsx has a non-empty What's New entry for 2.12.0
    release-notes.py 2.12.0 --assets names.txt --repo owner/name > body.md
        the whole release description; names.txt holds one asset name a line
    release-notes.py 2.12.0 --notes-only
        just the What's New bullets

The GitHub page is not shown inside the Apple apps, so text wrapped in
<NotOnApple> is kept in its full, non-Apple wording here.

Standard library only: it runs on a bare GitHub runner and from release.sh.
"""

from __future__ import annotations

import argparse
import html.parser
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MENUBAR = ROOT / "frontend" / "src" / "components" / "MenuBar.tsx"

BLOCK_START = "i18n-ignore-start: release notes"
BLOCK_END = "i18n-ignore-end"

# (pattern on the asset name, label). Order is the order of the table. Files
# a person cannot install themselves (the Play bundle, the App Store IPA) are
# left out; the store links below cover those platforms.
ASSET_LABELS: list[tuple[str, str | None]] = [
    (r"_aarch64\.dmg$", "macOS — Apple Silicon"),
    (r"_x64\.dmg$", "macOS — Intel, macOS 12 or later"),
    (r"_x86_64-legacy\.dmg$", "macOS — Intel, macOS 10.13 to 11"),
    (r"_x64-setup\.exe$", "Windows — installer"),
    (r"_x64_en-US\.msi$", "Windows — MSI"),
    (r"_amd64\.deb$", "Linux — Debian / Ubuntu"),
    (r"\.x86_64\.rpm$", "Linux — Fedora / RHEL"),
    (r"_amd64\.AppImage$", "Linux — AppImage"),
    (r"_android\.apk$", "Android — APK"),
    (r"_android\.aab$", None),
    (r"_ios\.ipa$", None),
]

APP_STORE = "https://apps.apple.com/us/app/open-draft-screenwriting/id6761807809"
PLAY_STORE = "https://play.google.com/store/apps/details?id=com.proteus.opendraft"


class NotesError(Exception):
    pass


# ── What's New → Markdown ──────────────────────────────────────────────────


def changelog_block(source: str) -> str:
    start = source.find(BLOCK_START)
    if start < 0:
        raise NotesError(f"no '{BLOCK_START}' marker in {MENUBAR.name}")
    end = source.find(BLOCK_END, start)
    if end < 0:
        raise NotesError(f"no '{BLOCK_END}' marker after the release notes in {MENUBAR.name}")
    return source[start:end]


def version_list(block: str, version: str) -> str:
    """The <ul> that follows the 'vX.Y.Z' subsection title."""
    title = re.search(
        r'<div className="about-subsection-title">\s*v' + re.escape(version) + r"\s*</div>",
        block,
    )
    if not title:
        raise NotesError(f"no What's New entry for v{version} in {MENUBAR.name}")
    rest = block[title.end():]
    ul = re.match(r'\s*<ul className="about-list">(.*?)</ul>', rest, re.S)
    if not ul:
        raise NotesError(f"the v{version} entry in {MENUBAR.name} is not followed by its list")
    return ul.group(1)


def unjsx(fragment: str) -> str:
    """Reduce the JSX in a release-notes list to plain HTML."""
    fragment = re.sub(r"\{/\*.*?\*/\}", "", fragment, flags=re.S)
    # String-literal expressions, e.g. {'{page}'} or {' '}. Set aside first, so
    # the braces they print are not mistaken for an expression below.
    literals: list[str] = []

    def keep(m: re.Match) -> str:
        literals.append(m.group(1) if m.group(1) is not None else m.group(2))
        return f"\0{len(literals) - 1}\0"

    fragment = re.sub(r"\{'((?:[^'\\]|\\.)*)'\}|\{\"((?:[^\"\\]|\\.)*)\"\}", keep, fragment)
    expr = re.search(r"\{[^}]*\}", fragment)
    if expr:
        raise NotesError(f"unsupported JSX expression in the release notes: {expr.group(0)}")
    return re.sub(r"\0(\d+)\0", lambda m: literals[int(m.group(1))], fragment)


_MD_SPECIAL = re.compile(r"([\\`*_\[\]<~])")


class _ToMarkdown(html.parser.HTMLParser):
    INLINE = {"strong": "**", "b": "**", "em": "*", "i": "*"}
    TRANSPARENT = {"notonapple", "span"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.items: list[str] = []
        self.buf: list[str] | None = None
        self.raw: list[str] | None = None  # inside <code> / <kbd>
        self.raw_tag = ""
        self.href: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            self.buf = []
        elif tag in self.TRANSPARENT:
            pass  # <NotOnApple> can wrap a whole <li>
        elif self.buf is None:
            raise NotesError(f"<{tag}> outside a list item in the release notes")
        elif tag in ("code", "kbd"):
            self.raw, self.raw_tag = [], tag
        elif tag in self.INLINE:
            self.buf.append(self.INLINE[tag])
        elif tag == "a":
            self.href = dict(attrs).get("href", "")
            self.buf.append("[")
        elif tag == "br":
            self.buf.append(" ")
        else:
            raise NotesError(f"unsupported <{tag}> in the release notes")

    def handle_endtag(self, tag):
        if tag == "li":
            text = re.sub(r"\s+", " ", "".join(self.buf or [])).strip()
            if text:
                self.items.append(text)
            self.buf = None
        elif self.buf is None:
            return
        elif tag in ("code", "kbd") and self.raw is not None:
            content = re.sub(r"\s+", " ", "".join(self.raw))
            if tag == "kbd":
                content = content.replace("&", "&amp;").replace("<", "&lt;")
                self.buf.append(f"<kbd>{content}</kbd>")
            else:
                fence = "``" if "`" in content else "`"
                pad = " " if content.startswith("`") or content.endswith("`") else ""
                self.buf.append(f"{fence}{pad}{content}{pad}{fence}")
            self.raw = None
        elif tag in self.INLINE:
            self.buf.append(self.INLINE[tag])
        elif tag == "a":
            self.buf.append(f"]({self.href or ''})")
            self.href = None

    def handle_data(self, data):
        if self.raw is not None:
            self.raw.append(data)
        elif self.buf is not None:
            self.buf.append(_MD_SPECIAL.sub(r"\\\1", data))


def whats_new(version: str, source: str | None = None) -> list[str]:
    if source is None:
        source = MENUBAR.read_text(encoding="utf-8")
    fragment = unjsx(version_list(changelog_block(source), version))
    parser = _ToMarkdown()
    parser.feed(fragment)
    parser.close()
    if not parser.items:
        raise NotesError(f"the What's New entry for v{version} in {MENUBAR.name} is empty")
    # A bold title followed by "— text" is how every item reads; keep it.
    return parser.items


# ── The whole release description ──────────────────────────────────────────


def download_rows(assets: list[str], repo: str, tag: str) -> list[str]:
    rows: list[tuple[int, str]] = []
    for name in assets:
        for order, (pattern, label) in enumerate(ASSET_LABELS):
            if re.search(pattern, name):
                if label:
                    url = f"https://github.com/{repo}/releases/download/{tag}/{name}"
                    rows.append((order, f"| {label} | [{name}]({url}) |"))
                break
    return [row for _, row in sorted(rows)]


def release_body(version: str, assets: list[str], repo: str, tag: str,
                 source: str | None = None, allow_missing: bool = False) -> str:
    out: list[str] = []
    try:
        items = whats_new(version, source)
        out += [f"## What's New in {version}", ""]
        out += [f"- {item}" for item in items]
        out += [""]
    except NotesError as e:
        if not allow_missing:
            raise
        print(f"::warning::{e}; the release page will carry the downloads only", file=sys.stderr)

    rows = download_rows(assets, repo, tag)
    out += ["## Download", ""]
    if rows:
        out += ["| Platform | File |", "|----------|------|", *rows, ""]
    out += [
        f"Phones and tablets: [App Store]({APP_STORE}) · [Google Play]({PLAY_STORE}).",
        "",
        "### Installing",
        "",
        "- **macOS:** open the `.dmg` and drag OpenDraft to Applications.",
        "- **Windows:** run the `.exe` or `.msi` installer.",
        "- **Linux:** `sudo apt install ./OpenDraft_*.deb`, `sudo dnf install ./OpenDraft-*.rpm`,"
        " or make the `.AppImage` executable and run it.",
        "- **Android APK:** open it on the device and allow installing from this source when asked.",
        "",
        "The desktop app is fully standalone — no Python, Node.js or internet connection needed"
        " after installing.",
        "",
        "### Run in a browser (self-hosted)",
        "",
        "```",
        f"git clone https://github.com/{repo}.git",
        "cd OpenDraft",
        "./setup.sh",
        "```",
        "",
        f"See [INSTALLATION.md](https://github.com/{repo}/blob/main/docs/INSTALLATION.md) for details.",
        "",
    ]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("version", help="X.Y.Z (a leading v is ignored)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="only check the What's New entry exists")
    mode.add_argument("--notes-only", action="store_true", help="print just the What's New bullets")
    ap.add_argument("--assets", type=Path, help="file listing the release's asset names, one a line")
    ap.add_argument("--repo", default="Proteus-Technologies-Private-Limited/OpenDraft")
    ap.add_argument("--allow-missing", action="store_true",
                    help="write the downloads alone, with a warning, if the notes are missing")
    args = ap.parse_args(argv)
    version = args.version.removeprefix("v")

    try:
        if args.check:
            items = whats_new(version)
            print(f"What's New for v{version}: {len(items)} item(s)")
        elif args.notes_only:
            print("\n".join(f"- {item}" for item in whats_new(version)))
        else:
            assets = []
            if args.assets:
                assets = [l.strip() for l in args.assets.read_text().splitlines() if l.strip()]
            sys.stdout.write(release_body(version, assets, args.repo, f"v{version}",
                                          allow_missing=args.allow_missing))
    except NotesError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
