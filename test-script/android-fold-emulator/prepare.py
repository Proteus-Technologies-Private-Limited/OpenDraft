#!/usr/bin/env python3
"""Prepare a disposable generated project, never a distributable APK."""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MARKER = "// OpenDraft emulator integration signing (test APK only)."
HOOK = "        FoldPostureBridge.attach(this, webView)"
INSPECTION = "        android.webkit.WebView.setWebContentsDebuggingEnabled(true) // CI TEST APK ONLY"


def configure(gen: Path, config: Path, source: Path) -> None:
    build = gen / "app/build.gradle.kts"
    text = build.read_text()
    if "isMinifyEnabled = true" not in text:
        raise ValueError("Generated release build must enable R8")
    if MARKER not in text:
        build.write_text(
            text + "\n" + MARKER + "\nandroid {\n"
            '    buildTypes.getByName("release").signingConfig = signingConfigs.getByName("debug")\n}\n'
        )
    java = gen / "app/src/main/java/com/proteus/opendraft"
    for name in ("MainActivity.kt", "WindowActivities.kt"):
        path = java / name
        text = path.read_text()
        if text.count(HOOK) != 1:
            raise ValueError(f"Expected one native WebView bridge hook in {name}")
        if INSPECTION not in text:
            path.write_text(text.replace(HOOK, INSPECTION + "\n" + HOOK, 1))
    # Local patching copies the Kotlin/resources. Include the same R8 rules as
    # release CI too; otherwise a minified test would exercise different rules.
    shutil.copy(source / "jni-keep-rules.pro", gen / "app/jni-keep-rules.pro")
    cfg = json.loads(config.read_text())
    cfg["build"]["beforeBuildCommand"] = ""
    cfg["build"]["beforeDevCommand"] = ""
    cfg["bundle"].pop("externalBin", None)
    config.write_text(json.dumps(cfg, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    subprocess.run(
        [sys.executable, str(ROOT / "test-script/patch-android-local.py")], check=True
    )
    configure(
        ROOT / "src-tauri/gen/android",
        ROOT / "src-tauri/tauri.conf.json",
        ROOT / "src-tauri/android-src",
    )
