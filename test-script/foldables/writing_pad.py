"""Writing-pad placement/state regressions. Run against Vite like regressions.py.

Only synthetic text and Chromium posture signals; no native Pencil, keyboard
or physical-device behavior is claimed. The existing handwriting request event
opens the pad without changing its native capability gate.
"""

import os
import unittest
from playwright.sync_api import Locator, expect
import regressions as fixture


class WritingPad(unittest.TestCase):
    setUpClass = classmethod(fixture.FoldableRegressions.setUpClass.__func__)
    tearDownClass = classmethod(fixture.FoldableRegressions.tearDownClass.__func__)
    setUp = fixture.FoldableRegressions.setUp
    tearDown = fixture.FoldableRegressions.tearDown
    posture = fixture.FoldableRegressions.posture

    def request(self) -> None:
        self.page.evaluate(
            "window.dispatchEvent(new CustomEvent('opendraft:handwriting'))"
        )
        self.page.locator(".scribble-area").wait_for()

    def field(self) -> Locator:
        return self.page.locator(".scribble-area")

    def check_transitions(self, fallback: bool = False) -> None:
        if fallback:
            self.page.evaluate("Element.prototype.moveBefore = undefined")
        self.request()
        field = self.field()
        field.fill("Keep the selected words in this draft.")
        field.evaluate(
            "el => {window.padField=el;el.focus();el.setSelectionRange(9,23)}"
        )
        for args, docked in [
            ((951, 669, "vertical", "folded"), True),
            ((1000, 1000, "horizontal", "folded"), True),
            ((390, 800, None), False),
            ((951, 669, "vertical", "continuous"), False),
            ((951, 669, "vertical", "folded"), True),
        ]:
            self.posture(*args)
            expect(field).to_have_value("Keep the selected words in this draft.")
            self.assertTrue(
                field.evaluate("el=>el===padField && el===document.activeElement")
            )
            self.assertEqual(
                field.evaluate("el=>[el.selectionStart,el.selectionEnd]"), [9, 23]
            )
            self.assertEqual(
                self.page.locator(".scribble-panel.is-docked").count(), int(docked)
            )
        self.page.keyboard.type("replacement")
        expect(field).to_have_value("Keep the replacement in this draft.")

    def test_draft_selection_and_focus_across_postures(self) -> None:
        self.check_transitions()

    def test_append_child_fallback(self) -> None:
        self.check_transitions(True)

    def test_tab_switch_repeated_request_and_escape(self) -> None:
        self.posture(951, 669, "vertical", "folded")
        self.request()
        self.field().fill("A retained writing draft")
        self.page.evaluate("testStore.getState().toggleLocationDatabase()")
        locations = self.page.get_by_role("tab", name="Locations", exact=True)
        locations.click()
        expect(self.field()).to_be_hidden()
        # Escape in another pane must not silently throw away the pad draft.
        locations.press("Escape")
        self.request()
        expect(self.field()).to_have_value("A retained writing draft")
        expect(self.page.locator("#fold-tab-handwriting")).to_have_attribute(
            "aria-selected", "true"
        )
        self.field().focus()
        self.page.keyboard.press("Escape")
        expect(self.page.locator(".scribble-panel")).to_have_count(0)
        expect(
            self.page.locator(".fold-panel-tabs [aria-selected=true]")
        ).to_be_focused()

    def test_live_insertion_target_and_undo(self) -> None:
        self.posture(951, 669, "vertical", "folded")
        self.page.evaluate("""testEditor.commands.setContent({type:'doc',content:[
            {type:'action',content:[{type:'text',text:'First target.'}]},
            {type:'action',content:[{type:'text',text:'Second target.'}]}]});
            testEditor.commands.setTextSelection(2)""")
        self.request()
        self.field().fill("Replacement")
        # Move the editor selection after opening, as a writer tapping the script does.
        self.page.evaluate("""() => {
            let pos;testEditor.state.doc.descendants((node,p)=>{if(node.isText && node.text==='Second target.')pos=p});
            testEditor.commands.setTextSelection({from:pos,to:pos+6});testEditor.commands.focus();
        }""")
        self.posture(1000, 1000, "horizontal", "folded")
        self.page.get_by_role("button", name="Insert", exact=True).click()
        expect(self.field()).to_have_value("")
        self.assertEqual(
            self.page.evaluate("testEditor.getText()"),
            "First target.\n\nReplacement target.",
        )
        self.page.evaluate("testEditor.commands.undo()")
        self.assertEqual(
            self.page.evaluate("testEditor.getText()"),
            "First target.\n\nSecond target.",
        )

    def test_ordinary_device_stays_floating(self) -> None:
        self.posture(1200, 900, None)
        self.page.reload()
        self.page.locator(".ProseMirror").wait_for()
        self.request()
        expect(self.page.locator(".scribble-panel.is-docked")).to_have_count(0)
        expect(self.page.locator("#fold-tab-handwriting")).to_have_count(0)
        expect(self.page.locator(".scribble-resize")).to_be_visible()
        self.field().fill("Ordinary desktop writing draft")
        self.posture(800, 900, None)
        expect(self.field()).to_have_value("Ordinary desktop writing draft")
        expect(self.page.locator(".scribble-panel.is-docked")).to_have_count(0)

    def test_geometry_short_pane_rtl_and_floating_preferences(self) -> None:
        self.page.evaluate(
            """localStorage.setItem('opendraft:handwritingSize',JSON.stringify({width:620,height:520}));
            localStorage.setItem('opendraft:handwritingPos',JSON.stringify({left:24,top:30}));"""
        )
        self.page.evaluate("""testEditor.commands.setContent({type:'doc',content:[
            {type:'sceneHeading',content:[{type:'text',text:'INT. WRITING ROOM - DAY'}]},
            {type:'action',content:[{type:'text',text:'A writer unfolds a blank page and begins a new scene.'}]}
        ]});testEditor.commands.setTextSelection(30)""")
        self.request()
        self.field().fill("Synthetic writing-pad layout fixture")
        self.posture(951, 669, "vertical", "folded")
        book = self.page.locator(".scribble-panel").bounding_box()
        self.assertGreaterEqual(book["x"], 485)
        self.assertLessEqual(book["x"] + book["width"], 952)
        self.page.evaluate("document.documentElement.dir='rtl'")
        self.posture(700, 700, "horizontal", "folded")
        pad = self.page.locator(".scribble-panel")
        rect = pad.bounding_box()
        self.assertGreaterEqual(rect["y"], 360)
        self.assertLessEqual(rect["y"] + rect["height"], 701)
        self.assertEqual(
            self.page.locator(".scribble-grip, .scribble-resize").count(), 0
        )
        for selector in [
            ".scribble-area",
            ".scribble-tool-key",
            ".scribble-btn-primary",
            ".scribble-close",
        ]:
            control = self.page.locator(selector).first
            control.scroll_into_view_if_needed()
            self.assertTrue(
                control.evaluate(
                    'el=>{const r=el.getBoundingClientRect();const p=el.closest(".scribble-panel").getBoundingClientRect();return r.top>=p.top-1 && r.bottom<=p.bottom+1}'
                )
            )
        # Docking must not write floating preferences.
        self.assertEqual(
            self.page.evaluate("localStorage.getItem('opendraft:handwritingSize')"),
            '{"width":620,"height":520}',
        )
        self.posture(390, 800, None)
        rect = pad.bounding_box()
        self.assertLessEqual(rect["x"] + rect["width"], 391)
        self.assertFalse("is-docked" in pad.get_attribute("class"))
        self.assertEqual(
            self.page.evaluate("document.documentElement.scrollWidth"), 390
        )
        self.assertEqual(
            self.page.evaluate("localStorage.getItem('opendraft:handwritingPos')"),
            '{"left":24,"top":30}',
        )
        self.posture(951, 669, "vertical", "folded")
        self.posture(1200, 900, "vertical", "continuous")
        rect = pad.bounding_box()
        self.assertEqual(
            [rect["x"], rect["y"], rect["width"], rect["height"]], [24, 30, 620, 520]
        )
        screenshots = os.environ.get("OPENDRAFT_SCREENSHOTS")
        if screenshots:
            os.makedirs(screenshots, exist_ok=True)
            self.page.evaluate("document.documentElement.dir='ltr'")
            for name, args in [
                ("book", (1100, 900, "vertical", "folded")),
                ("laptop", (1100, 1000, "horizontal", "folded")),
            ]:
                self.posture(*args)
                self.field().scroll_into_view_if_needed()
                self.page.screenshot(path=os.path.join(screenshots, name + ".png"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
