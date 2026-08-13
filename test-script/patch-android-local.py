#!/usr/bin/env python3
"""
Make a local Android build match what CI produces.

`tauri android init` generates src-tauri/gen/android/ from Tauri's template,
which knows nothing about this app's custom sources or its extra windows. CI
copies those in and patches the manifest (see .github/workflows/release.yml);
a local build does not, so a locally-built APK is missing:

  - MainActivity.kt      — file picker, export, new-intent and backup helpers
  - WindowActivities.kt  — the extra windows (issue #63)
  - file_paths.xml       — FileProvider paths for the export share sheet
  - the <activity> entries for WindowActivity1..3, without which
    File -> New Window fails: tao starts a window *by class name*, and an
    undeclared activity cannot be started at all

Run this after `tauri android init` and before `tauri android build`. It is
idempotent — patching an already-patched manifest changes nothing.

    python3 test-script/patch-android-local.py
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "src-tauri/gen/android"
SRC = ROOT / "src-tauri/android-src"
JAVA = GEN / "app/src/main/java/com/proteus/opendraft"
MANIFEST = GEN / "app/src/main/AndroidManifest.xml"

# One <activity> per class in WindowActivities.kt; keep in step with
# ANDROID_EXTRA_WINDOWS in src-tauri/src/lib.rs.
EXTRA_WINDOWS = 3


def copy_sources() -> None:
    JAVA.mkdir(parents=True, exist_ok=True)
    for name in ("MainActivity.kt", "WindowActivities.kt"):
        shutil.copy(SRC / name, JAVA / name)
        print(f"copied {name}")

    xml_dir = GEN / "app/src/main/res/xml"
    xml_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(SRC / "file_paths.xml", xml_dir / "file_paths.xml")
    print("copied file_paths.xml")


def patch_manifest() -> None:
    content = MANIFEST.read_text()

    if "WindowActivity1" in content:
        print("manifest already declares the extra windows — nothing to do")
        return

    main_activity = re.search(
        r'<activity\b([^>]*?android:name="\.MainActivity"[^>]*?)>', content
    )
    if not main_activity:
        sys.exit("MainActivity not found in the manifest — did `tauri android init` run?")

    # Attributes are cloned from MainActivity rather than written out, so the
    # extra windows keep whatever configChanges and theme Tauri's template
    # declares. A configChanges mismatch would have Android recreate the
    # activity on rotation and throw the WebView away with it.
    attrs = main_activity.group(1)
    for key in ("name", "launchMode", "exported", "documentLaunchMode",
                "resizeableActivity", "taskAffinity"):
        attrs = re.sub(r'\s*android:%s="[^"]*"' % key, "", attrs)
    attrs = attrs.rstrip()

    extra = ""
    for n in range(1, EXTRA_WINDOWS + 1):
        # documentLaunchMode="always" is what makes a window its own entry in
        # Recents; without it the activity lands on top of the first one in the
        # same task and cannot be tiled beside it. taskAffinity is cleared for
        # the same reason.
        extra += (
            '\n        <activity%s\n'
            '            android:name=".WindowActivity%d"\n'
            '            android:exported="false"\n'
            '            android:taskAffinity=""\n'
            '            android:resizeableActivity="true"\n'
            '            android:documentLaunchMode="always" />' % (attrs, n)
        )

    if "</application>" not in content:
        sys.exit("</application> not found in the manifest — cannot add the windows")

    content = content.replace("</application>", extra + "\n    </application>", 1)
    MANIFEST.write_text(content)
    print(f"manifest patched with {EXTRA_WINDOWS} extra window activities")


if __name__ == "__main__":
    if not GEN.exists():
        sys.exit("src-tauri/gen/android does not exist — run `tauri android init` first")
    copy_sources()
    patch_manifest()
