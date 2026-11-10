"""Chrome CDP fold emulation against Vite; Python Playwright required."""
from playwright.sync_api import sync_playwright
import json, os
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('OPENDRAFT_CHROMIUM') or ('/usr/bin/chromium' if os.path.isfile('/usr/bin/chromium') else None),args=['--no-sandbox','--enable-experimental-web-platform-features'])
 page=b.new_page(no_viewport=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("if(!localStorage.getItem('opendraft:viewState'))localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false}));")
 cd=page.context.new_cdp_session(page)
 cd.send('Emulation.setTouchEmulationEnabled',{'enabled':True})
 def posture(width=800,height=800,axis='vertical',fold='continuous'):
  metrics={'width':width,'height':height,'deviceScaleFactor':1,'mobile':True,'screenWidth':width,'screenHeight':height}
  if axis:metrics['displayFeature']={'orientation':axis,'offset':(width if axis=='vertical' else height)//2-10,'maskLength':20}
  cd.send('Emulation.setDeviceMetricsOverride',metrics)
  cd.send('Emulation.setTouchEmulationEnabled',{'enabled':True})
  cd.send('Emulation.setDevicePostureOverride',{'posture':{'type':fold}})
  page.wait_for_timeout(250)
  if page.url!='about:blank':assert page.evaluate('innerWidth')==width
 posture()
 page.goto(os.environ.get('OPENDRAFT_TEST_URL','http://127.0.0.1:5173/'),wait_until='domcontentloaded')
 page.locator('.editor-main').wait_for()
 blank=page.get_by_role('button',name='Blank Document',exact=False)
 if blank.count():blank.click()
 page.locator('.ProseMirror').wait_for()
 assert page.locator('html.foldable.wide').count()==1
 page.locator('.ProseMirror').click()
 page.keyboard.type('A writer folds the screen mid-sentence.')
 page.locator('.ProseMirror').evaluate("el=>{window.__editorDOM=el; const s=getSelection();window.__caret={node:s.anchorNode,offset:s.anchorOffset};}")
 # Import the exact running module URL, including Vite's HMR timestamp.
 page.evaluate("async()=>{const url=(name)=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/'+name+'.ts').name;window.__store=(await import(url('editorStore'))).useEditorStore;window.__table=(await import(url('tableReadStore'))).useTableReadStore;}")
 assert page.evaluate("window.__store.getState().toolbarMode")=='compact'
 assert page.evaluate("window.__store.getState().viewLayout")=='page'
 page.evaluate("window.__store.getState().setToolbarMode('comfortable')")
 posture(390,800,None)
 assert page.evaluate("window.__store.getState().toolbarMode")=='hidden'
 assert page.evaluate("window.__store.getState().viewLayout")=='phone'
 assert page.locator('.toolbar.toolbar-comfortable').is_visible()
 fab=page.locator('.menu-fab').bounding_box();toolbar=page.locator('.toolbar').bounding_box()
 assert abs(fab['x']+fab['width']-378)<2,(fab,toolbar)
 assert abs(fab['y']-(toolbar['y']+toolbar['height']+10))<2,(fab,toolbar)
 assert page.locator('.ProseMirror').evaluate('el=>el===window.__editorDOM')
 assert page.evaluate('getSelection().anchorNode===window.__caret.node && getSelection().anchorOffset===window.__caret.offset')
 page.evaluate("window.__store.getState().setToolbarMode('comfortable');window.__store.getState().setViewLayout('page');")
 posture()
 assert page.evaluate("window.__store.getState().toolbarMode")=='comfortable'
 assert page.evaluate("window.__store.getState().viewLayout")=='page'
 posture(951,669)
 page.evaluate("window.__store.getState().toggleNavigator()")
 page.wait_for_timeout(200)
 assert page.locator('.scene-navigator').evaluate("el=>getComputedStyle(el).position")=='relative'
 assert 80<=page.evaluate("window.__store.getState().zoomLevel")<=100
 page.evaluate("window.__table.getState().openTableRead()")
 panel=page.locator('.table-read-panel');panel.wait_for()
 panel.evaluate('el=>window.__readDOM=el')
 assert page.locator('.fold-panel-dock').is_visible()
 page.wait_for_timeout(200)
 assert page.locator('.scene-navigator').evaluate("el=>getComputedStyle(el).position")=='fixed'
 page.evaluate("window.__store.getState().toggleNavigator()")
 page.wait_for_timeout(250)
 main=page.locator('.editor-main').bounding_box();dock=page.locator('.fold-panel-dock').bounding_box()
 assert abs(main['height']-dock['height'])<3,(main,dock)
 if os.environ.get('OPENDRAFT_SCREENSHOT'):page.screenshot(path=os.environ['OPENDRAFT_SCREENSHOT'])
 page.evaluate("window.__table.getState().patch({status:'paused'})")
 page.evaluate("window.__store.getState().toggleLocationDatabase()")
 page.get_by_role('tab',name='Locations',exact=True).click()
 page.locator('.fold-panel-dock .location-database').wait_for(state='visible')
 assert not panel.is_visible()
 page.get_by_role('tab',name='Table Read',exact=True).click()
 assert panel.is_visible()
 posture(390,800,None)
 assert panel.evaluate('el=>el===window.__readDOM')
 assert page.evaluate("window.__table.getState().status")=='paused'
 assert not page.locator('.fold-panel-dock').is_visible()
 posture()
 assert panel.evaluate('el=>el===window.__readDOM')
 posture(fold='folded')
 assert page.locator('html.fold-book').count()==1
 assert page.locator('.editor-main.phone-layout').count()==1
 posture(axis='horizontal',fold='folded')
 assert page.locator('html.fold-laptop').count()==1
 posture(390,800,None)
 assert page.evaluate("window.__store.getState().toolbarMode")=='comfortable'
 assert page.evaluate("window.__store.getState().viewLayout")=='page'
 assert page.locator('.ProseMirror').evaluate('el=>el===window.__editorDOM')
 assert not errors,errors
 print(json.dumps({'chrome_fold_emulation':True,'posture_memory':True,'folded_toolbar_and_fab':True,'same_editor_and_table_read':True,'panel_tabs':True,'errors':errors}))
 b.close()
