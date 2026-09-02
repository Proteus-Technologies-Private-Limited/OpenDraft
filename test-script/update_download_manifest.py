#!/usr/bin/env python3
"""
Point landing/updates.json at a new release's downloads.

Run from release.sh alongside the other version bumps. It rewrites ONLY the
channels served straight off the GitHub release, because those are downloadable
the moment CI publishes it. The store channels are left exactly as they are:
Apple and Google are still reviewing at that point, and a manifest that named
the new version there would send people to a listing still offering the old
one. Those are moved later, by the store watch, once each store says the build
is actually live.

That is also why this is a script and not another sed in release.sh. A blanket
`s/"version": "0.26.3"/"version": "2.0.0"/g` would rewrite the play channel too
— silently, and only noticed by users being sent to a store that has nothing
new for them.

    python3 test-script/update_download_manifest.py 2.0.0
"""

import json
import os
import re
import sys

# Served from the GitHub release, live the moment it is published.
DOWNLOAD_CHANNELS = ('dmg', 'win', 'linux', 'apk')

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO_ROOT, 'landing', 'updates.json')

VERSION_RE = re.compile(r'^\d+\.\d+\.\d+$')


def bump_url(url: str, old: str, new: str) -> str:
    """Swap the version inside a release filename.

    Anchored to the separators around it so a version that happens to appear
    elsewhere in the URL is left alone — the filenames are of the shape
    OpenDraft_0.26.3_aarch64.dmg, so the number always sits between _ or -.
    """
    return re.sub(
        r'(?<=[_-])' + re.escape(old) + r'(?=[_-])',
        new,
        url,
    )


def main(argv):
    if len(argv) != 2 or not VERSION_RE.match(argv[1]):
        print(f'Usage: {os.path.basename(argv[0])} <X.Y.Z>', file=sys.stderr)
        return 2
    new = argv[1]

    try:
        with open(MANIFEST, encoding='utf-8') as fh:
            data = json.load(fh)
    except FileNotFoundError:
        print(f'error: {MANIFEST} not found', file=sys.stderr)
        return 1
    except json.JSONDecodeError as err:
        print(f'error: {MANIFEST} is not valid JSON: {err}', file=sys.stderr)
        return 1

    channels = data.get('channels')
    if not isinstance(channels, dict):
        print('error: updates.json has no "channels" object', file=sys.stderr)
        return 1

    missing = [c for c in DOWNLOAD_CHANNELS if c not in channels]
    if missing:
        # Refusing beats writing a manifest that quietly stops advertising a
        # platform — nobody on it would ever be told about an update again.
        print(f'error: updates.json is missing channels: {", ".join(missing)}',
              file=sys.stderr)
        return 1

    for name in DOWNLOAD_CHANNELS:
        entry = channels[name]
        old = entry.get('version')
        url = entry.get('url')
        if not old or not url:
            print(f'error: channel "{name}" has no version or url', file=sys.stderr)
            return 1
        if old == new:
            print(f'  = {name:5} already {new}')
            continue
        bumped = bump_url(url, old, new)
        if bumped == url:
            print(f'error: channel "{name}" url does not carry version {old}: {url}',
                  file=sys.stderr)
            return 1
        entry['version'] = new
        entry['url'] = bumped
        print(f'  ✓ {name:5} {old} → {new}')

    for name, entry in channels.items():
        if name not in DOWNLOAD_CHANNELS:
            print(f'  · {name:5} left at {entry.get("version")} (store watch owns this)')

    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
