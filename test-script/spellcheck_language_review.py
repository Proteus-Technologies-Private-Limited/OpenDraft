"""Review #240 regressions against Vite (Python Playwright + system Chromium).

Uses small routed Hunspell fixtures; no upstream dictionary downloads or native
files. Run with OPENDRAFT_TEST_URL=http://127.0.0.1:5173/.
"""
import os
import re
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


class SpellcheckReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get('OPENDRAFT_CHROMIUM') or '/usr/bin/chromium',
            args=['--no-sandbox'],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width':1440,'height':1000})
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script("performance.setResourceTimingBufferSize(5000);localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false}));localStorage.setItem('opendraft:formatPreferencesInitialized','1');localStorage.setItem('opendraft:enabledScriptFormats',JSON.stringify(['__industry_standard__']));")
        self.page.goto(os.environ.get('OPENDRAFT_TEST_URL','http://127.0.0.1:5173/'),wait_until='domcontentloaded')
        self.page.locator('.editor-main').wait_for()
        blank=self.page.get_by_role('button',name='Blank Document',exact=False)
        if blank.count(): blank.click()
        self.page.locator('.ProseMirror').wait_for()
        self.page.wait_for_function("""() => ['editor/spellchecker', 'stores/editorStore',
            'stores/projectStore', 'services/scriptApi', 'editor/languageCatalog'].every(path =>
                performance.getEntriesByType('resource').some(entry =>
                    new URL(entry.name).pathname === '/src/' + path + '.ts'))""")
        self.page.evaluate("""async () => {
            const module=path=>import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/'+path+'.ts').name);
            window.checker=(await module('editor/spellchecker')).spellChecker;
            window.testStore=(await module('stores/editorStore')).useEditorStore;
            window.testProject=(await module('stores/projectStore')).useProjectStore;
            window.testApi=(await module('services/scriptApi')).scriptApi;
            window.testLanguages=await module('editor/languageCatalog');
            window.polish=testLanguages.CATALOG.find(language=>language.code==='pl');
            window.polishUrls=testLanguages.urlsFor(polish);
            let element=document.querySelector('.ProseMirror');
            while(element && !window.testEditor) {
                const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
                let fiber=key && element[key];
                while(fiber) {
                    if(fiber.memoizedProps?.editor?.commands) {window.testEditor=fiber.memoizedProps.editor;break;}
                    fiber=fiber.return;
                }
                element=element.parentElement;
            }
            await checker.whenReady();
        }""")
        self.polish=self.page.evaluate('({label:polish.label,...polishUrls})')
        self.page.route(self.polish['dic'],lambda route:route.fulfill(body='2\npolski\nsynthetic\n'))

    def tearDown(self):
        self.page.unroute_all(behavior='ignoreErrors')
        self.page.close()
        self.assertEqual(self.errors,[])

    def menu(self):
        self.page.locator('.menu-item').filter(has_text=re.compile(r'^Edit$')).click()
        self.page.locator('.menu-dropdown-item.has-children').filter(has=self.page.locator(':scope > span',has_text=re.compile(r'^Spelling & Grammar$'))).hover()
        parent=self.page.locator('.menu-dropdown-item.has-children').filter(has=self.page.locator(':scope > span',has_text=re.compile(r'^Spellcheck Languages$')))
        parent.hover()
        return parent.locator(':scope > .menu-submenu')

    def row(self, menu, label):
        return menu.locator(':scope > .menu-dropdown-item').filter(has_text=re.compile(r'^✓? ?'+re.escape(label)+r'(?: — .*)?$'))

    def pending_download(self):
        self.pending=[]
        self.page.route(self.polish['aff'],lambda route:self.pending.append(route))
        self.row(self.menu(),self.polish['label']).click()
        for _ in range(50):
            if self.pending: break
            self.page.wait_for_timeout(50)
        self.assertEqual(len(self.pending),1)

    def finish_download(self):
        self.pending[0].fulfill(body='SET UTF-8\n')
        self.page.wait_for_function("checker.getLoadedLanguages().some(language=>language.code==='pl')")

    def test_last_working_guard_and_unavailable_codes_can_be_removed(self):
        attempted=[]
        self.page.route(self.polish['aff'],lambda route:(attempted.append(True),route.fulfill(status=503)))
        self.page.evaluate("checker.beginDocument(['en_US','pl','missing-custom']);testStore.getState().setSaveStatus('saved')")
        menu=self.menu()
        self.assertIn('disabled',self.row(menu,'English (US)').get_attribute('class'))
        polish=self.row(menu,self.polish['label'])
        self.assertIn('Not installed',polish.inner_text())
        polish.click()
        self.assertEqual(self.page.evaluate('checker.getEnabledLanguages()'),['en_US','missing-custom'])
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'),'unsaved')
        self.row(self.menu(),'missing-custom').click()
        self.assertEqual(self.page.evaluate('checker.getEnabledLanguages()'),['en_US'])
        self.assertEqual(attempted,[])

    def test_save_style_origin_change_does_not_cancel_activation(self):
        self.pending_download()
        generation=self.page.evaluate('checker.getDocumentGeneration()')
        self.page.evaluate("testStore.getState().setDocumentOrigin({bookmark:'test-save.odraft',name:'Saved.odraft',format:'odraft'})")
        self.assertEqual(self.page.evaluate('checker.getDocumentGeneration()'),generation)
        self.finish_download()
        self.page.wait_for_function("checker.getEnabledLanguages().includes('pl')")
        self.assertTrue(self.page.evaluate('testStore.getState().spellCheckEnabled'))

    def test_new_blank_during_download_does_not_enable_language(self):
        self.pending_download()
        generation=self.page.evaluate('checker.getDocumentGeneration()')
        self.page.locator('.menu-item').filter(has_text=re.compile(r'^File$')).click()
        self.page.locator('.menu-dropdown-item').filter(has=self.page.locator(':scope > span',has_text=re.compile(r'^New Script$'))).click()
        self.page.wait_for_function('(previous)=>checker.getDocumentGeneration()>previous',arg=generation)
        self.assertIsNone(self.page.evaluate('testProject.getState().currentScriptId'))
        self.assertIsNone(self.page.evaluate('testStore.getState().documentOrigin'))
        self.finish_download()
        toast=self.page.get_by_text(self.polish['label']+' is installed.',exact=True)
        expect(toast).to_be_visible()
        if os.environ.get('OPENDRAFT_SCREENSHOTS'):
            shots=Path(os.environ['OPENDRAFT_SCREENSHOTS']);shots.mkdir(parents=True,exist_ok=True)
            self.page.screenshot(path=str(shots/'spellcheck-install-toast.png'))
        self.assertEqual(self.page.evaluate('checker.getEnabledLanguages()'),['en_US'])
        self.assertFalse(self.page.evaluate('testStore.getState().spellCheckEnabled'))

    def test_unchanged_document_transitions_skip_scans_but_the_next_edit_is_saved(self):
        self.page.route(self.polish['aff'],lambda route:route.fulfill(body='SET UTF-8\n'))
        self.page.evaluate("checker.loadLanguage('pl',{affUrl:polishUrls.aff,dicUrl:polishUrls.dic,label:polish.label,persist:false})")
        self.page.evaluate("""() => {
            testEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'hello qzxinvalid'}]}]});
            testStore.getState().setSpellCheckEnabled(true);
        }""")
        self.page.wait_for_timeout(350)
        self.page.evaluate("""() => {
            window.spellChecks=0;
            const check=checker.check.bind(checker);
            checker.check=(word)=>{spellChecks++;return check(word);};
            checker.beginDocument();checker.beginDocument(['en_US']);
            testStore.getState().setSaveStatus('saved');
        }""")
        self.assertEqual(self.page.evaluate('spellChecks'),0)
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'),'saved')
        self.row(self.menu(),self.polish['label']).click()
        self.assertEqual(self.page.evaluate('checker.getEnabledLanguages()'),['en_US','pl'])
        self.assertGreater(self.page.evaluate('spellChecks'),0)
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'),'unsaved')

    def test_removing_the_only_working_download_restores_bundled_english(self):
        self.page.route(self.polish['aff'],lambda route:route.fulfill(body='SET UTF-8\n'))
        self.page.evaluate("checker.loadLanguage('pl',{affUrl:polishUrls.aff,dicUrl:polishUrls.dic,label:polish.label,persist:false})")
        self.page.evaluate("checker.beginDocument(['pl','unavailable-custom']);testStore.getState().setGrammarRulesPanelOpen(true)")
        self.page.get_by_role('button',name='Dictionaries',exact=True).click()
        label=self.page.locator('label').filter(has=self.page.locator('span',has_text=re.compile('^'+re.escape(self.polish['label'])+'$')))
        self.page.once('dialog',lambda dialog:dialog.accept())
        self.page.evaluate("testStore.getState().setSaveStatus('saved')")
        label.get_by_role('button',name='Remove this language',exact=True).click()
        self.page.wait_for_function("!checker.getLoadedLanguages().some(language=>language.code==='pl')")
        self.assertEqual(self.page.evaluate('checker.getEnabledLanguages()'),['en_US','unavailable-custom'])
        self.assertTrue(self.page.evaluate("checker.check('hello')"))
        self.assertFalse(self.page.evaluate("checker.check('qzxinvalid')"))
        english=self.page.locator('label').filter(has=self.page.locator('span',has_text=re.compile(r'^English \(US\)$')))
        expect(english.get_by_role('checkbox')).to_be_checked()
        expect(english.get_by_role('checkbox')).to_be_disabled()
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'),'unsaved')

    def test_unrelated_removal_keeps_unavailable_script_saved_without_metadata_write(self):
        self.page.route(self.polish['aff'], lambda route: route.fulfill(body='SET UTF-8\n'))
        self.page.evaluate("checker.loadLanguage('pl',{affUrl:polishUrls.aff,dicUrl:polishUrls.dic,label:polish.label,persist:false})")
        self.page.evaluate("""() => {
            checker.beginDocument(['fr']);
            testEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'Synthetic unavailable-language document.'}]}]});
            window.languageSaves=[];
            testApi.saveScript=async (project,script,data)=>{languageSaves.push(data);return {id:script};};
            testProject.getState().setCurrentProject({id:'language-project',name:'Language test',properties:{}});
            testProject.getState().setCurrentScriptId('language-script');
            testStore.getState().setGrammarRulesPanelOpen(true);
        }""")
        self.page.get_by_role('button', name='Dictionaries', exact=True).click()
        # Let setup metadata settle before observing the removal itself.
        self.page.wait_for_timeout(2300)
        self.page.evaluate("languageSaves.length=0;testStore.getState().setSaveStatus('saved')")
        label = self.page.locator('label').filter(has=self.page.locator(
            'span', has_text=re.compile('^' + re.escape(self.polish['label']) + '$')))
        self.page.once('dialog', lambda dialog: dialog.accept())
        label.get_by_role('button', name='Remove this language', exact=True).click()
        self.page.wait_for_function("!checker.getLoadedLanguages().some(language=>language.code==='pl')")
        self.page.evaluate("checker.unloadLanguage('not-loaded')")
        self.assertEqual(self.page.evaluate('checker.getEnabledLanguages()'), ['fr'])
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'), 'saved')
        self.page.wait_for_timeout(2300)
        self.assertEqual(self.page.evaluate('languageSaves'), [])
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'), 'saved')

    def test_settings_toggle_marks_dirty_and_uses_two_second_metadata_save(self):
        self.page.route(self.polish['aff'],lambda route:route.fulfill(body='SET UTF-8\n'))
        self.page.evaluate("checker.loadLanguage('pl',{affUrl:polishUrls.aff,dicUrl:polishUrls.dic,label:polish.label,persist:false})")
        self.page.evaluate("""() => {
            checker.beginDocument(['en_US','pl']);
            testEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'Synthetic language metadata save.'}]}]});
            window.languageSaves=[];
            testApi.saveScript=async (project,script,data)=>{languageSaves.push({project,script,...data});return {id:script};};
            testProject.getState().setCurrentProject({id:'language-project',name:'Language test',properties:{}});
            testProject.getState().setCurrentScriptId('language-script');
        }""")
        self.page.wait_for_timeout(200)
        self.page.evaluate("languageSaves.length=0;testStore.getState().setSaveStatus('saved');testStore.getState().setGrammarRulesPanelOpen(true)")
        self.page.get_by_role('button',name='Dictionaries',exact=True).click()
        label=self.page.locator('label').filter(has=self.page.locator('span',has_text=re.compile('^'+re.escape(self.polish['label'])+'$')))
        label.get_by_role('checkbox').uncheck()
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'),'unsaved')
        self.page.wait_for_function('languageSaves.length===1',timeout=5000)
        saved=self.page.evaluate('languageSaves[0]')
        self.assertEqual(saved['content']['_enabledLanguages'],['en_US'])
        self.assertEqual(saved['project'],'language-project')
        self.assertEqual(saved['script'],'language-script')
        self.assertEqual(self.page.evaluate('testStore.getState().saveStatus'),'saved')
        english=self.page.locator('label').filter(has=self.page.locator('span',has_text=re.compile(r'^English \(US\)$')))
        expect(english.get_by_role('checkbox')).to_be_disabled()


if __name__=='__main__':
    unittest.main(verbosity=2)
