import json
import tempfile
import unittest
from pathlib import Path

from prepare import HOOK, INSPECTION, MARKER, configure


class Prepare(unittest.TestCase):
    def fixture(self, temp):
        root = Path(temp)
        gen = root / "generated"
        java = gen / "app/src/main/java/com/proteus/opendraft"
        java.mkdir(parents=True)
        for name in ("MainActivity.kt", "WindowActivities.kt"):
            (java / name).write_text("fun onWebViewCreate() {\n" + HOOK + "\n}\n")
        (gen / "app/build.gradle.kts").write_text(
            "android { isMinifyEnabled = true }\n"
        )
        source = root / "source"
        source.mkdir()
        (source / "jni-keep-rules.pro").write_text("keep production rules\n")
        cfg = root / "config.json"
        cfg.write_text(
            json.dumps(
                {
                    "build": {"frontendDist": "../frontend/dist"},
                    "bundle": {"externalBin": ["sidecar"]},
                    "app": {"security": {"csp": "original"}},
                }
            )
        )
        return gen, cfg, source

    def test_only_generated_sources_are_inspectable_and_patch_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            gen, cfg, source = self.fixture(temp)
            configure(gen, cfg, source)
            configure(gen, cfg, source)
            for path in (gen / "app/src/main/java/com/proteus/opendraft").glob("*.kt"):
                self.assertEqual(path.read_text().count(INSPECTION), 1)
                self.assertEqual(path.read_text().count(HOOK), 1)
            self.assertEqual(
                (gen / "app/build.gradle.kts").read_text().count(MARKER), 1
            )
            self.assertEqual(
                (gen / "app/jni-keep-rules.pro").read_text(), "keep production rules\n"
            )
            data = json.loads(cfg.read_text())
            self.assertEqual(data["app"]["security"]["csp"], "original")
            self.assertEqual(data["build"]["frontendDist"], "../frontend/dist")
            self.assertEqual(data["build"]["beforeBuildCommand"], "")
            self.assertNotIn("externalBin", data["bundle"])

    def test_refuses_a_non_minified_release_or_a_changed_hook(self):
        with tempfile.TemporaryDirectory() as temp:
            gen, cfg, source = self.fixture(temp)
            build = gen / "app/build.gradle.kts"
            build.write_text("isMinifyEnabled = false")
            with self.assertRaisesRegex(ValueError, "enable R8"):
                configure(gen, cfg, source)
            build.write_text("isMinifyEnabled = true")
            (
                gen / "app/src/main/java/com/proteus/opendraft/MainActivity.kt"
            ).write_text("changed template")
            with self.assertRaisesRegex(ValueError, "bridge hook"):
                configure(gen, cfg, source)


if __name__ == "__main__":
    unittest.main()
