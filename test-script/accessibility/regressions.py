"""Browser-only accessibility checks; no native device or assistive technology required."""

import importlib.util
import json
import os
import tempfile
from pathlib import Path
import unittest

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "menu_fixture", ROOT / "test-script/menu-keyboard/regressions.py"
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Accessibility(unittest.TestCase):
    # Reuse the existing synthetic script and Vite module fixtures, not real files.
    setUp = fixture.MenuKeyboard.setUp
    start_page = fixture.MenuKeyboard.start_page
    tearDown = fixture.MenuKeyboard.tearDown
    open = fixture.MenuKeyboard.open
    row = fixture.MenuKeyboard.row
    press = fixture.MenuKeyboard.press

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = fixture.launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def dialog(self, menu="File", command="Page Setup…"):
        self.open(menu)
        self.row(command).focus()
        self.press("Enter")
        dialog = self.page.locator('[aria-modal="true"]:visible').last
        expect(dialog).to_be_visible()
        return dialog

    def audit(self):
        self.page.add_script_tag(
            path=str(ROOT / "frontend/node_modules/axe-core/axe.min.js")
        )
        report = self.page.evaluate("""async () => {
            const result=await axe.run(document, {runOnly: {type:'tag',
                values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
            return {version:axe.version, violations:result.violations.map(v=>({id:v.id,
                nodes:v.nodes.map(n=>({target:n.target, failure:n.failureSummary}))})),
                incomplete:result.incomplete.map(v=>v.id), passed:result.passes.map(v=>v.id)};
        }""")
        report["browser"] = os.environ.get("OPENDRAFT_BROWSER", "chromium")
        # Keep reporting the existing viewport restriction while its change is
        # deferred for physical WebView validation. No axe rule is disabled.
        deferred = [v for v in report["violations"] if v["id"] == "meta-viewport"]
        self.assertEqual(len(deferred), 1)
        self.assertEqual(
            [n["target"] for n in deferred[0]["nodes"]], [['meta[name="viewport"]']]
        )
        report["deferred"] = deferred
        unexpected = [v for v in report["violations"] if v["id"] != "meta-viewport"]
        self._audit_index = getattr(self, "_audit_index", 0) + 1
        output = Path(
            os.environ.get(
                "OPENDRAFT_A11Y_OUTPUT",
                str(Path(tempfile.gettempdir()) / "opendraft-accessibility"),
            )
        )
        output.mkdir(parents=True, exist_ok=True)
        target = output / f"{self._testMethodName}-{self._audit_index}"
        target.with_suffix(".json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if unexpected:
            self.page.screenshot(path=str(target.with_suffix(".png")))
        self.assertEqual(
            unexpected,
            [],
            json.dumps(report["violations"], ensure_ascii=False, indent=2),
        )

    def test_editor_names_states_and_theme_contrast(self):
        expect(
            self.page.get_by_role("textbox", name="Screenplay editor")
        ).to_be_visible()
        expect(
            self.page.get_by_role("group", name="Formatting controls")
        ).to_be_visible()
        bold = self.page.locator('.toolbar button[title^="Bold"]')
        expect(bold).to_have_attribute("aria-pressed", "false")
        bold.focus()
        self.press("Space")
        expect(bold).to_have_attribute("aria-pressed", "true")
        for theme in ["dark", "light"]:
            self.page.evaluate(
                "theme => document.documentElement.dataset.theme=theme", theme
            )
            self.audit()

    def test_settings_labels_keyboard_language_and_theme_contrast(self):
        self.open("Tools")
        self.row(self.page.evaluate("testI18n.t('menu:tools.systemSettings')")).focus()
        self.press("Enter")
        expect(self.page.locator(".settings-page")).to_be_visible()
        field = self.page.get_by_label("Server URL", exact=True)
        field.focus()
        field.fill("wss://example.invalid")
        expect(field).to_have_value("wss://example.invalid")
        expect(self.page.get_by_label("Cloud API URL", exact=True)).to_be_visible()
        language = self.page.get_by_role("radio", name="English", exact=True)
        language.focus()
        self.press("Space")
        expect(language).to_have_attribute("aria-checked", "true")
        for theme in ["dark", "light"]:
            self.page.evaluate(
                "theme=>document.documentElement.dataset.theme=theme", theme
            )
            self.audit()
        back = self.page.locator(".settings-back-btn")
        back.focus()
        self.press("Enter")
        expect(
            self.page.get_by_role("textbox", name="Screenplay editor")
        ).to_be_visible()

    def test_projects_and_new_project_dialog_keyboard_and_labels(self):
        self.open("File")
        self.row(self.page.evaluate("testI18n.t('menu:file.manageProjects')")).focus()
        self.press("Enter")
        expect(self.page.locator(".project-list-page")).to_be_visible()
        self.audit()
        sort = self.page.get_by_role("combobox", name="Sort", exact=True)
        sort.focus()
        self.press("Space")
        expect(self.page.get_by_role("listbox")).to_be_visible()
        self.press("Escape")
        expect(sort).to_be_focused()
        create = self.page.get_by_role(
            "button",
            name=self.page.evaluate("testI18n.t('projects:list.newProject')"),
            exact=True,
        )
        create.focus()
        self.press("Enter")
        dialog = self.page.get_by_role("dialog")
        field = dialog.get_by_label("Project Name:", exact=True)
        expect(field).to_be_focused()
        field.fill("Synthetic project")
        for key in ["Tab"] * 5 + ["Shift+Tab"] * 5:
            self.press(key)
            self.assertTrue(dialog.evaluate("el=>el.contains(document.activeElement)"))
        self.audit()
        self.press("Escape")
        expect(dialog).to_have_count(0)
        expect(create).to_be_focused()

    def test_pdf_export_range_selection_watermark_and_cancel(self):
        self.page.evaluate("""() => {
            testEditor.commands.setContent({type:'doc',content:[
                {type:'sceneHeading',content:[{type:'text',text:'INT. SYNTHETIC ROOM - DAY'}]},
                {type:'action',content:[{type:'text',text:'A synthetic export fixture.'}]},
                {type:'sceneHeading',content:[{type:'text',text:'EXT. SYNTHETIC ROAD - NIGHT'}]},
                {type:'action',content:[{type:'text',text:'No real file will be written.'}]}]});
            window.beforeExport=testEditor.state.doc;
        }""")
        self.open("File")
        self.row(self.page.evaluate("testI18n.t('menu:file.export')")).focus()
        self.press("ArrowRight")
        self.row("PDF…").focus()
        self.press("Enter")
        dialog = self.page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        self.audit()
        dialog.get_by_role("button", name="Pick scenes", exact=True).click()
        search = dialog.get_by_role("textbox", name="Search scenes", exact=True)
        search.fill("ROAD")
        expect(dialog.locator(".pdf-export-pick-list input")).to_have_count(1)
        self.audit()
        dialog.get_by_role("checkbox", name="Watermark", exact=True).check()
        watermark = dialog.get_by_role("textbox", name="Watermark text", exact=True)
        watermark.fill("")
        expect(
            dialog.get_by_role("button", name="Export PDF", exact=True)
        ).to_be_disabled()
        watermark.fill("SYNTHETIC")
        expect(
            dialog.get_by_role("button", name="Export PDF", exact=True)
        ).to_be_enabled()
        self.audit()
        self.press("Escape")
        expect(dialog).to_have_count(0)
        self.assertTrue(self.page.evaluate("testEditor.state.doc.eq(beforeExport)"))

    def test_pdf_import_review_keyboard_selection_and_cancel_preserves_script(self):
        self.page.evaluate("""async () => {
            const {reviewPdfImport}=await import('/src/utils/pdfImportReview.ts');
            window.beforeImport=testEditor.state.doc;
            window.reviewResult='pending';
            reviewPdfImport('synthetic.pdf',{title:'',warnings:[],doc:{type:'doc',content:[
                {type:'sceneHeading',content:[{type:'text',text:'INT. SYNTHETIC ROOM - DAY'}]},
                {type:'action',content:[{type:'text',text:'A synthetic imported paragraph.'}]}]}})
                .then(()=>reviewResult='accepted',()=>reviewResult='cancelled');
        }""")
        dialog = self.page.locator(".pdf-review-dialog")
        expect(dialog).to_be_visible()
        lines = dialog.get_by_role("listbox", name="Imported lines", exact=True)
        expect(lines).to_be_focused()
        self.press("ArrowDown")
        expect(lines.locator('[aria-selected="true"]')).to_have_count(1)
        active = lines.get_attribute("aria-activedescendant")
        self.assertTrue(active)
        expect(self.page.locator(f'[id="{active}"]')).to_have_attribute(
            "aria-selected", "true"
        )
        self.press("Control+ArrowDown")
        expect(lines.locator('[aria-selected="true"]')).to_have_count(1)
        self.press("Space")
        expect(lines.locator('[aria-selected="true"]')).to_have_count(2)
        self.press("Control+Space")
        expect(lines.locator('[aria-selected="true"]')).to_have_count(1)
        lines.locator(".pdf-review-checkbox").nth(1).click()
        expect(lines.locator('[aria-selected="true"]')).to_have_count(2)
        self.audit()
        screenshots = os.environ.get("OPENDRAFT_SCREENSHOTS")
        if screenshots:
            folder = Path(screenshots)
            folder.mkdir(parents=True, exist_ok=True)
            self.page.screenshot(
                path=str(
                    folder
                    / (
                        "pdf-import-"
                        + os.environ.get("OPENDRAFT_BROWSER", "chromium")
                        + ".png"
                    )
                )
            )
        self.press("Escape")
        expect(dialog).to_have_count(0)
        self.page.wait_for_function("reviewResult==='cancelled'")
        self.assertTrue(self.page.evaluate("testEditor.state.doc.eq(beforeImport)"))

    def test_save_as_escape_preserves_form_and_closes_only_dropdown(self):
        self.page.evaluate("testStore.getState().setSaveAsOpen(true)")
        dialog = self.page.get_by_role("dialog", name="Save Screenplay", exact=True)
        expect(dialog).to_be_visible()
        fields = dialog.locator('input:not([type="checkbox"])')
        fields.nth(1).fill("Synthetic script title")
        fields.nth(0).fill("Synthetic project")
        dropdown = dialog.get_by_text("New Project…", exact=True)
        expect(dropdown).to_be_visible()
        self.press("Escape")
        expect(dropdown).to_have_count(0)
        expect(dialog).to_be_visible()
        expect(fields.nth(0)).to_have_value("Synthetic project")
        expect(fields.nth(1)).to_have_value("Synthetic script title")
        self.press("Escape")
        expect(dialog).to_have_count(0)

    def test_writing_caret_has_no_outline_but_controls_keep_focus_ring(self):
        editor = self.page.get_by_role("textbox", name="Screenplay editor")
        editor.click()
        self.assertEqual(
            editor.evaluate("el=>getComputedStyle(el).outlineStyle"), "none"
        )
        self.press("Tab")
        bold = self.page.locator('.toolbar button[title^="Bold"]')
        bold.focus()
        self.assertEqual(
            bold.evaluate("el=>getComputedStyle(el).outlineStyle"), "solid"
        )
        editor.focus()
        self.assertEqual(
            editor.evaluate("el=>getComputedStyle(el).outlineStyle"), "none"
        )
        # Treatment uses the same global stylesheet and a tabindex-bearing editor.
        self.page.evaluate("""() => {
            const editor=document.createElement('div');editor.className='treatment-content';
            editor.contentEditable='true';editor.tabIndex=0;editor.textContent='Synthetic treatment';
            document.body.append(editor);editor.focus();
        }""")
        self.assertEqual(
            self.page.locator(".treatment-content").evaluate(
                "el=>getComputedStyle(el).outlineStyle"
            ),
            "none",
        )

    def test_toast_timers_pause_for_hover_and_focus_and_body_click_dismisses(self):
        self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/components/Toast.tsx').name;
            window.testToast=(await import(url)).showToast;
        }""")
        self.page.clock.install()
        self.page.evaluate(
            "testToast('Routine hover message');testToast('Persistent error','error')"
        )
        routine = self.page.locator(".toast-message").filter(
            has_text="Routine hover message"
        )
        error = self.page.locator(".toast-message").filter(has_text="Persistent error")
        expect(routine).to_be_visible()
        self.page.clock.run_for(2000)
        routine.hover()
        self.page.clock.run_for(9000)
        expect(routine).to_be_visible()
        self.page.mouse.move(0, 0)
        self.page.clock.run_for(2100)
        expect(routine).to_have_count(0)
        expect(error).to_be_visible()
        self.page.evaluate("testToast('Routine focused message','success')")
        focused = self.page.get_by_role(
            "button", name="Dismiss: Routine focused message"
        )
        expect(focused).to_be_visible()
        focused.focus()
        self.page.clock.run_for(9000)
        expect(focused).to_be_focused()
        editor = self.page.get_by_role("textbox", name="Screenplay editor")
        editor.focus()
        self.page.clock.run_for(4100)
        expect(focused).to_have_count(0)
        expect(editor).to_be_focused()
        # The live-region host survives visual expiry and repeats still announce.
        expect(self.page.get_by_role("status")).to_have_text("Routine focused message")
        error.locator("span").click()
        expect(error).to_have_count(0)
        self.page.evaluate("testToast('Body click message')")
        body = self.page.locator(".toast-message").filter(has_text="Body click message")
        body.locator("span").click()
        expect(body).to_have_count(0)
        self.page.clock.run_for(4100)
        expect(self.page.locator(".toast-message")).to_have_count(0)

    def test_modal_focus_wrap_background_and_keyboard_return(self):
        dialog = self.dialog()
        self.assertTrue(dialog.evaluate("el=>el.contains(document.activeElement)"))
        file = self.page.locator('[data-menu-top="File"]')
        file.evaluate("el=>el.focus()")
        self.assertTrue(dialog.evaluate("el=>el.contains(document.activeElement)"))
        # Exercise real browser tab order, including both ends and radio groups.
        for key in ["Tab"] * 22 + ["Shift+Tab"] * 22:
            self.press(key)
            self.assertTrue(dialog.evaluate("el=>el.contains(document.activeElement)"))
        self.audit()
        self.press("Escape")
        expect(dialog).to_have_count(0)
        expect(file).to_be_focused()
        self.assertEqual(self.page.locator("[inert]").count(), 0)

    def test_select_popup_in_modal_tracks_active_option_and_escape(self):
        dialog = self.dialog()
        select = dialog.get_by_role("combobox", name="Size", exact=True)
        select.focus()
        self.press("Space")
        popup = dialog.get_by_role("listbox")
        expect(popup).to_be_visible()
        before = select.get_attribute("aria-activedescendant")
        self.press("ArrowDown")
        after = select.get_attribute("aria-activedescendant")
        self.assertNotEqual(before, after)
        self.assertTrue(self.page.locator(f'[id="{after}"]').is_visible())
        self.audit()
        self.press("Escape")
        expect(popup).to_have_count(0)
        expect(dialog).to_be_visible()
        expect(select).to_be_focused()
        self.press("Escape")
        expect(dialog).to_have_count(0)

    def test_header_footer_unique_labels_and_diagnostics(self):
        dialog = self.dialog("Format", "Header & Footer…")
        fields = dialog.locator('input[type="number"]')
        ids = fields.evaluate_all("els=>els.map(el=>el.id)")
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(ids))
        self.audit()
        self.press("Escape")
        self.dialog("Help", "Diagnostics")
        self.audit()

    def test_grammar_tabs_rtl_and_nested_dialog_focus(self):
        self.page.evaluate("testStore.getState().setGrammarRulesPanelOpen(true)")
        dialog = self.page.get_by_role("dialog").last
        tabs = dialog.get_by_role("tab")
        expect(tabs).to_have_count(3)
        tabs.nth(0).focus()
        self.press("End")
        expect(tabs.nth(2)).to_be_focused()
        expect(tabs.nth(2)).to_have_attribute("aria-selected", "true")
        self.press("Home")
        expect(tabs.nth(0)).to_be_focused()
        self.page.evaluate("document.documentElement.dir='rtl'")
        self.press("ArrowLeft")
        expect(tabs.nth(1)).to_be_focused()
        for tab in tabs.all():
            self.assertEqual(
                self.page.locator(
                    f'[id="{tab.get_attribute("aria-controls")}"]'
                ).count(),
                1,
            )
        self.audit()

    def test_native_modal_portals_follow_opening_order(self):
        result = self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/utils/modalAccessibility.ts').name;
            const {registerModal,modalPortalContainer}=await import(url);
            const earlier=document.createElement('dialog'), later=document.createElement('dialog');
            earlier.setAttribute('aria-label','Earlier synthetic dialog');
            later.setAttribute('aria-label','Later synthetic dialog');
            document.body.append(earlier,later);
            later.showModal();const releaseLater=registerModal(later);
            earlier.showModal();const releaseEarlier=registerModal(earlier);
            const top=modalPortalContainer()===earlier;
            earlier.close();releaseEarlier();
            const restored=modalPortalContainer()===later;
            later.close();releaseLater();earlier.remove();later.remove();
            return {top,restored};
        }""")
        self.assertEqual(result, {"top": True, "restored": True})
        self.assertEqual(self.page.locator("[inert]").count(), 0)

    def test_nested_dialog_restores_parent_focus(self):
        self.page.evaluate("testStore.getState().setGrammarRulesPanelOpen(true)")
        grammar = self.page.get_by_role("dialog").last
        grammar.get_by_role("tab", name="Dictionaries", exact=True).click()
        add = grammar.get_by_role("button", name="Add language…", exact=True)
        add.focus()
        self.press("Enter")
        installer = self.page.get_by_role("dialog", name="Add Language", exact=True)
        expect(installer).to_be_visible()
        self.assertTrue(installer.evaluate("el=>el.contains(document.activeElement)"))
        self.press("Escape")
        expect(installer).to_have_count(0)
        expect(add).to_be_focused()
        expect(grammar).to_be_visible()
        self.press("Escape")
        expect(grammar).to_have_count(0)
        self.assertEqual(self.page.locator("[inert]").count(), 0)

    def test_dictionary_install_announces_progress_and_failure(self):
        self.page.evaluate("testStore.getState().setGrammarRulesPanelOpen(true)")
        grammar = self.page.get_by_role("dialog").last
        grammar.get_by_role("tab", name="Dictionaries", exact=True).click()
        self.page.evaluate(
            """testStore.setState({installLanguage:()=>new Promise(resolve=>{
            window.finishSyntheticDownload=resolve;
        })})"""
        )
        grammar.get_by_role("button", name="Add language…", exact=True).click()
        installer = self.page.get_by_role("dialog", name="Add Language", exact=True)
        install = installer.get_by_role("button", name="Install", exact=True).first
        install.click()
        expect(
            installer.get_by_role("status", name="Add Language", exact=True)
        ).to_contain_text("Installing…")
        self.page.evaluate(
            "finishSyntheticDownload({ok:false,error:'Synthetic dictionary failure'})"
        )
        expect(installer.locator('.dialog-body > [role="alert"]')).to_have_text(
            "Synthetic dictionary failure"
        )
        self.audit()
        expect(
            installer.get_by_role("status", name="Add Language", exact=True)
        ).to_be_empty()
        self.page.evaluate("testStore.setState({installLanguage:async()=>({ok:true})})")
        install.click()
        expect(
            installer.get_by_role("status", name="Add Language", exact=True)
        ).to_contain_text("Installed")
        expect(installer.locator('.dialog-body > [role="alert"]')).to_have_count(0)

    def test_native_dialog_toast_portal_and_reports_keyboard(self):
        self.open("Tools")
        self.row("Analytics").focus()
        self.press("ArrowRight")
        self.row("Script Health").click()
        native = self.page.locator("dialog[open]")
        expect(native).to_be_visible()
        self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/components/Toast.tsx').name;
            (await import(url)).showToast('Synthetic native notification');
        }""")
        expect(
            native.get_by_role("status").filter(
                has_text="Synthetic native notification"
            )
        ).to_have_text("Synthetic native notification")
        self.audit()
        self.press("Escape")
        expect(native).to_have_count(0)
        expect(
            self.page.get_by_role(
                "button", name="Dismiss: Synthetic native notification"
            )
        ).to_be_visible()
        self.open("Tools")
        self.row("Analytics").focus()
        self.press("ArrowRight")
        self.row("Reports…").click()
        options = self.page.get_by_role("listbox").get_by_role("option")
        options.nth(0).focus()
        self.press("ArrowDown")
        expect(options.nth(1)).to_be_focused()
        expect(options.nth(1)).to_have_attribute("aria-selected", "true")
        self.press("End")
        expect(options.last).to_be_focused()
        self.audit()

    def test_font_picker_search_exposes_active_option(self):
        font = self.page.locator(".font-picker-trigger")
        font.focus()
        self.press("Space")
        popup = self.page.get_by_role("dialog", name="Search fonts", exact=True)
        combo = popup.get_by_role("combobox", name="Search fonts")
        expect(combo).to_be_focused()
        self.press("ArrowDown")
        active = combo.get_attribute("aria-activedescendant")
        self.assertTrue(active)
        expect(self.page.locator(f'[id="{active}"]')).to_be_visible()
        combo.fill("Courier")
        self.press("Home")
        self.assertEqual(combo.evaluate("el=>el.selectionStart"), 0)
        self.press("End")
        self.assertEqual(combo.evaluate("el=>el.selectionStart"), 7)
        combo.dispatch_event("keydown", {"key": "Enter", "isComposing": True})
        expect(popup).to_be_visible()
        self.audit()
        self.press("Escape")
        expect(popup).to_have_count(0)
        expect(font).to_be_focused()

    def test_plugin_tabs_selection_resize_and_removed_focus(self):
        self.page.evaluate("""() => {
            for (const id of ['panel-one','panel-two']) testRegistry.register({id,name:id,version:'1',
                panels:[{id,slot:'right-sidebar',label:id,component:()=>null}]});
        }""")
        tabs = self.page.locator('.plugin-panel-tabs__strip [role="tab"]')
        expect(tabs).to_have_count(2)
        tabs.nth(0).focus()
        self.press("ArrowDown")
        expect(tabs.nth(1)).to_be_focused()
        self.press("Enter")
        expect(tabs.nth(1)).to_have_attribute("aria-selected", "true")
        self.press("Space")
        expect(tabs.nth(1)).to_have_attribute("aria-selected", "true")
        resize = self.page.locator(".plugin-panel-tabs__resize")
        resize.focus()
        self.press("ArrowLeft")
        expect(resize).to_have_attribute("aria-valuenow", "310")
        self.press("End")
        expect(resize).to_have_attribute("aria-valuenow", "600")
        tabs.nth(1).focus()
        self.page.evaluate("testRegistry.unregister('panel-two')")
        expect(tabs).to_have_count(1)
        expect(tabs.nth(0)).to_be_focused()
        expect(tabs.nth(0)).to_have_attribute("aria-selected", "false")
        expect(self.page.locator(".plugin-panel-tabs__content")).to_have_count(0)
        self.page.evaluate("testRegistry.unregister('panel-one')")
        expect(
            self.page.get_by_role("textbox", name="Screenplay editor")
        ).to_be_focused()

    def test_plugin_removal_from_content_and_editor_never_opens_neighbor(self):
        self.page.evaluate("""() => {
            for (const id of ['panel-one','panel-two','panel-three']) testRegistry.register({id,name:id,version:'1',
                panels:[{id,slot:'right-sidebar',label:id,component:()=>null}]});
        }""")
        editor = self.page.get_by_role("textbox", name="Screenplay editor")
        editor.focus()
        self.page.evaluate("testRegistry.unregister('panel-three')")
        expect(editor).to_be_focused()
        tabs = self.page.locator('.plugin-panel-tabs__strip [role="tab"]')
        tabs.nth(0).focus()
        self.press("Enter")
        content = self.page.locator(".plugin-panel-tabs__content")
        content.focus()
        self.page.evaluate("testRegistry.unregister('panel-one')")
        expect(tabs).to_have_count(1)
        expect(tabs.nth(0)).to_be_focused()
        expect(tabs.nth(0)).to_have_attribute("aria-selected", "false")
        expect(content).to_have_count(0)
        self.page.evaluate("testRegistry.unregister('panel-two')")
        expect(editor).to_be_focused()

    def test_feedback_live_regions_keyboard_dismiss_and_no_typing_chatter(self):
        self.page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/components/Toast.tsx').name;
            window.testToast=(await import(url)).showToast;
            testToast('Synthetic export complete','success');
            testToast('Synthetic download failed','error');
        }""")
        expect(self.page.get_by_role("status")).to_have_text(
            "Synthetic export complete"
        )
        expect(self.page.get_by_role("alert")).to_have_text("Synthetic download failed")
        expect(
            self.page.get_by_role("textbox", name="Screenplay editor")
        ).to_be_focused()
        self.page.evaluate("testEditor.commands.insertContent('More synthetic text')")
        expect(self.page.get_by_role("status")).to_have_text(
            "Synthetic export complete"
        )
        self.audit()
        dismiss = self.page.get_by_role(
            "button", name="Dismiss: Synthetic download failed"
        )
        dismiss.focus()
        self.press("Enter")
        expect(dismiss).to_have_count(0)
        expect(
            self.page.get_by_role("button", name="Dismiss: Synthetic export complete")
        ).to_be_focused()
        self.dialog()
        self.page.evaluate("testToast('Synthetic modal notification','info')")
        expect(self.page.get_by_role("dialog").get_by_role("status")).to_have_text(
            "Synthetic modal notification"
        )

    def test_busy_escape_and_background_fallback_without_native_inert(self):
        self.page.evaluate("""async () => {
            delete HTMLElement.prototype.inert;
            delete Array.prototype.at;
            const resource=path=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path).name;
            const ReactModule=await import(resource('/node_modules/.vite/deps/react.js'));
            const React=ReactModule.default ?? ReactModule;
            const DOM=await import(resource('/node_modules/.vite/deps/react-dom_client.js'));
            const createRoot=DOM.createRoot ?? DOM.default.createRoot;
            const {ModalOverlay}=await import(resource('/src/components/ModalOverlay.tsx'));
            const host=document.createElement('div');document.body.append(host);
            const e=React.createElement;
            function Fixture() {
                const [open,setOpen]=React.useState(true);
                const [busy,setBusy]=React.useState(true);
                return open ? e(ModalOverlay,{className:'dialog-overlay',onClick:()=>{if(!busy)setOpen(false)}},
                    e('div',{className:'dialog-box',onClick:event=>event.stopPropagation()},
                        e('h2',null,'Synthetic busy dialog'),
                        e('button',{onClick:()=>setBusy(false)},'Finish synthetic operation'))) : null;
            }
            window.a11yFixture=createRoot(host);a11yFixture.render(e(Fixture));
        }""")
        dialog = self.page.get_by_role("dialog", name="Synthetic busy dialog")
        expect(dialog).to_be_visible()
        self.press("Escape")
        expect(dialog).to_be_visible()
        self.page.locator('[data-menu-top="File"]').evaluate("el=>el.focus()")
        self.assertTrue(dialog.evaluate("el=>el.contains(document.activeElement)"))
        self.assertTrue(
            self.page.locator("#root").evaluate(
                "el=>el.getAttribute('aria-hidden')==='true'"
            )
        )
        dialog.get_by_role("button", name="Finish synthetic operation").click()
        self.press("Escape")
        expect(dialog).to_have_count(0)
        self.assertIsNone(self.page.locator("#root").get_attribute("aria-hidden"))

    def test_zoom_editing_and_palette_are_keyboard_accessible(self):
        trigger = self.page.locator(".zoom-label:visible").first
        trigger.focus()
        self.press("Enter")
        field = self.page.get_by_role("spinbutton", name="Zoom", exact=True)
        expect(field).to_be_focused()
        field.fill("135")
        self.press("Enter")
        expect(trigger).to_have_text("135%")
        expect(trigger).to_be_focused()
        self.press("Space")
        field.fill("175")
        self.press("Escape")
        expect(trigger).to_have_text("135%")
        expect(trigger).to_be_focused()
        self.page.evaluate("testStore.getState().setZoomPanelOpen(true)")
        palette = self.page.get_by_role("group", name="Zoom", exact=True)
        expect(
            palette.get_by_role("button", name="Zoom In", exact=True)
        ).to_be_visible()
        expect(
            palette.get_by_role("button", name="Zoom Out", exact=True)
        ).to_be_visible()
        field = palette.get_by_role("spinbutton", name="Zoom", exact=True)
        field.focus()
        self.audit()
        self.press("Escape")
        expect(palette).to_have_count(0)
        expect(trigger).to_be_focused()

    def test_color_picker_labels_validation_and_escape(self):
        trigger = self.page.locator('.toolbar button[title="Text Color"]')
        trigger.focus()
        self.press("Enter")
        popup = self.page.get_by_role("dialog", name="Text Color", exact=True)
        expect(popup).to_be_visible()
        field = popup.get_by_role("textbox", name="Text Color (#RRGGBB)", exact=True)
        field.fill("#invalid")
        expect(field).to_have_attribute("aria-invalid", "true")
        expect(popup.get_by_role("button", name="Apply", exact=True)).to_be_disabled()
        field.fill("#123456")
        expect(field).to_have_attribute("aria-invalid", "false")
        self.audit()
        self.press("Escape")
        expect(popup).to_have_count(0)
        expect(trigger).to_be_focused()

    def test_forced_colors_reduced_motion_zoom_and_focus_ring(self):
        self.page.emulate_media(forced_colors="active", reduced_motion="reduce")
        bold = self.page.locator('.toolbar button[title^="Bold"]')
        self.press("Tab")
        bold.focus()
        style = bold.evaluate(
            "el=>({outline:getComputedStyle(el).outlineStyle, transition:getComputedStyle(el).transitionDuration})"
        )
        self.assertEqual(style["outline"], "solid")
        self.assertLessEqual(float(style["transition"].removesuffix("s")), 0.001)
        # CSS zoom exercises 200% layout and clipping, not a device or browser-UI claim.
        self.page.evaluate("document.documentElement.style.zoom='2'")
        dialog = self.dialog()
        apply = dialog.get_by_role("button", name="Apply", exact=True)
        apply.scroll_into_view_if_needed()
        expect(apply).to_be_in_viewport()
        apply.focus()
        self.press("Escape")
        expect(dialog).to_have_count(0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
