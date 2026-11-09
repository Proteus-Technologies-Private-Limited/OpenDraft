"""Run against Vite with Python Playwright and system Chromium."""
from playwright.sync_api import sync_playwright
import re, json, os
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':700,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false}));")
 page.goto(os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/'),wait_until='domcontentloaded')
 page.locator('.editor-main').wait_for()
 blank=page.get_by_role('button',name='Blank Document',exact=False)
 if blank.count():blank.click()
 page.locator('.menu-item').filter(has=page.get_by_text('View',exact=True)).click()
 row=page.locator('.menu-dropdown-item.has-children').filter(has_text=re.compile(r'^Panels'))
 row.hover()
 menu=page.locator('.menu-submenu:visible').first
 menu.wait_for()
 for width in [600,601,700,768,769,900,768,601]:
  page.set_viewport_size({'width':width,'height':900})
  page.wait_for_timeout(80)
  actual=menu.evaluate("el=>({position:getComputedStyle(el).position,inline:el.style.position,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})")
  assert actual['position']==('static' if width<=768 else 'fixed'),(width,actual)
  assert actual['left']>=-1 and actual['right']<=width+1,(width,actual)
 page.set_viewport_size({'width':700,'height':900})
 row.hover()
 # Location overlay remains usable through a live resize.
 menu.get_by_text('Locations',exact=True).click()
 panel=page.locator('.location-database.panel-open');panel.wait_for()
 page.wait_for_timeout(300)
 for width in [375,600,601,768,900,901,1250,700]:
  page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(80)
  actual=panel.evaluate("el=>({position:getComputedStyle(el).position,width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})")
  if width<=900:
   assert actual['position']=='fixed',(width,actual)
   assert actual['left']>=-1 and actual['right']<=width+1,(width,actual)
   if width<=480:assert abs(actual['width']-width)<2,(width,actual)
  else:assert actual['position']!='fixed',(width,actual)
 # The same app instance stays open through every breakpoint.
 panel.locator('.location-db-close').click()
 panel.wait_for(state='detached')
 # Install touch support before loading the editor; no editor-state change
 # should be needed to enable a gesture after a viewport resize.
 page.add_init_script("Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});")
 page.set_viewport_size({'width':1250,'height':900})
 page.reload(wait_until='domcontentloaded')
 page.locator('.editor-main').wait_for()
 def touch(kind,x):
  page.locator('.editor-main').evaluate("(el,args)=>{const t=new Touch({identifier:1,target:el,clientX:args.x,clientY:300});el.dispatchEvent(new TouchEvent(args.kind,{bubbles:true,touches:args.kind==='touchstart'?[t]:[],changedTouches:[t]}));}",{'kind':kind,'x':x})
 touch('touchstart',3);touch('touchend',110)
 assert page.locator('.scene-navigator.panel-open').count()==0,'wide navigator opened'
 page.set_viewport_size({'width':800,'height':900})
 touch('touchstart',3)
 page.set_viewport_size({'width':1250,'height':900})
 touch('touchend',110)
 assert page.locator('.scene-navigator.panel-open').count()==0,'gesture survived widening'
 page.set_viewport_size({'width':800,'height':900})
 touch('touchstart',3);touch('touchend',110)
 page.locator('.scene-navigator.panel-open').wait_for()
 assert not errors,errors
 print(json.dumps({'submenu_boundaries_and_live_resize':True,'location_overlay_375_to_900_and_dock_above':True,'close_works':True,'swipe_live_resize':True,'page_errors':errors}))
 browser.close()
