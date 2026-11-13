"""Generated local/release builds must include the same native bridge."""

import tempfile
import unittest
from pathlib import Path

from android_fold_build import ROOT, WINDOW_DEPENDENCY, patch_fold_bridge


class AndroidFoldBuild(unittest.TestCase):
    def test_generated_project_patch_is_idempotent_and_uses_release_source(self):
        with tempfile.TemporaryDirectory() as temp:
            gen = Path(temp)
            build = gen / "app/build.gradle.kts"
            build.parent.mkdir()
            original = 'plugins { id("com.android.application") }\n'
            build.write_text(original)
            src = ROOT / "src-tauri/android-src"
            patch_fold_bridge(gen, src)
            once = build.read_text()
            patch_fold_bridge(gen, src)
            self.assertEqual(build.read_text(), once)
            self.assertTrue(once.startswith(original))
            self.assertEqual(once.count(WINDOW_DEPENDENCY), 1)
            copied = (
                gen / "app/src/main/java/com/proteus/opendraft/FoldPostureBridge.kt"
            )
            self.assertEqual(copied.read_bytes(), (src / copied.name).read_bytes())

    def test_compile_harness_uses_the_same_dependency(self):
        build = ROOT / "test-script/android-fold/build.gradle.kts"
        self.assertIn(WINDOW_DEPENDENCY, build.read_text())


if __name__ == "__main__":
    unittest.main()
