"""
Regenerate user-manual/manifest.json from the sidebar in user-manual/index.html.

The app downloads that manifest to learn which pages the manual has, so the
manual can gain or lose pages without shipping a new build. Run this whenever
the sidebar changes:

    ./venv/bin/python test-script/generate_manual_manifest.py

The manifest also carries a content hash of every page, which is what lets the
app tell an out-of-date local copy from a current one.
"""

import hashlib
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANUAL = os.path.join(ROOT, "user-manual")
INDEX = os.path.join(MANUAL, "index.html")
OUT = os.path.join(MANUAL, "manifest.json")

SECTION_RE = re.compile(r'<div class="sidebar-section">(.*?)</div>\s*(?=<div class="sidebar-section">|</nav>)', re.S)
TITLE_RE = re.compile(r'<div class="sidebar-section-title">(.*?)</div>', re.S)
LINK_RE = re.compile(r'<a href="([^"]+\.html)"[^>]*class="sidebar-link[^"]*"[^>]*>(.*?)</a>', re.S)


def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def main():
    if not os.path.exists(INDEX):
        sys.exit(f"Not found: {INDEX}")

    source = open(INDEX, encoding="utf-8").read()
    nav = re.search(r'<nav class="sidebar".*?</nav>', source, re.S)
    if not nav:
        sys.exit("Could not find the sidebar nav in index.html")

    pages, seen = [], set()
    for block in SECTION_RE.finditer(nav.group(0)):
        body = block.group(1)
        title = TITLE_RE.search(body)
        section = clean(title.group(1)) if title else "Manual"
        for slug, label in LINK_RE.findall(body):
            if slug in seen:
                continue
            path = os.path.join(MANUAL, slug)
            if not os.path.exists(path):
                print(f"  ! sidebar links {slug}, which does not exist - skipped")
                continue
            seen.add(slug)
            digest = hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]
            pages.append({
                "slug": slug,
                "title": clean(label),
                "section": section,
                "hash": digest,
            })

    if not pages:
        sys.exit("No pages found - refusing to write an empty manifest")

    orphans = sorted(
        f for f in os.listdir(MANUAL)
        if f.endswith(".html") and f not in seen
    )
    if orphans:
        print(f"  ! not linked from the sidebar, so not in the manifest: {', '.join(orphans)}")

    # Screenshots feed the version too. A replaced or newly-added image leaves
    # every page's markup untouched, so hashing pages alone would let an
    # installed copy sit on stale artwork believing it was current.
    images, missing = set(), []
    for page in pages:
        source = open(os.path.join(MANUAL, page["slug"]), encoding="utf-8").read()
        for src in re.findall(r'<img[^>]+src="([^"]+)"', source):
            if src.startswith(("http://", "https://", "data:")):
                continue
            rel = src[3:] if src.startswith("../") else os.path.join("user-manual", src)
            path = os.path.join(ROOT, rel)
            if os.path.exists(path):
                images.add(rel)
            else:
                missing.append(f"{page['slug']} -> {src}")
    if missing:
        print("  ! referenced image(s) not in the repo, so they will be missing offline:")
        for m in missing:
            print(f"      {m}")

    image_digest = "".join(
        hashlib.sha256(open(os.path.join(ROOT, rel), "rb").read()).hexdigest()[:16]
        for rel in sorted(images)
    )

    manifest = {
        "version": hashlib.sha256(
            ("".join(p["hash"] for p in pages) + image_digest).encode()
        ).hexdigest()[:16],
        "pages": pages,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {os.path.relpath(OUT, ROOT)} - {len(pages)} pages, version {manifest['version']}")


if __name__ == "__main__":
    main()
