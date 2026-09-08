"""Tests for refresh_store_manifest.py — the Apple half, with no network.

The bug these exist for: the iOS and Mac App Store entries share an app id, so
the watch read one lookup record and wrote it to both channels. When review
had approved the Mac build of 2.1.0 and not the iOS one, `mas` was pinned to
the iOS 2.0.0 and Mac App Store users on 2.0.0 were told they were up to date.

Run from project root:
    python3 test-script/test_store_manifest.py
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "test-script"))

import refresh_store_manifest as rsm  # noqa: E402

IOS_RECORD = {"kind": "software", "version": "2.0.0"}
MAC_RECORD = {"kind": "mac-software", "version": "2.1.0"}

# A manifest of the shape these tests reason about, rather than a copy of the
# shipped one: landing/updates.json moves with every release, and copying it
# made the expected versions here go stale the moment it did — the suite was
# failing on main against the 2.2.0 manifest before anything below changed.
STORE_URL = "https://apps.apple.com/us/app/open-draft-screenwriting/id6761807809"
FIXTURE = {
    "channels": {
        "dmg": {"version": "2.1.0", "url": "https://example.invalid/dmg"},
        "win": {"version": "2.1.0", "url": "https://example.invalid/exe"},
        "linux": {"version": "2.1.0", "url": "https://example.invalid/AppImage"},
        "apk": {"version": "2.1.0", "url": "https://example.invalid/apk"},
        "ios": {"version": "2.0.0", "url": STORE_URL},
        "mas": {"version": "2.0.0", "url": STORE_URL},
        "play": {"version": "0.26.3", "url": "https://example.invalid/play"},
    }
}


def test_picks_the_record_for_the_platform_asked_about():
    both = [IOS_RECORD, MAC_RECORD]
    assert rsm.apple_version_of(both, "software") == "2.0.0"
    assert rsm.apple_version_of(both, "mac-software") == "2.1.0"
    print("  ok: each platform reads its own record")


def test_the_other_platforms_record_is_not_an_answer():
    # The regression. A Mac lookup that comes back with only the iOS record
    # must report nothing rather than the iOS version: a channel left behind
    # keeps the watch running, while a channel pinned to the wrong version
    # silences the notice for everyone on that store.
    assert rsm.apple_version_of([IOS_RECORD], "mac-software") is None
    assert rsm.apple_version_of([MAC_RECORD], "software") is None
    assert rsm.apple_version_of([], "software") is None
    print("  ok: a missing record reads as unknown, not as the other platform")


def _run_against(tmp, ios_results, mac_results, published=None):
    """main() over a copy of the manifest, with both stores stubbed out."""
    manifest = tmp / "updates.json"
    manifest.write_text(json.dumps(FIXTURE))

    def fake_get_json(url, headers=None, data=None, method=None):
        return {"results": mac_results if "macSoftware" in url else ios_results}

    real_manifest, real_get_json, real_play = rsm.MANIFEST, rsm.get_json, rsm.play_live_version
    rsm.MANIFEST = str(manifest)
    rsm.get_json = fake_get_json
    rsm.play_live_version = lambda _sa: "2.1.0"
    argv = sys.argv
    sys.argv = ["refresh_store_manifest.py", "--target", "2.1.0"]
    if published is not None:
        previous = tmp / "previous.json"
        previous.write_text(json.dumps({"channels": published}))
        sys.argv += ["--previous", str(previous)]
    try:
        rsm.main()
    finally:
        sys.argv = argv
        rsm.MANIFEST, rsm.get_json, rsm.play_live_version = real_manifest, real_get_json, real_play

    with open(manifest, encoding="utf-8") as fh:
        return json.load(fh)["channels"]


def test_mac_channel_follows_the_mac_store(tmp):
    channels = _run_against(tmp, [IOS_RECORD], [MAC_RECORD])
    assert channels["mas"]["version"] == "2.1.0", channels["mas"]
    assert channels["ios"]["version"] == "2.0.0", channels["ios"]
    print("  ok: mas moves to 2.1.0 while ios stays at 2.0.0")


def test_an_unreadable_mac_record_leaves_the_channel_alone(tmp):
    before = FIXTURE["channels"]["mas"]["version"]
    channels = _run_against(tmp, [IOS_RECORD], [IOS_RECORD])
    assert channels["mas"]["version"] == before, channels["mas"]
    print("  ok: mas is left where it was rather than taking the iOS version")


def test_a_failed_lookup_keeps_what_was_published(tmp):
    # main's store entries are moved by hand and lag; the published manifest is
    # the truth. A run that cannot read the Mac record must republish 2.1.0,
    # not fall back to main's 1.8 and silence the notice for that store.
    channels = _run_against(tmp, [IOS_RECORD], [IOS_RECORD],
                            published={"mas": {"version": "2.1.0"}})
    assert channels["mas"]["version"] == "2.1.0", channels["mas"]
    print("  ok: an unanswerable lookup republishes the last known version")


def test_a_stale_lookup_does_not_move_a_channel_backwards(tmp):
    channels = _run_against(tmp, [IOS_RECORD], [{"kind": "mac-software", "version": "2.0.0"}],
                            published={"mas": {"version": "2.1.0"}})
    assert channels["mas"]["version"] == "2.1.0", channels["mas"]
    print("  ok: a lookup answering from cache does not undo a bump")


def _lookup_urls(mac_answer_shape=None):
    """Every lookup URL one mac-software read sends, and what it read.

    `mac_answer_shape` is the query fragment that is allowed to answer with the
    Mac record; every other shape gets the iOS one, which is what Apple returns
    when it does not honour the entity asked for.
    """
    urls = []

    def fake_get_json(url, headers=None, data=None, method=None):
        urls.append(url)
        answers = mac_answer_shape is not None and mac_answer_shape in url
        return {"results": [MAC_RECORD] if answers else [IOS_RECORD]}

    real = rsm.get_json
    rsm.get_json = fake_get_json
    try:
        return urls, rsm.apple_live_version("mac-software")
    finally:
        rsm.get_json = real


def test_the_mac_lookup_pairs_the_entity_with_its_media():
    # The regression this pair exists for: `entity` selects a record within a
    # media type, so sent alone it is dropped and the lookup answers with the
    # iOS record. The kind check then reported the Mac App Store as unknown on
    # every run, and mas stopped moving. Asserted on the URL because the older
    # tests stubbed the fetch and never looked at one.
    urls, _ = _lookup_urls()
    assert urls, "no lookup was attempted"
    assert "media=software" in urls[0] and "entity=macSoftware" in urls[0], urls[0]
    print("  ok: the first mac lookup names the media its entity belongs to")


def test_the_mac_version_is_read_from_the_paired_lookup():
    urls, version = _lookup_urls(mac_answer_shape="media=software")
    assert version == "2.1.0", version
    assert len(urls) == 1, urls          # answered, so nothing more is asked
    print("  ok: mas reads the Mac record the paired lookup returns")


def test_the_bare_lookup_is_still_tried():
    # Kept as a fallback rather than replaced: whatever the bare form can still
    # answer stays answered.
    urls, version = _lookup_urls(mac_answer_shape="country=us&entity=macSoftware")
    assert version == "2.1.0", version
    assert len(urls) == 2, urls
    print("  ok: a storefront that only answers the bare form is still read")


def test_a_lookup_that_never_answers_reads_as_unknown():
    urls, version = _lookup_urls()
    assert version is None, version
    assert len(urls) == 2, urls
    print("  ok: every shape refused, so the channel is left alone")


if __name__ == "__main__":
    print("Running store manifest tests…")
    _tmp = Path(tempfile.mkdtemp(prefix="opendraft-manifest-"))
    try:
        test_picks_the_record_for_the_platform_asked_about()
        test_the_other_platforms_record_is_not_an_answer()
        test_mac_channel_follows_the_mac_store(_tmp)
        test_an_unreadable_mac_record_leaves_the_channel_alone(_tmp)
        test_a_failed_lookup_keeps_what_was_published(_tmp)
        test_a_stale_lookup_does_not_move_a_channel_backwards(_tmp)
        test_the_mac_lookup_pairs_the_entity_with_its_media()
        test_the_mac_version_is_read_from_the_paired_lookup()
        test_the_bare_lookup_is_still_tried()
        test_a_lookup_that_never_answers_reads_as_unknown()
        print("All tests passed.")
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
