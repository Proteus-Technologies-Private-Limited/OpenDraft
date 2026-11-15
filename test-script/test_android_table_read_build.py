"""Local, release and disposable builds must wire the same speech service."""

import importlib.util
import re
import tempfile
import textwrap
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "{http://schemas.android.com/apk/res/android}"
spec = importlib.util.spec_from_file_location(
    "local_android_read", ROOT / "test-script/patch-android-local.py"
)
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
release = (ROOT / ".github/workflows/release.yml").read_text()
release_patch = textwrap.dedent(
    release.split("# BEGIN TABLE READ MANIFEST", 1)[1].split(
        "# END TABLE READ MANIFEST", 1
    )[0]
)


class TableReadBuild(unittest.TestCase):
    def test_both_manifest_paths_are_idempotent_and_keep_existing_entries(self):
        original = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><queries /><application><activity android:name=".MainActivity" /></application></manifest>'
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "AndroidManifest.xml"
            manifest.write_text(original)
            with patch.object(local, "MANIFEST", manifest):
                local.patch_table_read()
                once = manifest.read_text()
                local.patch_table_read()
                self.assertEqual(once, manifest.read_text())
            namespace = {"content": original, "re": re}
            exec(release_patch, namespace)
            self.assertEqual(once, namespace["content"])
            exec(release_patch, namespace)
            self.assertEqual(once, namespace["content"])
            root = ET.fromstring(once)
            self.assertIsNotNone(root.find("queries"))
            self.assertEqual(len(root.findall("uses-permission")), 3)
            service = root.find("application/service")
            self.assertEqual(service.get(ANDROID + "name"), ".TableReadService")
            self.assertEqual(
                service.get(ANDROID + "foregroundServiceType"), "mediaPlayback"
            )
            self.assertEqual(service.get(ANDROID + "exported"), "false")
            self.assertEqual(service.get(ANDROID + "stopWithTask"), "false")
            self.assertNotIn("TableReadTestSpeech", once)

    def test_invalid_manifest_is_refused_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "AndroidManifest.xml"
            manifest.write_text("<manifest />")
            with patch.object(local, "MANIFEST", manifest):
                with self.assertRaises(ValueError):
                    local.patch_table_read()
            self.assertEqual(manifest.read_text(), "<manifest />")
            with self.assertRaises(ValueError):
                exec(release_patch, {"content": "<manifest />", "re": re})

    def test_existing_service_is_upgraded_without_changing_other_services(self):
        original = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><service android:name=".TableReadService" android:stopWithTask="true" /><service android:name=".Other" android:stopWithTask="true" /></application></manifest>'
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "AndroidManifest.xml"
            manifest.write_text(original)
            with patch.object(local, "MANIFEST", manifest):
                local.patch_table_read()
            namespace = {"content": original, "re": re}
            exec(release_patch, namespace)
            self.assertEqual(manifest.read_text(), namespace["content"])
            services = ET.fromstring(namespace["content"]).findall(
                "application/service"
            )
            self.assertEqual(services[0].get(ANDROID + "stopWithTask"), "false")
            self.assertEqual(services[1].get(ANDROID + "stopWithTask"), "true")

    def test_production_sources_and_jni_survive_both_build_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            gen = Path(temp)
            java = gen / "app/src/main/java/com/proteus/opendraft"
            with patch.object(local, "GEN", gen), patch.object(local, "JAVA", java):
                local.copy_sources()
            for name in ("TableReadService.kt", "TableReadPlayback.kt"):
                self.assertEqual(
                    (java / name).read_bytes(), (local.SRC / name).read_bytes()
                )
                self.assertIn(
                    f'cp src-tauri/android-src/{name} "$JAVA_DIR/{name}"', release
                )
            self.assertFalse((java / "TableReadTestSpeech.kt").exists())
        keep = (local.SRC / "jni-keep-rules.pro").read_text()
        self.assertIn(
            "ttsTableReadRequest(android.content.Context, java.lang.String)", keep
        )


if __name__ == "__main__":
    unittest.main()
