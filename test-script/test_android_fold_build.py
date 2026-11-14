"""Generated local/release builds must include the same native bridge."""

import importlib.util
from unittest.mock import patch
import tempfile
import unittest
from pathlib import Path

from android_fold_build import ROOT, WINDOW_DEPENDENCY, patch_fold_bridge


class AndroidFoldBuild(unittest.TestCase):
    def test_generated_project_patch_is_idempotent(self):
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

    def test_local_and_release_copy_bridge_with_the_other_sources(self):
        spec = importlib.util.spec_from_file_location("local_android", ROOT / "test-script/patch-android-local.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            gen = Path(temp)
            java = gen / "app/src/main/java/com/proteus/opendraft"
            with patch.object(module, "GEN", gen), patch.object(module, "JAVA", java):
                module.copy_sources()
            copied = java / "FoldPostureBridge.kt"
            self.assertEqual(copied.read_bytes(), (module.SRC / copied.name).read_bytes())
        release = (ROOT / ".github/workflows/release.yml").read_text()
        self.assertNotIn("python3 test-script/android_fold_build.py", release)
        self.assertIn('cp src-tauri/android-src/FoldPostureBridge.kt "$JAVA_DIR/FoldPostureBridge.kt"', release)
        self.assertIn(WINDOW_DEPENDENCY, release)

    def test_compile_harness_uses_the_same_dependency(self):
        build = ROOT / "test-script/android-fold/build.gradle.kts"
        self.assertIn(WINDOW_DEPENDENCY, build.read_text())


if __name__ == "__main__":
    unittest.main()
