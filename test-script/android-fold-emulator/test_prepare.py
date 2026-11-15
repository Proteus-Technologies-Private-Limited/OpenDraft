import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from prepare import (
    HOOK,
    INSPECTION,
    MARKER,
    ROOT,
    configure,
    configure_test_speech,
    main,
)


class Prepare(unittest.TestCase):
    def test_local_run_requires_opt_in_before_any_patching(self):
        for environment in ({}, {"GITHUB_ACTIONS": "false"}, {"GITHUB_ACTIONS": "1"}):
            with self.subTest(environment=environment):
                with (
                    patch.dict("os.environ", environment, clear=True),
                    patch("prepare.subprocess.run") as run,
                    patch("prepare.configure") as configure_project,
                    redirect_stderr(io.StringIO()) as error,
                ):
                    with self.assertRaises(SystemExit) as result:
                        main([])
                    self.assertEqual(result.exception.code, 2)
                    self.assertIn("--allow-disposable-checkout", error.getvalue())
                    self.assertIn("src-tauri/tauri.conf.json", error.getvalue())
                    run.assert_not_called()
                    configure_project.assert_not_called()

    def test_ci_and_explicit_local_opt_in_allow_preparation(self):
        for environment, args in (
            ({"GITHUB_ACTIONS": "true"}, []),
            ({}, ["--allow-disposable-checkout"]),
            ({"GITHUB_ACTIONS": "false"}, ["--allow-disposable-checkout"]),
        ):
            with self.subTest(environment=environment, args=args):
                with (
                    patch.dict("os.environ", environment, clear=True),
                    patch("prepare.subprocess.run") as run,
                    patch("prepare.configure") as configure_project,
                ):
                    main(args)
                    self.assertEqual(
                        run.call_args.args[0][1],
                        str(ROOT / "test-script/patch-android-local.py"),
                    )
                    configure_project.assert_called_once_with(
                        ROOT / "src-tauri/gen/android",
                        ROOT / "src-tauri/tauri.conf.json",
                        ROOT / "src-tauri/android-src",
                    )

    def test_speech_fixture_is_confined_to_generated_test_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            gen, _, source = self.fixture(temp)
            manifest = gen / "app/src/main/AndroidManifest.xml"
            manifest.write_text(
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>'.replace(
                    "<application />", "<application></application>"
                )
            )
            configure_test_speech(gen)
            once = manifest.read_text()
            configure_test_speech(gen)
            self.assertEqual(manifest.read_text(), once)
            self.assertEqual(once.count(".TableReadTestSpeech"), 1)
            self.assertTrue(
                (
                    gen
                    / "app/src/main/java/com/proteus/opendraft/TableReadTestSpeech.kt"
                ).exists()
            )
            self.assertEqual(list(source.glob("*Speech*")), [])

    def fixture(self, temp):
        root = Path(temp)
        gen = root / "generated"
        java = gen / "app/src/main/java/com/proteus/opendraft"
        java.mkdir(parents=True)
        (gen / "app/src/main/AndroidManifest.xml").write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application></application></manifest>'
        )
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
            for name in ("MainActivity.kt", "WindowActivities.kt"):
                path = gen / "app/src/main/java/com/proteus/opendraft" / name
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
