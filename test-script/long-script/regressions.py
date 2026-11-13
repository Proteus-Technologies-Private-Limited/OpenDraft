"""Long-script behavior in real Chromium/WebKit; no speed or native-driver claim."""

import importlib.util
import json
import os
from pathlib import Path
import unittest

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "menu_fixture", ROOT / "test-script/menu-keyboard/regressions.py"
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class LongScript(unittest.TestCase):
    setUp = fixture.MenuKeyboard.setUp
    start_page = fixture.MenuKeyboard.start_page
    tearDown = fixture.MenuKeyboard.tearDown

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = fixture.launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def exercise(self, navigator, spellcheck):
        self.page.evaluate(
            """async config => {
            const {screenplay}=await import('/src/test/fixtures/longScreenplay.mjs');
            testEditor.commands.setContent(screenplay(182));
            const state=testStore.getState();
            if(state.navigatorOpen!==config.navigator) state.toggleNavigator();
            state.setSpellCheckEnabled(config.spellcheck);
            window.beforeLong=testEditor.state.doc;
        }""",
            {"navigator": navigator, "spellcheck": spellcheck},
        )
        self.page.wait_for_function("testStore.getState().pageCount >= 140")
        expect(self.page.locator(".page-sep")).not_to_have_count(0)
        if navigator:
            expect(self.page.locator(".scene-navigator")).to_be_visible()
        if spellcheck:
            expect(self.page.locator(".spell-error").first).to_be_visible()
        else:
            expect(self.page.locator(".spell-error")).to_have_count(0)

        scroller = self.page.locator(".editor-main")
        selection = self.page.evaluate(
            "({from:testEditor.state.selection.from,to:testEditor.state.selection.to})"
        )
        box = scroller.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.wheel(0, 1800)
        self.page.wait_for_function(
            "document.querySelector('.editor-main').scrollTop > 500"
        )
        self.assertEqual(
            self.page.evaluate(
                "({from:testEditor.state.selection.from,to:testEditor.state.selection.to})"
            ),
            selection,
        )
        self.assertTrue(self.page.evaluate("testEditor.state.doc.eq(beforeLong)"))
        forward = scroller.evaluate("el=>el.scrollTop")
        self.page.mouse.wheel(0, -600)
        self.page.wait_for_function(
            "top=>document.querySelector('.editor-main').scrollTop < top-200",
            arg=forward,
        )
        self.assertEqual(
            self.page.evaluate(
                "({from:testEditor.state.selection.from,to:testEditor.state.selection.to})"
            ),
            selection,
        )

        target = self.page.evaluate("""() => {
            const doc=testEditor.state.doc;let target=null,index=0;
            doc.forEach((node,offset)=>{
                if(target===null && index>=doc.childCount/2 && node.type.name==='dialogue') target=offset+node.nodeSize-1;
                index++;
            });
            testEditor.chain().setTextSelection(target).scrollIntoView().run();
            testEditor.view.focus();
            window.longKeys=[];
            document.addEventListener('keydown',e=>{if(e.key==='Backspace')longKeys.push(e.repeat)},true);
            return target;
        }""")
        editor = self.page.get_by_role("textbox", name="Screenplay editor")
        expect(editor).to_be_focused()
        text = " synthetic regression"
        self.page.keyboard.type(text)
        self.page.wait_for_function(
            "testEditor.state.doc.content.size===beforeLong.content.size+"
            + str(len(text))
        )
        try:
            # Repeated down events carry repeat=true, as a held key does. The
            # test does not claim to simulate OS repeat scheduling or an IME.
            for _ in text:
                self.page.keyboard.down("Backspace")
        finally:
            self.page.keyboard.up("Backspace")
        self.assertEqual(
            self.page.evaluate("longKeys"), [False] + [True] * (len(text) - 1)
        )
        self.assertTrue(self.page.evaluate("testEditor.state.doc.eq(beforeLong)"))
        self.assertEqual(self.page.evaluate("testEditor.state.selection.from"), target)
        expect(editor).to_be_focused()

        self.page.evaluate("""async () => {
            window.closeUndoGroup=(await import('/src/test/fixtures/browserActions.ts')).closeUndoGroup;
            closeUndoGroup(testEditor);
        }""")
        self.page.keyboard.type(" undo probe")
        self.page.wait_for_function("!testEditor.state.doc.eq(beforeLong)")
        modifier = (
            "Meta"
            if self.page.evaluate("/Mac/i.test(navigator.platform)")
            else "Control"
        )
        self.page.keyboard.press(modifier + "+z")
        self.page.wait_for_function("testEditor.state.doc.eq(beforeLong)")
        expect(editor).to_be_focused()
        self.assertEqual(
            self.page.evaluate("testStore.getState().spellCheckEnabled"), spellcheck
        )
        result = self.page.evaluate("""() => ({pages:testStore.getState().pageCount,
            blocks:testEditor.state.doc.childCount,scrollTop:document.querySelector('.editor-main').scrollTop,
            caret:testEditor.state.selection.from,repeatedKeys:longKeys.length})""")
        result.update(
            navigator=navigator,
            spellcheck=spellcheck,
            browser=os.environ.get("OPENDRAFT_BROWSER", "chromium"),
            browserVersion=self.browser.version,
        )
        output = os.environ.get("OPENDRAFT_LONG_SCRIPT_OUTPUT")
        if output:
            folder = Path(output)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / (self._testMethodName + ".json")).write_text(
                json.dumps(result, indent=2) + "\n"
            )

    def test_navigator_off_spellcheck_off(self):
        self.exercise(False, False)

    def test_navigator_off_spellcheck_on(self):
        self.exercise(False, True)

    def test_navigator_on_spellcheck_off(self):
        self.exercise(True, False)

    def test_navigator_on_spellcheck_on(self):
        self.exercise(True, True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
