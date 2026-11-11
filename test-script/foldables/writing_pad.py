"""Writing-pad placement/state regressions. Run against Vite like regressions.py.

Only synthetic text and Chromium posture signals; no native Pencil, keyboard
or physical-device behavior is claimed. The existing handwriting request event
opens the pad without changing its native capability gate.
"""

import os
import re
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
        self.ordinary()
        self.request()
        expect(self.page.locator(".scribble-panel.is-docked")).to_have_count(0)
        expect(self.page.locator("#fold-tab-handwriting")).to_have_count(0)
        expect(self.page.locator(".scribble-resize")).to_be_visible()
        self.field().fill("Ordinary desktop writing draft")
        self.posture(800, 900, None)
        expect(self.field()).to_have_value("Ordinary desktop writing draft")
        expect(self.page.locator(".scribble-panel.is-docked")).to_have_count(0)
        field = self.field()
        field.evaluate("el=>window.padField=el")
        self.assertTrue(field.evaluate('el=>!el.closest(".editor-layout")'))
        self.page.evaluate("testStore.getState().setFocusMode(true)")
        expect(field).to_be_visible()
        self.assertTrue(
            field.evaluate("el=>el===padField && el.getBoundingClientRect().width>0")
        )
        self.page.evaluate("testStore.getState().setFocusMode(false)")
        self.page.locator(".ProseMirror").focus()
        self.page.keyboard.press("Escape")
        expect(self.page.locator(".scribble-panel")).to_have_count(0)

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

    def ordinary(self) -> None:
        self.posture(1280, 800, None)
        self.page.reload()
        self.page.locator(".ProseMirror").wait_for()
        self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/editorStore.ts').name;
            window.testStore=(await import(url)).useEditorStore;
        }""")

    def test_focus_mode_floats_the_same_draft_on_foldables(self) -> None:
        self.posture(951, 669, "vertical", "folded")
        self.request()
        field = self.field()
        field.fill("Keep the Focus Mode writing draft")
        field.evaluate("el=>{window.padField=el;el.focus();el.setSelectionRange(5,10)}")
        expect(self.page.locator(".scribble-panel")).to_have_attribute("role", "region")
        self.page.evaluate("testStore.getState().setFocusMode(true)")
        expect(self.page.locator(".app-container")).to_have_class(
            re.compile(r"focus-mode")
        )
        expect(self.page.locator(".scribble-panel.is-docked")).to_have_count(0)
        expect(field).to_be_visible()
        self.assertTrue(
            field.evaluate('el=>el===padField && !el.closest(".editor-layout")')
        )
        self.assertEqual(
            field.evaluate("el=>[el.selectionStart,el.selectionEnd]"), [5, 10]
        )
        self.assertTrue(field.evaluate("el=>el===document.activeElement"))
        shots = os.environ.get("OPENDRAFT_SCREENSHOTS")
        if shots:
            os.makedirs(shots, exist_ok=True)
            self.page.screenshot(path=os.path.join(shots, "focus-mode.png"))
        self.page.evaluate("testStore.getState().setFocusMode(false)")
        self.page.wait_for_function("!document.fullscreenElement")
        # Browser fullscreen can replace CDP's synthetic screen metrics. Restore
        # the book fixture after it exits, then check docking and the same field.
        self.posture(951, 669, "vertical", "folded")
        # Chromium drops the legacy displayFeature override on fullscreen exit;
        # restore the feature explicitly, even when the metrics did not change.
        self.cdp.send(
            "Emulation.setDisplayFeaturesOverride",
            {
                "features": [
                    {"orientation": "vertical", "offset": 465, "maskLength": 20}
                ]
            },
        )
        self.page.wait_for_function("window.viewport.segments.length===2")
        expect(self.page.locator(".scribble-panel.is-docked")).to_be_visible()
        expect(field).to_have_value("Keep the Focus Mode writing draft")
        self.assertTrue(field.evaluate("el=>el===padField"))

    def test_keyboard_viewport_floats_and_restores_the_draft(self) -> None:
        self.posture(1000, 1000, "horizontal", "folded")
        self.request()
        field = self.field()
        field.fill("Keep this draft above the keyboard")
        field.evaluate("el=>{window.padField=el;el.focus();el.setSelectionRange(5,9)}")
        prefs = self.page.evaluate(
            "[localStorage.getItem('opendraft:handwritingPos'),localStorage.getItem('opendraft:handwritingSize')]"
        )
        # Exercise the existing Keyboard toggle, then supply only browser viewport
        # geometry. This is not a native keyboard/device simulation.
        self.page.locator(".scribble-toggle").first.click()
        self.page.evaluate("""() => {
            const v=visualViewport;
            Object.defineProperty(v,'height',{configurable:true,value:430});
            Object.defineProperty(v,'offsetTop',{configurable:true,value:40});
            v.dispatchEvent(new Event('resize'));
        }""")
        pad = self.page.locator(".scribble-panel")
        expect(pad).not_to_have_class(re.compile(r"is-docked"))
        expect(pad).to_have_class(re.compile(r"is-viewport-constrained"))
        expect(field).to_have_value("Keep this draft above the keyboard")
        self.assertTrue(field.evaluate("el=>el===padField"))
        self.assertEqual(
            field.evaluate("el=>[el.selectionStart,el.selectionEnd]"), [5, 9]
        )
        for selector in [".scribble-area", ".scribble-btn-primary", ".scribble-close"]:
            control = self.page.locator(selector).first
            control.scroll_into_view_if_needed()
            self.assertTrue(
                control.evaluate(
                    "el=>{const r=el.getBoundingClientRect();return r.top>=visualViewport.offsetTop && r.bottom<=visualViewport.offsetTop+visualViewport.height}"
                )
            )
        self.assertEqual(
            self.page.evaluate(
                "[localStorage.getItem('opendraft:handwritingPos'),localStorage.getItem('opendraft:handwritingSize')]"
            ),
            prefs,
        )
        # Browser panning changes the visible origin without changing height.
        self.page.evaluate("""() => {
            Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:80});
            visualViewport.dispatchEvent(new Event('scroll'));
        }""")
        self.page.wait_for_function(
            "document.querySelector('.scribble-panel').getBoundingClientRect().top>=88"
        )
        shots = os.environ.get("OPENDRAFT_SCREENSHOTS")
        if shots:
            os.makedirs(shots, exist_ok=True)
            self.page.screenshot(
                path=os.path.join(shots, "reduced-viewport.png"),
                clip={"x": 0, "y": 80, "width": 1000, "height": 430},
            )
        self.page.evaluate("""() => {
            delete visualViewport.height;delete visualViewport.offsetTop;
            visualViewport.dispatchEvent(new Event('resize'));
        }""")
        expect(self.page.locator(".scribble-panel.is-docked")).to_be_visible()
        self.assertTrue(field.evaluate("el=>el===padField"))
        expect(field).to_have_value("Keep this draft above the keyboard")

    def test_very_short_tabletop_slot_uses_floating_pad(self) -> None:
        self.posture(390, 450, "horizontal", "folded")
        self.request()
        expect(self.page.locator("html")).to_have_class(re.compile(r"fold-laptop"))
        expect(self.page.locator(".scribble-panel.is-docked")).to_have_count(0)
        expect(
            self.page.locator(".scribble-panel.is-viewport-constrained")
        ).to_be_visible()
        self.field().fill("Short tabletop draft")
        self.posture(700, 700, "horizontal", "folded")
        expect(self.page.locator(".scribble-panel.is-docked")).to_be_visible()
        expect(self.field()).to_have_value("Short tabletop draft")

    def test_cover_height_changes_keep_custom_zoom(self) -> None:
        self.posture(390, 900, None)
        self.page.evaluate("testStore.getState().setViewLayout('page')")
        self.page.wait_for_timeout(400)
        self.page.evaluate("testStore.getState().setZoomLevel(125)")
        self.posture(390, 500, None)
        self.assertEqual(self.page.evaluate("testStore.getState().zoomLevel"), 125)
        self.posture(390, 900, None)
        self.assertEqual(self.page.evaluate("testStore.getState().zoomLevel"), 125)
        self.posture(450, 900, None)
        self.page.wait_for_function("testStore.getState().zoomLevel!==125")

    def test_book_pinch_uses_phone_zoom_without_overwriting_page_zoom(self) -> None:
        self.page.evaluate("testStore.getState().setZoomLevel(78)")
        self.posture(951, 669, "vertical", "folded")
        self.assertEqual(self.page.evaluate("testStore.getState().viewLayout"), "page")
        self.assertEqual(self.page.evaluate("testStore.getState().zoomLevel"), 100)
        self.page.locator(".editor-main").evaluate("""el=>{
            const point=(id,x)=>new Touch({identifier:id,target:el,clientX:x,clientY:220});
            el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[point(1,120),point(2,260)]}));
            el.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[point(1,100),point(2,280)]}));
            el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[]}));
        }""")
        self.page.wait_for_function("testStore.getState().zoomLevel>100")
        zoom = self.page.evaluate("testStore.getState().zoomLevel")
        self.assertEqual(
            self.page.evaluate(
                "JSON.parse(localStorage.getItem('opendraft:viewState')).phoneZoomLevel"
            ),
            zoom,
        )
        self.assertEqual(
            self.page.evaluate(
                "JSON.parse(localStorage.getItem('opendraft:viewState')).zoomLevel"
            ),
            78,
        )
        self.posture(1000, 1000, "horizontal", "folded")
        self.assertEqual(self.page.evaluate("testStore.getState().zoomLevel"), 78)
        self.posture(951, 669, "vertical", "folded")
        self.assertEqual(self.page.evaluate("testStore.getState().zoomLevel"), zoom)

    def test_widened_navigator_uses_the_actual_docked_width(self) -> None:
        self.ordinary()
        self.page.evaluate("testStore.getState().toggleNavigator()")
        nav = self.page.locator(".scene-navigator")
        nav.wait_for()
        handle = self.page.locator(
            ".editor-layout > .panel-resize-handle"
        ).first.bounding_box()
        self.page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + 60)
        self.page.mouse.down()
        self.page.mouse.move(handle["x"] + 260, handle["y"] + 60, steps=8)
        self.page.mouse.up()
        self.assertGreater(nav.bounding_box()["width"], 450)
        self.posture(951, 669, "vertical", "continuous")
        expect(self.page.locator(".editor-layout")).to_have_class(
            re.compile(r"fold-nav-docked")
        )
        self.assertEqual(nav.bounding_box()["width"], 240)

    def test_docked_timeline_ignores_escape_from_the_script_or_popup(self) -> None:
        self.page.evaluate("testStore.getState().setStoryTimelineOpen(true)")
        timeline = self.page.locator(".story-timeline-dock")
        expect(timeline).to_be_visible()
        self.page.locator(".ProseMirror").focus()
        self.page.keyboard.press("Escape")
        expect(timeline).to_be_visible()
        done = timeline.get_by_role("button", name="Done", exact=True)
        done.focus()
        done.evaluate(
            "el=>el.addEventListener('keydown',e=>e.preventDefault(),{once:true})"
        )
        self.page.keyboard.press("Escape")
        expect(timeline).to_be_visible()
        self.page.keyboard.press("Escape")
        expect(timeline).to_have_count(0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
