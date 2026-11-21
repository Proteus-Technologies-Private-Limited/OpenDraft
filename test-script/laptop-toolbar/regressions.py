"""WP10: synthetic document and Chromium posture/keyboard geometry only."""

import unittest
import importlib.util
from pathlib import Path
from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    "fold_fixture", Path(__file__).resolve().parents[1] / "foldables/regressions.py"
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class LaptopToolbar(unittest.TestCase):
    setUpClass = classmethod(fixture.FoldableRegressions.setUpClass.__func__)
    tearDownClass = classmethod(fixture.FoldableRegressions.tearDownClass.__func__)
    tearDown = fixture.FoldableRegressions.tearDown
    posture = fixture.FoldableRegressions.posture

    def setUp(self):
        fixture.FoldableRegressions.setUp(self)
        self.page.evaluate("""() => {
            testRegistry.unregister('fold-regression');
            testEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'A synthetic sentence for formatting and posture checks.'}]}]},true);
            testEditor.commands.setTextSelection({from:3,to:12});
            window.originalEditor=testEditor.view.dom;
            window.originalDoc=testEditor.state.doc;
        }""")
        self.posture(1000, 1000, "horizontal", "folded")
        expect(self.page.locator(".toolbar--laptop")).to_be_visible()

    def toolbar(self):
        return self.page.locator(".toolbar--laptop")

    def test_geometry_reserves_space_for_the_panel_without_moving_the_menu(self):
        self.page.evaluate("testStore.getState().toggleScriptNotes()")
        bar = self.toolbar().bounding_box()
        pane = self.page.locator(".fold-panel-dock").bounding_box()
        script = self.page.locator(".editor-main").bounding_box()
        self.assertEqual(bar["y"], 510)
        self.assertEqual(bar["height"], 106)
        self.assertGreaterEqual(pane["y"], bar["y"] + bar["height"])
        self.assertLessEqual(script["y"] + script["height"], 490)
        self.assertLess(self.page.locator(".menu-bar").bounding_box()["y"], 100)

    def test_element_choice_keyboard_focus_and_close_controls(self):
        trigger = self.toolbar().locator(".element-selector")
        trigger.focus()
        self.page.keyboard.press("ArrowDown")
        line = self.page.locator(".od-select-popup--line")
        expect(line.get_by_role("listbox")).to_have_attribute(
            "aria-orientation", "horizontal"
        )
        self.assertEqual(
            line.bounding_box()["y"], self.toolbar().bounding_box()["y"] + 56
        )
        self.page.keyboard.press("ArrowRight")
        self.page.keyboard.press("Enter")
        expect(line).to_have_count(0)
        expect(trigger).to_be_focused()
        self.assertNotEqual(
            self.page.evaluate("testStore.getState().activeElement"), "action"
        )
        trigger.click()
        line.get_by_role("button", name="Close", exact=True).click()
        expect(trigger).to_be_focused()
        trigger.click()
        line.locator(".toolbar-choice-back").click()
        expect(trigger).to_be_focused()
        trigger.click()
        self.page.keyboard.press("Escape")
        expect(trigger).to_be_focused()
        expect(line).to_have_count(0)

    def test_keyboard_geometry_moves_toolbar_and_open_choice_together(self):
        trigger = self.toolbar().locator(".element-selector")
        trigger.click()
        self.page.evaluate("""() => {
            window.OpenDraftKeyboard={snapshot:()=>JSON.stringify({version:1,available:true,visible:true,width:1000,height:1000,bottom:480})};
            window.dispatchEvent(new Event('opendraft:keyboardchange'));
        }""")
        expect(self.toolbar()).to_have_attribute("data-fold-toolbar", "above")
        self.page.wait_for_function(
            "Math.abs(document.querySelector('.od-select-popup--line').getBoundingClientRect().top-document.querySelector('.toolbar').getBoundingClientRect().top-56)<1"
        )
        self.assertLessEqual(self.toolbar().bounding_box()["y"] + 106, 480)
        self.page.keyboard.press("Escape")
        self.page.evaluate(
            "delete window.OpenDraftKeyboard;window.dispatchEvent(new Event('opendraft:keyboardchange'))"
        )
        expect(self.toolbar()).to_have_attribute("data-fold-toolbar", "below")
        self.assertTrue(
            self.page.evaluate(
                "testEditor.view.dom===originalEditor && testEditor.state.doc.eq(originalDoc)"
            )
        )

    def test_font_choices_use_the_same_fonts_and_restore_focus(self):
        trigger = self.toolbar().locator(".font-picker-trigger")
        trigger.click()
        line = self.page.locator(".font-picker-popup--line")
        expect(line.get_by_role("listbox")).to_have_attribute(
            "aria-orientation", "horizontal"
        )
        self.assertGreater(line.get_by_role("option").count(), 20)
        self.page.keyboard.press("ArrowRight")
        self.page.keyboard.press("Enter")
        expect(line).to_have_count(0)
        expect(trigger).to_be_focused()

    def test_posture_switch_preserves_editor_and_toolbar_choices(self):
        saved = self.page.evaluate("JSON.stringify(testStore.getState().toolbarLayout)")
        for args in [
            (951, 669, "vertical", "folded"),
            (390, 800, None),
            (1440, 1000, None),
        ]:
            self.posture(*args)
            expect(self.page.locator(".toolbar--laptop")).to_have_count(0)
            self.assertEqual(
                self.page.evaluate(
                    "JSON.stringify(testStore.getState().toolbarLayout)"
                ),
                saved,
            )
            self.assertTrue(
                self.page.evaluate(
                    "testEditor.view.dom===originalEditor && testEditor.state.doc.eq(originalDoc)"
                )
            )
        self.posture(1000, 1000, "horizontal", "folded")
        expect(self.toolbar()).to_be_visible()

    def arrange(self, items):
        self.page.evaluate(
            "items=>{const s=testStore.getState();s.setToolbarLayout({...s.toolbarLayout,bars:{...s.toolbarLayout.bars,top:items}})}",
            items,
        )

    def test_views_and_colors_stay_in_the_choice_row(self):
        self.arrange(["undo-redo", "element", "views", "format"])
        views = self.toolbar().locator(".toolbar-views-btn")
        views.click()
        line = self.page.locator(".toolbar-views-menu--line")
        phone = line.get_by_role("radio", name="Phone", exact=True)
        phone.focus()
        self.page.keyboard.press("Enter")
        expect(line).to_have_count(0)
        expect(views).to_be_focused()
        self.assertEqual(self.page.evaluate("testStore.getState().viewLayout"), "phone")
        color = self.toolbar().get_by_role("button", name="Text Color", exact=True)
        color.click()
        picker = self.page.locator(".color-picker-popup--line")
        expect(picker).to_be_visible()
        self.assertEqual(picker.bounding_box()["height"], 44)
        picker.locator(".color-picker-swatch").nth(6).click()
        expect(picker).to_have_count(0)
        expect(color).to_be_focused()
        self.assertEqual(
            self.page.evaluate("testEditor.getAttributes('textStyle').color"), "#ff0000"
        )

    def test_custom_order_labels_and_ordinary_dropdowns_are_preserved(self):
        self.arrange(["undo-redo", "element", "font-size", "font"])
        self.page.evaluate(
            "{const s=testStore.getState();s.setToolbarLayout({...s.toolbarLayout,labels:{...s.toolbarLayout.labels,top:'both'}})}"
        )
        expected = self.page.evaluate(
            "JSON.stringify(testStore.getState().toolbarLayout)"
        )
        ids = (
            self.toolbar()
            .locator("[data-item]")
            .evaluate_all("els=>els.map(e=>e.dataset.item)")
        )
        self.assertEqual(ids, ["undo-redo", "element", "font-size", "font"])
        self.posture(1440, 1000, None)
        trigger = self.page.locator(".toolbar .font-size-selector")
        trigger.click()
        popup = self.page.locator(".od-select-popup")
        expect(popup).not_to_have_class(__import__("re").compile(".*--line.*"))
        self.assertEqual(
            self.page.evaluate(
                "JSON.stringify(JSON.parse(localStorage.getItem('opendraft:viewState')).toolbarLayout)"
            ),
            expected,
        )

    def test_rtl_arrows_and_active_option_scroll(self):
        self.page.evaluate("document.documentElement.dir='rtl'")
        trigger = self.toolbar().locator(".element-selector")
        trigger.click()
        initial = trigger.get_attribute("aria-activedescendant")
        self.page.keyboard.press("ArrowLeft")
        self.assertNotEqual(trigger.get_attribute("aria-activedescendant"), initial)
        self.page.keyboard.press("End")
        active = self.page.locator(
            '[id="' + trigger.get_attribute("aria-activedescendant") + '"]'
        )
        line = self.page.get_by_role("listbox")
        self.assertGreaterEqual(
            active.bounding_box()["x"], line.bounding_box()["x"] - 1
        )
        self.assertLessEqual(
            active.bounding_box()["x"] + active.bounding_box()["width"],
            line.bounding_box()["x"] + line.bounding_box()["width"] + 1,
        )
        self.page.keyboard.press("Escape")
        expect(trigger).to_be_focused()

    def test_overflow_uses_row_two_and_nested_size_picker(self):
        self.page.evaluate("testStore.getState().applyToolbarPreset('everything')")
        self.posture(390, 1000, "horizontal", "folded")
        button = self.toolbar().locator(".toolbar-overflow-btn")
        expect(button).to_be_visible()
        button.click()
        line = self.page.locator(".toolbar-overflow-menu--line")
        self.assertEqual(line.bounding_box()["height"], 44)
        size = line.locator(".font-size-selector")
        expect(size).to_be_visible()
        size.click()
        choices = self.page.locator(".od-select-popup--line")
        expect(choices).to_be_visible()
        choices.get_by_role("option", name="16pt", exact=True).click()
        expect(choices).to_have_count(0)
        expect(line).to_have_count(0)
        expect(button).to_be_focused()
        self.assertEqual(
            self.page.evaluate("testEditor.getAttributes('textStyle').fontSize"), "16pt"
        )

    def test_choice_closes_on_posture_change_and_focus_mode_stays_hidden(self):
        trigger = self.toolbar().locator(".element-selector")
        trigger.click()
        self.posture(951, 669, "vertical", "folded")
        expect(self.page.locator(".od-select-popup")).to_have_count(0)
        expect(self.page.locator(".toolbar .element-selector")).to_be_focused()
        self.posture(1000, 1000, "horizontal", "folded")
        self.page.evaluate("testStore.setState({focusMode:true})")
        expect(self.page.locator(".toolbar")).to_have_count(0)
        self.assertEqual(
            self.page.evaluate(
                "document.documentElement.style.getPropertyValue('--fold-laptop-script-bottom')"
            ),
            "",
        )

    def test_horizontal_popup_semantics_with_axe(self):
        self.arrange(["undo-redo", "element", "font", "views", "format"])
        self.page.add_script_tag(
            path=str(
                Path(__file__).resolve().parents[2]
                / "frontend/node_modules/axe-core/axe.min.js"
            )
        )
        for selector in [
            ".element-selector",
            ".font-picker-trigger",
            ".toolbar-views-btn",
            'button[title="Text Color"]',
        ]:
            self.toolbar().locator(selector).click()
            violations = self.page.evaluate(
                """async () => (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(v=>v.id!=='meta-viewport').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))"""
            )
            self.assertEqual(violations, [])
            self.page.keyboard.press("Escape")

    def test_narrow_tabletop_menu_stays_reachable_above_the_keyboard(self):
        self.posture(390, 1000, "horizontal", "folded")
        menu = self.page.get_by_role("button", name="Application menu", exact=True)
        expect(menu).to_be_visible()
        self.assertLess(menu.bounding_box()["y"] + menu.bounding_box()["height"], 490)
        self.page.evaluate("""() => {
            window.OpenDraftKeyboard={snapshot:()=>JSON.stringify({version:1,available:true,visible:true,width:390,height:1000,bottom:480})};
            window.dispatchEvent(new Event('opendraft:keyboardchange'));
        }""")
        expect(self.toolbar()).to_have_attribute("data-fold-toolbar", "above")
        self.assertLessEqual(
            menu.bounding_box()["y"] + menu.bounding_box()["height"],
            self.toolbar().bounding_box()["y"],
        )
        menu.click()
        expect(
            self.page.get_by_role("menuitem", name="File", exact=True)
        ).to_be_visible()
        self.page.keyboard.press("Escape")

    def test_typing_caret_stays_above_the_toolbar_when_keyboard_opens(self):
        self.page.evaluate("""() => {
            testEditor.commands.setContent({type:'doc',content:Array.from({length:200},()=>({type:'action',content:[{type:'text',text:'A synthetic action line. '.repeat(8)}]}))},true);
            testEditor.commands.setTextSelection(testEditor.state.doc.content.size-2);
            testEditor.view.focus();
            testEditor.commands.scrollIntoView();
            window.beforeKeyboard=testEditor.state.doc;
        }""")
        self.page.wait_for_timeout(200)
        self.page.evaluate("""() => {
            window.OpenDraftKeyboard={snapshot:()=>JSON.stringify({version:1,available:true,visible:true,width:1000,height:1000,bottom:480})};
            window.dispatchEvent(new Event('opendraft:keyboardchange'));
        }""")
        expect(self.toolbar()).to_have_attribute("data-fold-toolbar", "above")
        self.page.wait_for_function("""() => {
            const caret=testEditor.view.coordsAtPos(testEditor.state.selection.from);
            const script=document.querySelector('.editor-main').getBoundingClientRect();
            return caret.top>=script.top-1 && caret.bottom<=script.bottom+1;
        }""")
        self.assertTrue(self.page.evaluate("testEditor.state.doc.eq(beforeKeyboard)"))
        self.page.keyboard.insert_text("edit")
        self.page.keyboard.press("Control+z")
        self.page.wait_for_function("testEditor.state.doc.eq(beforeKeyboard)")

    def test_narrow_overflow_font_search_and_options_remain_usable(self):
        self.page.evaluate("testStore.getState().applyToolbarPreset('everything')")
        self.posture(390, 1000, "horizontal", "folded")
        overflow = self.toolbar().locator(".toolbar-overflow-btn")
        overflow.click()
        self.page.locator(".toolbar-overflow-menu--line .font-picker-trigger").click()
        popup = self.page.locator(".font-picker-popup--line")
        self.assertGreaterEqual(
            popup.get_by_role("listbox").bounding_box()["width"], 99
        )
        self.page.keyboard.press("C")
        search = popup.get_by_role("combobox", name="Search fonts", exact=True)
        expect(search).to_be_focused()
        expect(search).to_have_value("C")
        self.assertGreater(popup.get_by_role("option").count(), 0)
        self.page.keyboard.press("ArrowDown")
        self.page.keyboard.press("Enter")
        expect(popup).to_have_count(0)
        expect(overflow).to_be_focused()


if __name__ == "__main__":
    unittest.main(verbosity=2)
