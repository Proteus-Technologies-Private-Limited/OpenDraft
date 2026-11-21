#!/usr/bin/env python3
"""Install the native posture dependency in Tauri's generated project."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WINDOW_DEPENDENCY = 'implementation("androidx.window:window-java:1.3.0")'
# Google Play's in-app review sheet (MainActivity.requestReview). Keep the
# version in step with the "Configure Android dependencies" step in release.yml.
REVIEW_DEPENDENCY = 'implementation("com.google.android.play:review:2.0.2")'


def patch_window_dependency(gen: Path) -> None:
    """Add the native dependencies CI adds (the name predates the second one)."""
    build = gen / "app/build.gradle.kts"
    content = build.read_text()
    # Separate blocks avoid depending on Tauri's dependency block shape.
    if WINDOW_DEPENDENCY not in content:
        content += "\n// Native fold posture (#231).\ndependencies {\n    " + WINDOW_DEPENDENCY + "\n}\n"
    if REVIEW_DEPENDENCY not in content:
        content += "\n// Play in-app review.\ndependencies {\n    " + REVIEW_DEPENDENCY + "\n}\n"
    build.write_text(content)


if __name__ == "__main__":
    patch_window_dependency(ROOT / "src-tauri/gen/android")
