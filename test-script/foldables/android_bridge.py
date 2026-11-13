"""Synthetic native protocol through the real UI; no Android/OEM claim."""

import json
import os
import unittest
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


class AndroidBridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("OPENDRAFT_CHROMIUM")
            or ("/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None),
            args=["--no-sandbox"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def start(self, confirmed=True):
        self.page = self.browser.new_page(
            viewport={"width": 1000, "height": 800}, has_touch=True
        )
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.add_init_script("""
            localStorage.setItem('opendraft:hiddenModeIntroShown','1');
            window.nativeSnapshot={version:1,status:'available',active:true,
              confirmed:CONFIRMED,webView:{left:0,top:0,width:2000,height:1600},
              feature:CONFIRMED?{left:980,top:0,width:40,height:1600,orientation:'vertical',folded:true}:null};
            window.OpenDraftAndroidFold={snapshot:()=>JSON.stringify(window.nativeSnapshot)};
            """.replace("CONFIRMED", json.dumps(confirmed)))
        self.page.goto(os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/"))
        self.page.locator(".editor-main").wait_for()
        blank = self.page.get_by_role("button", name="Blank Document", exact=False)
        if blank.count():
            blank.click()
        self.page.locator(".ProseMirror").wait_for()
        self.page.evaluate("""async () => {
          let element=document.querySelector('.ProseMirror');
          while(element && !window.nativeEditor) {
            const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
            let fiber=key && element[key];
            while(fiber) {
              const editor=fiber.memoizedProps?.editor;
              if(editor?.commands && editor.state) {window.nativeEditor=editor;break;}
              fiber=fiber.return;
            }
            element=element.parentElement;
          }
          nativeEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'Synthetic Android bridge selection'}]}]});
          nativeEditor.commands.setTextSelection({from:1,to:10});
          nativeEditor.view.focus();
          window.originalEditorNode=document.querySelector('.ProseMirror');
          window.originalDoc=nativeEditor.state.doc;
        }""")

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def test_native_postures_preserve_the_editor_and_selection(self):
        self.start()
        self.page.wait_for_function(
            "document.documentElement.classList.contains('fold-book')"
        )
        self.assertEqual(
            self.page.evaluate(
                "getComputedStyle(document.documentElement).getPropertyValue('--fold-left').trim()"
            ),
            "490px",
        )
        self.page.evaluate("""() => {
          nativeSnapshot.feature={left:0,top:780,width:2000,height:40,orientation:'horizontal',folded:true};
          window.dispatchEvent(new Event('opendraft:androidfoldchange'));
        }""")
        self.page.wait_for_function(
            "document.documentElement.classList.contains('fold-laptop')"
        )
        self.page.set_viewport_size({"width": 390, "height": 800})
        self.page.evaluate("""() => {
          nativeSnapshot.feature=null;
          nativeSnapshot.webView={left:0,top:0,width:780,height:1600};
          window.dispatchEvent(new Event('opendraft:androidfoldchange'));
        }""")
        self.page.wait_for_function(
            """document.documentElement.classList.contains('foldable') &&
          document.documentElement.classList.contains('phone') &&
          !document.documentElement.classList.contains('fold-laptop')"""
        )
        expect(self.page.locator(".toolbar")).to_be_visible()
        self.assertTrue(
            self.page.evaluate(
                """document.querySelector('.ProseMirror')===originalEditorNode &&
              nativeEditor.state.doc.eq(originalDoc) && nativeEditor.state.selection.from===1 && nativeEditor.state.selection.to===10"""
            )
        )
        report = self.page.evaluate("""async () => {
          const {collectFoldDiagnostics}=await import('/src/services/foldDiagnostics.ts');
          return collectFoldDiagnostics();
        }""")
        self.assertEqual(report["nativeAndroid"]["status"], "available")
        self.assertTrue(report["nativeAndroid"]["confirmed"])
        self.assertIsNone(report["nativeAndroid"]["feature"])
        self.assertNotIn("Synthetic Android", json.dumps(report))

    def test_cold_cover_and_malformed_native_results_stay_ordinary(self):
        self.start(confirmed=False)
        self.page.set_viewport_size({"width": 390, "height": 800})
        self.page.evaluate("""() => {
          nativeSnapshot.webView={left:0,top:0,width:780,height:1600};
          window.dispatchEvent(new Event('opendraft:androidfoldchange'));
        }""")
        self.page.wait_for_function(
            "document.documentElement.classList.contains('phone')"
        )
        self.assertFalse(
            self.page.evaluate(
                "document.documentElement.classList.contains('foldable')"
            )
        )
        self.page.evaluate("""() => {
          nativeSnapshot={version:99,confirmed:true};
          window.dispatchEvent(new Event('opendraft:androidfoldchange'));
        }""")
        self.page.wait_for_function("""async () => {
          const {getFoldState,isFoldableDevice}=await import('/src/utils/foldPosture.ts');
          return getFoldState().fold==='flat' && !isFoldableDevice();
        }""")


if __name__ == "__main__":
    unittest.main(verbosity=2)
