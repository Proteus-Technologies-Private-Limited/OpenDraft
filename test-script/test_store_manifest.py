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
    shutil.copyfile(ROOT / "landing" / "updates.json", manifest)

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
    before = json.loads((ROOT / "landing" / "updates.json").read_text())["channels"]
    channels = _run_against(tmp, [IOS_RECORD], [IOS_RECORD])
    assert channels["mas"]["version"] == before["mas"]["version"], channels["mas"]
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
        print("All tests passed.")
    finally:
        shutil.rmtree(_tmp, ignore_errors=True)
