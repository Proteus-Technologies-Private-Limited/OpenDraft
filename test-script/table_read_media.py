"""Vite integration check with an instrumented Media Session; no audio plays."""
from playwright.sync_api import sync_playwright
import os, json
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('OPENDRAFT_CHROMIUM') or ('/usr/bin/chromium' if os.path.isfile('/usr/bin/chromium') else None),args=['--no-sandbox'])
 page=browser.new_page()
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.add_init_script("""
 localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false}));
 window.__mediaHandlers={};
 Object.defineProperty(navigator,'mediaSession',{value:{metadata:null,playbackState:'none',setActionHandler:(action,handler)=>window.__mediaHandlers[action]=handler}});
 """)
 page.goto(os.environ.get('OPENDRAFT_TEST_URL','http://127.0.0.1:5173/'),wait_until='domcontentloaded')
 page.locator('.editor-main').wait_for()
 blank=page.get_by_role('button',name='Blank Document',exact=False)
 if blank.count():blank.click()
 page.locator('.ProseMirror').click()
 page.keyboard.type('A writer looks up.');page.keyboard.press('Enter');page.keyboard.type('The screen folds.')
 page.evaluate("async()=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/tableReadStore.ts').name;window.__table=(await import(url)).useTableReadStore;window.__table.getState().openTableRead();}")
 page.locator('.table-read-panel').wait_for()
 assert page.evaluate('window.__table.getState().lines.length')>=2
 page.evaluate('window.__mediaHandlers.nexttrack()')
 assert page.evaluate('window.__table.getState().current')==1
 page.evaluate('window.__mediaHandlers.previoustrack()')
 assert page.evaluate('window.__table.getState().current')==0
 page.evaluate("window.__table.getState().patch({status:'playing'});window.__mediaHandlers.pause()")
 assert page.evaluate('window.__table.getState().status')=='paused'
 assert page.evaluate('navigator.mediaSession.playbackState')=='paused'
 page.evaluate('window.__table.getState().setOpen(false)')
 page.locator('.table-read-panel').wait_for(state='detached')
 assert page.evaluate('Object.values(window.__mediaHandlers).every(value=>value===null)')
 assert page.evaluate('navigator.mediaSession.playbackState')=='none'
 assert page.evaluate('navigator.mediaSession.metadata') is None
 assert not errors,errors
 print(json.dumps({'line_steps':True,'pause':True,'state_sync':True,'cleanup':True,'errors':errors}))
 browser.close()
