"""Exercise Script Health in the real editor against Vite using Playwright.

OPENDRAFT_TEST_URL selects Vite. OPENDRAFT_HEALTH_SCREENSHOTS optionally names
an output directory for desktop and phone-width evidence, using synthetic text.
"""

import csv
import json
import os
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get("OPENDRAFT_CHROMIUM")
        or ("/usr/bin/chromium" if os.path.isfile("/usr/bin/chromium") else None),
        args=["--no-sandbox"],
    )
    page = browser.new_page(
        viewport={"width": 1440, "height": 1000}, accept_downloads=True
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(
        "localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false,viewLayout:'page'}));"
    )
    page.goto(os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/"))
    page.locator(".editor-main").wait_for()
    blank = page.get_by_role("button", name="Blank Document", exact=False)
    if blank.count():
        blank.click()
    page.locator(".ProseMirror").wait_for()
    page.evaluate("""async () => {
        let element=document.querySelector('.ProseMirror');
        while(element && !window.healthEditor) {
            const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
            let fiber=key && element[key];
            while(fiber) {
                const editor=fiber.memoizedProps?.editor;
                if(editor?.commands && editor.state) {window.healthEditor=editor;break;}
                fiber=fiber.return;
            }
            element=element.parentElement;
        }
        if(!window.healthEditor) throw Error('Editor not found');
        const moduleUrl=path=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname===path).name;
        window.healthStore=(await import(moduleUrl('/src/stores/editorStore.ts'))).useEditorStore;
        window.healthI18n=await import(moduleUrl('/src/i18n/index.ts'));
        window.healthTemplates=(await import(moduleUrl('/src/stores/formattingTemplateStore.ts'))).useFormattingTemplateStore;
        healthStore.getState().setDocumentTitle('Health report test');
        healthStore.getState().setSceneNumbersLocked(true);
        const paragraph=(type,text,attrs={})=>({type,attrs,content:text?[{type:'text',text}]:[]});
        const content=[
            paragraph('sceneHeading','INT. STUDIO - DAY',{sceneNumber:'12'}),
            paragraph('action','She opens the door — zażółć.',{elementNumber:'12A',elementNumberLocked:true,elementNumberId:'first'}),
            paragraph('action','=SUM(1,2)',{elementNumber:'12A',elementNumberLocked:true,elementNumberId:'second'}),
            paragraph('character','SARAH'),
            paragraph('sceneHeading','EXT. STREET - DAY',{sceneNumber:'12'}),
            paragraph('dialogue','This line has no cue.'),
            paragraph('parenthetical','(softly)'),
            paragraph('sceneHeading',''),
            {type:'action',content:[{type:'text',text:'An unresolved detail.',marks:[{type:'scriptNote',attrs:{noteId:'note-open'}}]}]},
        ];
        const doc=healthEditor.schema.nodeFromJSON({type:'doc',content});
        healthEditor.view.dispatch(healthEditor.state.tr.replaceWith(0,healthEditor.state.doc.content.size,doc.content).setMeta('preventUpdate',true));
        window.makeNote=(id,content)=>({id,content,anchorText:'An unresolved detail.',elementType:'action',contextLabel:'',color:'yellow',createdAt:new Date().toISOString()});
        healthStore.getState().setNotes([makeNote('note-open','Check this detail.')]);
        await document.fonts.ready;
    }""")

    def open_report():
        page.locator(".menu-item").filter(has_text=re.compile(r"^Tools$")).click()
        page.locator(".menu-dropdown-item.has-children").filter(
            has=page.locator(":scope > span", has_text=re.compile(r"^Analytics$"))
        ).hover()
        page.get_by_text("Script Health", exact=True).click()
        page.get_by_role("dialog", name="Script Health").wait_for()

    def screenshot(name):
        directory = os.environ.get("OPENDRAFT_HEALTH_SCREENSHOTS")
        if directory:
            Path(directory).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(directory) / name))

    # The scene-number manager normalizes duplicate scene labels before this
    # report opens; collisions in stored element references remain for review.
    page.wait_for_function(
        "() => healthEditor.state.doc.child(0).attrs.sceneNumber !== healthEditor.state.doc.child(4).attrs.sceneNumber"
    )
    before = page.evaluate("healthEditor.getJSON()")
    open_report()
    dialog = page.locator(".script-health-dialog")
    expect(dialog.locator("#script-health-summary")).to_have_text("Findings to review: 7")
    screenshot("desktop.png")
    with page.expect_download() as download:
        dialog.get_by_role("button", name="Export CSV…").click()
    rows = list(
        csv.reader(
            Path(download.value.path()).read_text(encoding="utf-8-sig").splitlines()
        )
    )
    assert len(rows) == 8, rows
    assert not any("does not grade story quality" in str(row) for row in rows)
    assert rows[1][0] == page.evaluate("healthEditor.state.doc.child(0).attrs.sceneNumber"), rows[1]
    assert any("zażółć" in row[3] for row in rows[1:])
    assert any(row[3] == "'=SUM(1,2)" for row in rows[1:])
    assert page.evaluate("healthEditor.getJSON()") == before
    # The same findings appear beside the other built-in reports, with PDF.
    jump = dialog.get_by_role("button", name="Go to finding").first
    descriptions = jump.get_attribute("aria-describedby").split()
    assert all(page.locator('[id="'+identifier+'"]').count() == 1 for identifier in descriptions)
    dialog.get_by_role("button", name="Close", exact=True).click()
    page.locator(".menu-item").filter(has_text=re.compile(r"^Tools$")).click()
    page.locator(".menu-dropdown-item.has-children").filter(has=page.locator(":scope > span",has_text=re.compile(r"^Analytics$"))).hover()
    page.get_by_text("Reports…",exact=True).click()
    reports = page.get_by_role("dialog",name="Reports",exact=True)
    reports.get_by_role("option").filter(has=page.get_by_text("Script Health",exact=True)).click()
    expect(reports.locator("tbody tr")).to_have_count(7)
    assert "does not grade story quality" in reports.locator(".reports-summary").inner_text()
    screenshot("reports.png")
    with page.expect_download() as pdf_download:
        reports.get_by_role("button",name="Export PDF…").click()
    assert Path(pdf_download.value.path()).read_bytes().startswith(b"%PDF-")
    with page.expect_download() as csv_download:
        reports.get_by_role("button",name="Export CSV…").click()
    assert Path(csv_download.value.path()).read_bytes() == Path(download.value.path()).read_bytes()
    reports.get_by_role("button",name="Close",exact=True).click()
    open_report()
    # Note state changes and incoming document edits update the open report.
    page.evaluate(
        "healthStore.getState().setNotes([{...makeNote('note-open','Check this detail.'),resolved:true}])"
    )
    expect(dialog.locator("#script-health-summary")).to_have_text("Findings to review: 6")
    page.evaluate(
        "healthEditor.commands.insertContentAt(0,{type:'action',content:[{type:'text',text:'A new opening action.'}]})"
    )
    pending = dialog.locator("li").filter(
        has_text="This character cue has no dialogue."
    )
    pending.get_by_role("button", name="Go to finding").click()
    expect(dialog).not_to_be_visible()
    assert page.evaluate(
        "healthEditor.state.selection.$from.parent.type.name==='character' && healthEditor.state.selection.$from.parent.textContent==='SARAH'"
    )
    # A blank root with a reply retains its Section anchor and can be visited.
    page.evaluate("""() => {
        healthEditor.commands.setContent({type:'doc',content:[
            {type:'sceneHeading',content:[{type:'text',text:'INT. STUDIO - DAY'}]},
            {type:'section',content:[{type:'text',text:'A nonprinting section',marks:[{type:'scriptNote',attrs:{noteId:'section-thread'}}]}]},
        ]});
        healthStore.getState().setNotes([{...makeNote('section-thread',''),replies:[{id:'reply',author:'Review fixture',content:'Review this Section.',createdAt:new Date().toISOString()}]}]);
    }""")
    open_report()
    expect(dialog.get_by_text("Review this Section.",exact=True)).to_be_visible()
    assert dialog.get_by_role("button",name="Open notes").count() == 0
    dialog.get_by_role("button",name="Go to finding").click()
    assert page.evaluate("healthEditor.state.selection.$from.parent.type.name==='section'")
    # A missing note anchor opens the matching note rather than guessing a position.
    page.evaluate(
        "healthStore.getState().setNotes([makeNote('lost','Review the unanchored note.')])"
    )
    open_report()
    dialog.get_by_role("button", name="Open notes").click()
    assert page.evaluate(
        "healthStore.getState().scriptNotesOpen && healthStore.getState().noteFilter.noteId==='lost'"
    )
    page.evaluate("healthStore.getState().toggleScriptNotes()")
    # Native modal keyboard handling and phone-width layout.
    open_report()
    page.keyboard.press("Escape")
    expect(dialog).not_to_be_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    open_report()
    box = dialog.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 391, box
    assert dialog.evaluate("el=>el.scrollWidth<=el.clientWidth+1")
    screenshot("phone.png")
    dialog.get_by_role("button", name="Export CSV…").scroll_into_view_if_needed()
    assert dialog.get_by_role("button", name="Close", exact=True).is_visible()
    # Change the actual interface language while the report is open.
    page.evaluate("healthI18n.setLanguage('ar')")
    expect(page.get_by_role("heading", name="فحص السيناريو")).to_be_visible()
    assert page.locator("html").get_attribute("dir") == "rtl"
    assert dialog.evaluate("el=>el.scrollWidth<=el.clientWidth+1")
    screenshot("phone-rtl.png")
    page.evaluate("healthI18n.setLanguage('en')")
    # After initialization the report and its CSV export work offline.
    page.context.set_offline(True)
    with page.expect_download() as download:
        dialog.get_by_role("button", name="Export CSV…").click()
    assert Path(download.value.path()).stat().st_size > 0
    # The preview cap must not silently truncate the exported report.
    page.evaluate("""() => {
        healthStore.getState().setNotes([]);
        healthEditor.commands.setContent({type:'doc',content:Array.from({length:310},(_,index)=>({type:'dialogue',content:[{type:'text',text:'Orphan line '+index}]}))});
    }""")
    expect(dialog.locator("#script-health-summary")).to_have_text("Findings to review: 310")
    assert dialog.locator(".script-health-findings > li").count() == 300
    with page.expect_download() as download:
        dialog.get_by_role("button", name="Export CSV…").click()
    rows = list(
        csv.reader(
            Path(download.value.path()).read_text(encoding="utf-8-sig").splitlines()
        )
    )
    assert len(rows) == 311, len(rows)
    # Clean and empty scripts have distinct, explicitly scoped outcomes.
    page.evaluate(
        "healthEditor.commands.setContent({type:'doc',content:[{type:'character',content:[{type:'text',text:'SARAH'}]},{type:'dialogue',content:[{type:'text',text:'Hello.'}]}]})"
    )
    expect(
        dialog.get_by_text("No findings in these checks.", exact=True)
    ).to_be_visible()
    page.evaluate(
        "healthEditor.commands.setContent({type:'doc',content:[{type:'action'}]})"
    )
    expect(
        dialog.get_by_text("The script has no printable text.", exact=True)
    ).to_be_visible()
    assert dialog.get_by_role("button", name="Go to finding").count() == 0
    page.evaluate("healthStore.getState().setDocumentTitle('')")
    with page.expect_download() as untitled_download:
        dialog.get_by_role("button",name="Export CSV…").click()
    assert untitled_download.value.suggested_filename == "Untitled - Script Health.csv"
    expect(dialog.get_by_text("Script Health exported",exact=True)).to_be_visible()
    # A failed export must surface the error instead of a success toast.
    page.evaluate(
        "() => {window.originalHealthBlobUrl=URL.createObjectURL;URL.createObjectURL=()=>{throw new Error('Injected export failure')};}"
    )
    dialog.get_by_role("button", name="Export CSV…").click()
    expect(
        page.get_by_text("Export failed: Injected export failure", exact=True)
    ).to_be_visible()
    page.evaluate("() => {URL.createObjectURL=originalHealthBlobUrl;}")
    # New findings discard old success/failure feedback. Excerpts preserve the
    # final complete emoji cluster in both the dialog and actual CSV bytes.
    expected_excerpt = 'a' * 179 + '👨‍👩‍👧‍👦'
    page.evaluate("""text => {
        healthStore.getState().setNotes([]);
        healthEditor.commands.setContent({type:'doc',content:[{type:'dialogue',content:[{type:'text',text:text+'extra'}]}]});
    }""", expected_excerpt)
    expect(dialog.get_by_text('Export failed: Injected export failure',exact=True)).to_have_count(0)
    expect(dialog.locator('.script-health-findings li p')).to_have_text(expected_excerpt)
    with page.expect_download() as grapheme_download:
        dialog.get_by_role('button',name='Export CSV…').click()
    grapheme_rows=list(csv.reader(Path(grapheme_download.value.path()).read_text(encoding='utf-8-sig').splitlines()))
    assert grapheme_rows[1][3] == expected_excerpt, grapheme_rows
    expect(dialog.get_by_text('Script Health exported',exact=True)).to_be_visible()
    # Simulate an incoming collaboration edit between displaying a finding and
    # handling its click, inside one browser event turn. The jump must be refused
    # and its stale warning must disappear when the findings refresh.
    page.evaluate("""() => {
        const button=document.querySelector('.script-health-findings button');
        button.addEventListener('click',()=>healthEditor.commands.insertContentAt(1,'Updated '),{capture:true,once:true});
        button.click();
    }""")
    expect(dialog).to_be_visible()
    expect(dialog.get_by_text('The script changed. Try again with the updated report.',exact=True)).to_have_count(0)
    expect(dialog.get_by_text('Script Health exported',exact=True)).to_have_count(0)
    expect(dialog.locator('.script-health-findings li p')).to_contain_text('Updated ')
    # A customised Character Enter flow reports the skipped scope, while other
    # checks remain active. The same scope appears in Reports/PDF summaries.
    page.evaluate("""() => {
        window.healthOriginalDocumentTemplate=healthTemplates.getState().documentTemplate;
        window.healthOriginalTemplateId=healthTemplates.getState().activeTemplateId;
        const active=healthTemplates.getState().getActiveTemplate();
        healthTemplates.setState({activeTemplateId:'health-custom-flow',documentTemplate:{...active,id:'health-custom-flow',rules:{...active.rules,character:{...active.rules.character,nextOnEnter:'parenthetical'}}}});
    }""")
    skipped='Dialogue checks are skipped. This format must enable Character and Dialogue, with Character → Enter set to Dialogue.'
    expect(dialog.locator('#script-health-scope')).to_have_text(skipped)
    expect(dialog.locator('#script-health-summary')).to_have_text('Findings to review: 0')
    assert 'script-health-scope' in dialog.get_attribute('aria-describedby')
    page.set_viewport_size({'width':1440,'height':1000})
    screenshot('skipped-dialogue.png')
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate("healthI18n.setLanguage('ar')")
    expect(dialog.locator('#script-health-scope')).to_contain_text('تم تخطي فحوص الحوار')
    assert dialog.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
    screenshot('skipped-dialogue-rtl.png')
    page.evaluate("healthI18n.setLanguage('en')")
    page.set_viewport_size({'width':1440,'height':1000})
    dialog.get_by_role('button',name='Close',exact=True).click()
    page.locator('.menu-item').filter(has_text=re.compile(r'^Tools$')).click()
    page.locator('.menu-dropdown-item.has-children').filter(has=page.locator(':scope > span',has_text=re.compile(r'^Analytics$'))).hover()
    page.get_by_text('Reports…',exact=True).click()
    reports.get_by_role('option').filter(has=page.get_by_text('Script Health',exact=True)).click()
    expect(reports.locator('.reports-summary')).to_contain_text(skipped)
    expect(reports.locator('tbody tr')).to_have_count(0)
    with page.expect_download() as scoped_pdf:
        reports.get_by_role('button',name='Export PDF…').click()
    assert Path(scoped_pdf.value.path()).read_bytes().startswith(b'%PDF-')
    with page.expect_download() as scoped_csv:
        reports.get_by_role('button',name='Export CSV…').click()
    assert len(list(csv.reader(Path(scoped_csv.value.path()).read_text(encoding='utf-8-sig').splitlines()))) == 1
    reports.get_by_role('button',name='Close',exact=True).click()
    page.evaluate('healthTemplates.setState({activeTemplateId:healthOriginalTemplateId,documentTemplate:healthOriginalDocumentTemplate})')
    open_report()
    expect(dialog.locator('#script-health-scope')).to_have_count(0)
    expect(dialog.locator('#script-health-summary')).to_have_text('Findings to review: 1')
    assert not errors, errors
    print(
        json.dumps(
            {
                "findings": 7,
                "csv_utf8_and_formula_protection": True,
                "read_only": True,
                "live_updates": True,
                "jump_after_edit": True,
                "lost_note": True,
                "escape": True,
                "phone_and_rtl": True,
                "offline": True,
                "all_rows_exported": True,
                "clean_and_empty": True,
                "export_failure": True,
                "production_reports_and_pdf": True,
                "described_jump_buttons": True,
                "nonprinting_note_anchor_and_replies": True,
                "grapheme_excerpts_and_csv": True,
                "stale_feedback_after_refresh": True,
                "dialogue_scope_dialog_reports_pdf": True,
                "skipped_scope_phone_rtl": True,
                "errors": errors,
            }
        )
    )
    browser.close()
