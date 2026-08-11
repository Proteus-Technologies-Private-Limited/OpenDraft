/**
 * Regression harness for act page breaks, run against the RUNNING app.
 *
 * Switches to the 1-Hour TV Drama format (forceBreakBefore: ['newAct']), builds
 * an action line + an act, then performs the real editing gesture — Enter, then
 * the element dropdown → New Act — and prints element positions plus page
 * separators at each step. Both acts must end up one page pitch apart, and the
 * layout must not change when text is typed into the new act.
 *
 * Usage:  node test-script/act-page-break-live.mjs
 * Needs the app served on :8008 and puppeteer-core in /tmp/od-pw (kept outside
 * the repo so package.json is untouched).
 */
import puppeteer from '/tmp/od-pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new'});
const t = await b.newPage(); await t.setViewport({width:1500,height:1100});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ED=`(()=>{let el=document.querySelector('.tiptap');while(el){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));if(k){let f=el[k];while(f){const p=f.memoizedProps;if(p&&p.editor&&p.editor.commands&&p.editor.state)return p.editor;f=f.return;}}el=el.parentElement;}return null;})()`;
const SNAP=`(()=>{const root=document.querySelector('.tiptap');const page=document.querySelector('.page');const pt=page.getBoundingClientRect().top;
const els=[...root.children].map((el,i)=>({i,cls:el.className.replace('screenplay-element ','').split(' ')[0],txt:(el.textContent||'').slice(0,12)||'EMPTY',top:Math.round(el.getBoundingClientRect().top-pt),mt:getComputedStyle(el).marginTop}));
return JSON.stringify({els,seps:[...document.querySelectorAll('.page-sep')].map(s=>Math.round(s.getBoundingClientRect().top-pt))});})()`;
await t.goto('http://localhost:8008',{waitUntil:'domcontentloaded'});
await t.waitForSelector('.tiptap',{timeout:20000}); await sleep(2500);
// switch to TV drama
await t.evaluate(()=>{const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim()==='Format');(el.closest('button,div[class*=menu-item]')||el).click();}); await sleep(800);
await t.evaluate(()=>{const el=[...document.querySelectorAll('[class*=menu-dropdown] *')].filter(e=>e.children.length===0).find(e=>/^Formatting Template/.test((e.textContent||'').trim()));(el.closest('div[class*=menu-dropdown-item],button,li')||el).click();}); await sleep(1500);
await t.evaluate(()=>{const c=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim()==='1-Hour TV Drama');(c.closest('[class*=card],[class*=item],li,div')||c).click();}); await sleep(600);
await t.evaluate(()=>{const a=[...document.querySelectorAll('button')].find(b=>/^(Apply|Use|Select|OK)$/i.test((b.textContent||'').trim()));if(a)a.click();}); await sleep(2200);
await t.evaluate(`(()=>{${ED}.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'Opening action.'}]},{type:'newAct',content:[{type:'text',text:'ACT TWO'}]}]},true);})()`); await sleep(1200);
console.log('BASELINE      :', await t.evaluate(SNAP));
// REAL GESTURE: cursor at end of the action line, Enter, then element dropdown -> New Act
await t.evaluate(`(()=>{const ed=${ED};ed.commands.focus();ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize-1);})()`); await sleep(400);
await t.keyboard.press('Enter'); await sleep(900);
console.log('AFTER ENTER   :', await t.evaluate(SNAP));
await t.select('.element-selector','newAct'); await sleep(1500);
console.log('AFTER ->NewAct:', await t.evaluate(SNAP));
await t.keyboard.type('ACT THREE'); await sleep(1500);
console.log('AFTER TYPING  :', await t.evaluate(SNAP));
await b.close();
