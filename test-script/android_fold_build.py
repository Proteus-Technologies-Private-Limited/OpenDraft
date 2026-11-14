#!/usr/bin/env python3
"""Install the native posture dependency in Tauri's generated project."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WINDOW_DEPENDENCY = 'implementation("androidx.window:window-java:1.3.0")'


def patch_fold_bridge(gen: Path, src: Path) -> None:
    build = gen / "app/build.gradle.kts"
    content = build.read_text()
    if WINDOW_DEPENDENCY not in content:
        # A separate block avoids depending on Tauri's dependency block shape.
        build.write_text(
            content
            + "\n// Native fold posture (#231).\ndependencies {\n    "
            + WINDOW_DEPENDENCY
            + "\n}\n"
        )


if __name__ == "__main__":
    patch_fold_bridge(ROOT / "src-tauri/gen/android", ROOT / "src-tauri/android-src")
