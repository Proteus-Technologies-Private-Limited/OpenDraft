#!/usr/bin/env python3
"""
Move landing/updates.json's store channels once a store actually has the build.

release.sh moves the GitHub-hosted channels the moment a release is published.
Apple and Google are still reviewing then, so their entries stay put and this
script moves them later — by asking each store what it is really serving,
rather than by anyone remembering to.

That distinction matters: the failure mode of guessing is a notice telling
someone to update from a store page that still offers the version they have.

  Apple  itunes lookup, no credentials. Reports the reviewed, published
         version — exactly the question being asked. One record covers both
         the iOS and Mac App Store entries for this app id.
  Google no public equivalent, so the Play Developer API, which is fine here:
         this runs in CI with the service account submit-stores.yml already
         uses. A track release carries a name (the versionName) and the
         versionCodes; the name is preferred and the code is the fallback,
         since Tauri derives it as major*1000000 + minor*1000 + patch.

Prints `caught-up=true` on stdout when every store channel has reached the
target, which is the signal for the watch workflow to switch itself off.

    python3 test-script/refresh_store_manifest.py            # uses dmg channel as target
    python3 test-script/refresh_store_manifest.py --target 2.0.0
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO_ROOT, 'landing', 'updates.json')

APPLE_APP_ID = '6761807809'
PLAY_PACKAGE = 'com.proteus.opendraft'
TIMEOUT = 30


def version_tuple(v):
    out = []
    for part in str(v).split('.'):
        try:
            out.append(int(part))
        except ValueError:
            out.append(0)
    return tuple(out + [0] * (3 - len(out)))[:3]


def get_json(url, headers=None, data=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        body = res.read().decode('utf-8')
    return json.loads(body) if body.strip() else {}


# ── Apple ────────────────────────────────────────────────────────────────────

def apple_live_version():
    """The version the App Store is serving, or None if it cannot be read."""
    url = ('https://itunes.apple.com/lookup?'
           + urllib.parse.urlencode({'id': APPLE_APP_ID, 'country': 'us'}))
    try:
        data = get_json(url)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as err:
        print(f'  ! apple: lookup failed ({err})', file=sys.stderr)
        return None
    if not data.get('resultCount'):
        print('  ! apple: app id returned no results', file=sys.stderr)
        return None
    return data['results'][0].get('version')


# ── Google Play ──────────────────────────────────────────────────────────────

def play_access_token(sa_info):
    """Service-account bearer token for the Play Developer API."""
    try:
        from google.oauth2 import service_account
        # Needs `requests`, which google-auth does not depend on — it is the
        # google-auth[requests] extra. Report what actually failed: guessing
        # "not installed" here sent the v2.0.0 diagnosis after the wrong
        # package entirely.
        import google.auth.transport.requests as greq
    except ImportError as err:
        print(f'  ! play: cannot import the Play client ({err})', file=sys.stderr)
        return None
    creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=['https://www.googleapis.com/auth/androidpublisher'])
    creds.refresh(greq.Request())
    return creds.token


def version_name_from_code(code):
    """Tauri's Android versionCode scheme, run backwards."""
    code = int(code)
    return f'{code // 1000000}.{(code // 1000) % 1000}.{code % 1000}'


def play_live_version(sa_json):
    """The versionName Play is serving on the production track."""
    try:
        sa_info = json.loads(sa_json)
    except json.JSONDecodeError as err:
        print(f'  ! play: service account JSON is unreadable ({err})', file=sys.stderr)
        return None

    token = play_access_token(sa_info)
    if not token:
        return None

    base = ('https://androidpublisher.googleapis.com/androidpublisher/v3/'
            f'applications/{PLAY_PACKAGE}/edits')
    auth = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    edit_id = None
    try:
        edit_id = get_json(base, headers=auth, data=b'{}', method='POST').get('id')
        if not edit_id:
            print('  ! play: could not open an edit', file=sys.stderr)
            return None
        track = get_json(f'{base}/{edit_id}/tracks/production', headers=auth)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as err:
        print(f'  ! play: track read failed ({err})', file=sys.stderr)
        return None
    finally:
        # Edits expire on their own, but leaving them open blocks later ones.
        if edit_id:
            try:
                urllib.request.urlopen(urllib.request.Request(
                    f'{base}/{edit_id}', headers=auth, method='DELETE'), timeout=TIMEOUT)
            except Exception:
                pass

    live = [r for r in track.get('releases', []) if r.get('status') == 'completed']
    if not live:
        print('  ! play: no completed production release yet', file=sys.stderr)
        return None
    rel = live[-1]
    name = (rel.get('name') or '').strip()
    if name and name[0].isdigit():
        return name
    codes = rel.get('versionCodes') or []
    if codes:
        return version_name_from_code(max(int(c) for c in codes))
    return None


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', help='version the stores are catching up to '
                                     '(default: the dmg channel)')
    args = ap.parse_args()

    with open(MANIFEST, encoding='utf-8') as fh:
        data = json.load(fh)
    channels = data['channels']

    target = args.target or channels['dmg']['version']
    print(f'target: {target}')

    apple = apple_live_version()
    print(f'  apple live: {apple or "unknown"}')
    play = play_live_version(os.environ.get('PLAY_SERVICE_ACCOUNT_JSON', ''))
    print(f'  play  live: {play or "unknown"}')

    # One Apple record covers both storefront entries for this app id, so the
    # iOS and Mac App Store channels move together.
    found = {'ios': apple, 'mas': apple, 'play': play}

    changed = False
    for name, live in found.items():
        if name not in channels or not live:
            continue
        if channels[name]['version'] != live:
            print(f'  ✓ {name:5} {channels[name]["version"]} → {live}')
            channels[name]['version'] = live
            changed = True

    # Caught up means the manifest is finished, which needs both halves. The
    # download channels are only right once release.sh's bump has merged to
    # main, and that PR lands after the release is published — so checking the
    # stores alone would let the watch switch off while still advertising the
    # previous version's downloads.
    stores_ready = all(
        name in channels and version_tuple(channels[name]['version']) >= version_tuple(target)
        for name in ('ios', 'mas', 'play')
    )
    downloads_ready = all(
        name in channels and version_tuple(channels[name]['version']) == version_tuple(target)
        for name in ('dmg', 'win', 'linux', 'apk')
    )
    if not downloads_ready:
        print('  waiting: main still advertises the previous downloads')
    caught_up = stores_ready and downloads_ready

    if changed:
        with open(MANIFEST, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write('\n')

    behind = [n for n in ('ios', 'mas', 'play')
              if version_tuple(channels[n]['version']) < version_tuple(target)]
    if behind:
        print(f'still behind: {", ".join(behind)}')

    # Consumed by the workflow.
    print(f'changed={"true" if changed else "false"}')
    print(f'caught-up={"true" if caught_up else "false"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
