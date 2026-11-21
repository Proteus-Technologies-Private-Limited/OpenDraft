"""WP9 browser integration: synthetic script, real Chromium posture signals."""

import unittest
from playwright.sync_api import expect
import regressions as fixture


class Companions(unittest.TestCase):
    setUpClass = classmethod(fixture.FoldableRegressions.setUpClass.__func__)
    tearDownClass = classmethod(fixture.FoldableRegressions.tearDownClass.__func__)
    tearDown = fixture.FoldableRegressions.tearDown
    posture = fixture.FoldableRegressions.posture

    def setUp(self):
        fixture.FoldableRegressions.setUp(self)
        self.page.evaluate("""() => {
            testRegistry.unregister('fold-regression');
            testStore.setState({navigatorOpen:false});
            testEditor.commands.setContent({type:'doc',content:Array.from({length:240},(_,n)=>({
                type:n%20===0?'sceneHeading':'action',
                content:[{type:'text',text:n%20===0?'INT. SYNTHETIC ROOM '+n+' - DAY':'A synthetic line with enough text to fill the page. '.repeat(5)}]
            }))},true);
            testEditor.commands.setTextSelection({from:5,to:12});
            window.originalEditor=testEditor.view.dom;
            window.originalDoc=testEditor.state.doc;
        }""")

    def companion(self):
        return self.page.locator("#fold-panel-companion")

    def open_pane(self, kind="page-view"):
        self.page.evaluate("kind=>testStore.getState().setSplitScreenPane(kind)", kind)
        expect(
            self.page.get_by_role(
                "tab",
                name={
                    "page-view": "Page View",
                    "outline": "Outline",
                    "index-cards": "Index Cards",
                    "beat-board": "Beat Board",
                }[kind],
                exact=True,
            )
        ).to_be_visible()

    def assert_slot(self, axis):
        box = self.companion().bounding_box()
        self.assertIsNotNone(box)
        crease = self.page.evaluate(
            "({x:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-left')), y:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-top')), w:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-width')),h:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-height'))})"
        )
        script = self.page.locator(".editor-main").bounding_box()
        if axis == "vertical":
            self.assertLessEqual(script["x"] + script["width"], crease["x"] + 1)
            self.assertGreaterEqual(box["x"], crease["x"] + crease["w"] - 1)
        else:
            self.assertLessEqual(script["y"] + script["height"], crease["y"] + 1)
            self.assertGreaterEqual(box["y"], crease["y"] + crease["h"] - 1)
        self.assertTrue(
            self.page.evaluate(
                "testEditor.view.dom===originalEditor && testEditor.state.doc.eq(originalDoc)"
            )
        )

    def transitions(self, fallback=False):
        if fallback:
            self.page.evaluate("Element.prototype.moveBefore=undefined")
        self.open_pane()
        self.page.evaluate("window.pane=document.querySelector('.page-preview-pane')")
        close = self.companion().get_by_role(
            "button", name="Close Page View", exact=True
        )
        close.focus()
        for width, height, axis, state in [
            (951, 669, "vertical", "folded"),
            (1000, 1000, "horizontal", "folded"),
            (951, 669, "vertical", "continuous"),
        ]:
            self.posture(width, height, axis, state)
            self.assert_slot(axis)
            self.assertTrue(
                self.page.evaluate(
                    "document.querySelector('.page-preview-pane')===pane"
                )
            )
            expect(close).to_be_focused()
        self.posture(390, 800, None)
        expect(self.page.locator(".split-pane-home")).to_be_visible()
        self.assertTrue(
            self.page.evaluate("document.querySelector('.page-preview-pane')===pane")
        )
        expect(close).to_be_focused()
        self.assertEqual(
            self.page.evaluate("testStore.getState().splitScreenMode"), "side-by-side"
        )
        close.click()
        expect(self.page.locator(".ProseMirror")).to_be_focused()
        self.page.evaluate(
            "testEditor.commands.setTextSelection(testEditor.state.doc.child(0).nodeSize+3)"
        )
        self.page.keyboard.insert_text("new words")
        self.assertFalse(self.page.evaluate("testEditor.state.doc.eq(originalDoc)"))
        self.page.keyboard.press("Control+z")
        self.page.wait_for_function("testEditor.state.doc.eq(originalDoc)")

    def test_pane_and_focus_follow_the_crease_without_remounting(self):
        self.transitions()

    def test_append_child_fallback_preserves_pane_focus(self):
        self.transitions(True)

    def test_card_synopsis_draft_and_selection_survive_posture_changes(self):
        self.open_pane("index-cards")
        expect(self.companion().locator(".ic-meta-item").first).to_be_visible()
        field = self.companion().locator(".index-card-synopsis").first
        field.fill("A synthetic synopsis draft with a selection.")
        field.evaluate(
            "el=>{window.synopsisField=el;el.focus();el.setSelectionRange(4,13)}"
        )
        self.page.wait_for_timeout(350)
        self.page.evaluate("window.originalDoc=testEditor.state.doc")
        for args in [
            (951, 669, "vertical", "folded"),
            (1000, 1000, "horizontal", "folded"),
            (390, 800, None),
            (951, 669, "vertical", "folded"),
            (1000, 1000, "horizontal", "folded"),
        ]:
            if args == (390, 800, None):
                self.page.evaluate("Element.prototype.moveBefore=undefined")
            self.posture(*args)
            expect(field).to_have_value("A synthetic synopsis draft with a selection.")
            self.assertTrue(
                field.evaluate("el=>el===synopsisField && el===document.activeElement")
            )
            self.assertEqual(
                field.evaluate("el=>[el.selectionStart,el.selectionEnd]"), [4, 13]
            )
        self.assertTrue(self.page.evaluate("testEditor.state.doc.eq(originalDoc)"))

    def test_planning_commands_keep_the_script_beside_the_view(self):
        for command, selector in [
            ("toggleIndexCards", ".index-cards"),
            ("toggleOutline", ".outline-view"),
            ("toggleBeatBoard", ".beat-board"),
        ]:
            self.page.evaluate(
                "command=>{testStore.setState({indexCardsOpen:false,outlineOpen:false,beatBoardOpen:false,splitScreenOpen:false});testStore.getState()[command]();}",
                command,
            )
            expect(self.page.locator(".editor-main")).to_be_visible()
            expect(self.companion().locator(selector)).to_be_visible()
            self.assert_slot("vertical")
            self.assertFalse(self.page.evaluate("testStore.getState().splitScreenOpen"))
        self.page.locator(".beat-board .panel-close-btn").click()
        expect(self.page.locator(".beat-board")).to_have_count(0)
        expect(self.page.locator(".editor-main")).to_be_visible()

    def test_desktop_planning_state_survives_folding_and_unfolding(self):
        self.posture(1440, 1000, None)
        # Retained capability on a wide window uses the fold column; reload to
        # start an ordinary desktop, without synthetic fold capability.
        self.page.reload()
        self.page.locator(".ProseMirror").wait_for()
        # The fixture's module probes are re-established after this ordinary startup.
        self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/editorStore.ts').name;
            window.testStore=(await import(url)).useEditorStore;
            testStore.setState({navigatorOpen:false,indexCardsOpen:true});
        }""")
        expect(self.page.locator(".companion-main-home .index-cards")).to_be_visible()
        self.page.evaluate(
            "window.cards=document.querySelector('.index-cards');window.editorDom=document.querySelector('.ProseMirror')"
        )
        self.posture(951, 669, "vertical", "folded")
        expect(self.companion().locator(".index-cards")).to_be_visible()
        expect(self.page.locator(".editor-main")).to_be_visible()
        self.assertTrue(
            self.page.evaluate(
                "document.querySelector('.index-cards')===cards && document.querySelector('.ProseMirror')===editorDom"
            )
        )

    def split_menu(self):
        self.page.get_by_role("menuitem", name="View", exact=True).focus()
        self.page.keyboard.press("ArrowDown")
        self.page.get_by_role("menuitem", name="Panels", exact=True).focus()
        self.page.keyboard.press("ArrowRight")
        self.page.get_by_role("menuitem", name="Split Screen", exact=True).focus()
        self.page.keyboard.press("ArrowRight")

    def test_fold_menu_shows_the_actual_companion_and_can_return_to_one_pane(self):
        self.page.evaluate("testStore.getState().toggleIndexCards()")
        self.split_menu()
        expect(
            self.page.get_by_role("menuitemradio", name="Side by Side", exact=True)
        ).to_have_count(0)
        one = self.page.get_by_role("menuitemradio", name="One Pane", exact=True)
        expect(one).to_have_attribute("aria-checked", "false")
        one.focus()
        self.page.keyboard.press("Enter")
        expect(self.page.locator(".index-cards")).to_have_count(0)
        expect(self.page.locator(".editor-main")).to_be_visible()

    def test_ordinary_stacked_split_keeps_its_mode_and_pane_across_dock_breakpoints(
        self,
    ):
        self.posture(1440, 1000, None)
        self.page.reload()
        blank = self.page.get_by_role("button", name="Blank Document", exact=False)
        if blank.count():
            blank.click()
        self.page.locator(".ProseMirror").wait_for()
        self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/editorStore.ts').name;
            window.testStore=(await import(url)).useEditorStore;
            testStore.getState().setSplitScreenPane('page-view');
            testStore.getState().setSplitScreenMode('stacked');
        }""")
        pane = self.page.locator(".page-preview-pane")
        expect(pane).to_be_visible()
        self.page.evaluate(
            "window.preview=pane=document.querySelector('.page-preview-pane')"
        )
        for width, height in [(900, 700), (1440, 1000)]:
            self.posture(width, height, None)
            expect(self.page.locator(".split-pane-home")).to_be_visible()
            self.assertTrue(pane.evaluate("el=>el===preview"))
            self.assertEqual(
                self.page.evaluate("testStore.getState().splitScreenMode"), "stacked"
            )
            script = self.page.locator(".editor-main").bounding_box()
            home = self.page.locator(".split-pane-home").bounding_box()
            self.assertGreaterEqual(home["y"], script["y"] + script["height"] - 1)

    def test_outline_navigation_does_not_close_or_toggle_a_companion(self):
        self.open_pane("outline")
        row = self.companion().locator(".outline-scene").last
        row.click()
        expect(self.companion().locator(".outline-view")).to_be_visible()
        self.assertFalse(self.page.evaluate("testStore.getState().outlineOpen"))
        self.assertTrue(self.page.evaluate("testStore.getState().splitScreenOpen"))
        self.page.wait_for_function("testEditor.state.selection.from>100")

    def test_main_planning_commands_keep_table_read_available(self):
        self.page.evaluate("testTable.getState().setOpen(true)")
        for command in ["toggleOutline", "toggleBeatBoard"]:
            self.page.evaluate(
                "command=>{testStore.setState({outlineOpen:false,beatBoardOpen:false});testStore.getState()[command]();}",
                command,
            )
            tab = self.page.get_by_role("tab", name="Table Read", exact=True)
            expect(tab).to_be_visible()
            tab.click()
            expect(self.page.locator(".table-read-panel")).to_be_visible()
            self.assertTrue(self.page.evaluate("testTable.getState().open"))

    def test_card_navigation_keeps_companion_open(self):
        self.open_pane("index-cards")
        self.companion().locator(".index-card-heading").last.click()
        self.page.wait_for_function("testEditor.state.selection.from>100")
        expect(self.companion().locator(".index-cards")).to_be_visible()
        self.assertTrue(self.page.evaluate("testStore.getState().splitScreenOpen"))

    def test_planning_reorder_mode_does_not_steal_script_undo(self):
        self.open_pane("index-cards")
        self.companion().get_by_role("button", name="Reorder", exact=True).click()
        self.page.evaluate(
            "testEditor.commands.setTextSelection(testEditor.state.doc.child(0).nodeSize+3);testEditor.view.focus();window.beforeUndo=testEditor.state.doc"
        )
        # One input transaction; slow per-key events must not split undo groups.
        self.page.keyboard.insert_text("draft words")
        self.page.keyboard.press("Control+z")
        self.page.wait_for_function("testEditor.state.doc.eq(beforeUndo)")
        expect(self.companion().locator(".index-cards")).to_be_visible()

    def test_embedded_beat_board_links_and_navigates_scenes(self):
        self.open_pane("beat-board")
        self.page.evaluate(
            "{const id=testStore.getState().addBeatColumn('Synthetic column');testStore.getState().addBeat('Synthetic beat',id)}"
        )
        card = self.companion().locator(".beat-card").first
        card.hover()
        button = card.get_by_role("button", name="Linked scenes", exact=True)
        button.click()
        picker = self.page.locator(".beat-scene-picker")
        expect(picker.get_by_role("checkbox")).to_have_count(12)
        picker.get_by_role("checkbox").last.check()
        button.click()
        card.locator(".beat-scene-chip").click()
        self.page.wait_for_function("testEditor.state.selection.from>100")
        expect(self.companion().locator(".beat-board")).to_be_visible()
        self.assertTrue(self.page.evaluate("testStore.getState().splitScreenOpen"))

    def test_other_panels_remain_one_tab_away(self):
        self.open_pane("index-cards")
        self.page.evaluate("testStore.getState().toggleScriptNotes()")
        expect(
            self.page.get_by_role("tab", name="Notes Panel", exact=True)
        ).to_have_attribute("aria-selected", "true")
        self.page.get_by_role("tab", name="Index Cards", exact=True).focus()
        self.page.keyboard.press("Enter")
        expect(self.companion()).to_be_visible()
        # A repeated view request brings the existing pane back from another tab.
        self.page.get_by_role("tab", name="Notes Panel", exact=True).click()
        self.page.evaluate("testStore.getState().setSplitScreenPane('index-cards')")
        expect(
            self.page.get_by_role("tab", name="Index Cards", exact=True)
        ).to_have_attribute("aria-selected", "true")
        self.page.get_by_role("tab", name="Index Cards", exact=True).focus()
        self.page.evaluate("document.documentElement.dir='rtl'")
        self.page.keyboard.press("ArrowLeft")
        expect(
            self.page.get_by_role("tab", name="Notes Panel", exact=True)
        ).to_be_focused()
        self.page.get_by_role("tab", name="Index Cards", exact=True).click()
        self.companion().locator(".ic-close-btn").click()
        expect(
            self.page.get_by_role("tab", name="Notes Panel", exact=True)
        ).to_be_focused()


if __name__ == "__main__":
    unittest.main(verbosity=2)
