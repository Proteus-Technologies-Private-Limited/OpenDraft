/**
 * PDF export of scripts that used to come out blank: Khmer, Lao, Myanmar,
 * Ethiopic, Cherokee, Tibetan — and lines that mix them with Latin.
 * Usage: node test-script/repro-scripts-pdf.mjs   (dev server on :5173)
 * Writes test-script/output/issues-269-270/scripts/*.
 */
import puppeteer from '/tmp/od-pw/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output', 'issues-269-270', 'scripts');
const DL = join(OUT, '.dl'); rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLES = {
  khmer: 'សួស្តី ពិភពលោក ខ្ញុំស្រលាញ់ភាសាខ្មែរ',
  lao: 'ສະບາຍດີ ໂລກ ຂ້ອຍຮັກພາສາລາວ',
  myanmar: 'မင်္ဂလာပါ ကမ္ဘာကြီး ကျွန်တော် မြန်မာစကား ပြောတတ်ပါတယ်',
  ethiopic: 'ሰላም ልዑል ዓለም አማርኛ ቋንቋ',
  cherokee: 'ᎣᏏᏲ ᎠᏂᏴᏫᏯ ᏣᎳᎩ',
  tibetan: 'བཀྲ་ཤིས་བདེ་ལེགས། བོད་སྐད་',
  vietnamese: 'Tiếng Việt có nhiều dấu: ế ề ể ễ ệ ộ ỗ ớ ờ ữ ừ',
  polish: 'Zażółć gęślą jaźń, łódź płynęła przez Kraków.',
  english: 'Maria looks out of the window while the wind tugs at the curtains all night long.',
  hindi: 'नमस्ते दुनिया, मुझे पटकथा लिखना बहुत पसंद है। क्षत्रिय ज्ञान श्रीमान',
  tamil: 'வணக்கம் உலகம், எனக்கு திரைக்கதை எழுத மிகவும் பிடிக்கும். கு கூ கொ',
  cyrillic: 'Мария смотрит в окно, пока ветер рвёт занавески всю ночь.',
  chinese: '你好，世界。我喜欢写剧本，今晚的月亮很圆。',
  japanese: 'こんにちは世界。私は脚本を書くのが好きです。',
  korean: '안녕하세요 세계. 저는 시나리오 쓰기를 좋아합니다.',
};
if (process.env.ONLY) for (const k of Object.keys(SAMPLES)) if (!process.env.ONLY.split(',').includes(k)) delete SAMPLES[k];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const t = await b.newPage(); await t.setViewport({ width: 1500, height: 1100 });
t.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await t.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
const ED = `(()=>{let el=document.querySelector('.tiptap');while(el){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));if(k){let f=el[k];while(f){const p=f.memoizedProps;if(p&&p.editor&&p.editor.commands&&p.editor.state)return p.editor;f=f.return;}}el=el.parentElement;}return null;})()`;
const tx = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const LONGTEXT = {
  hindi: ['नमस्ते दुनिया, मुझे पटकथा लिखना बहुत पसंद है।', 'क्षत्रिय ज्ञान श्रीमान द्वारा लिखी गई कहानी बहुत सुंदर है।', 'आज रात बारिश तेज़ होगी, इसलिए हमें जल्दी निकलना चाहिए।', 'उसने खिड़की से बाहर देखा और धीरे से कहा, "सब ठीक हो जाएगा।"', 'प्रेम, विश्वास और परिवार — यही जीवन की असली पूँजी है।'],
  tamil: ['வணக்கம் உலகம், எனக்கு திரைக்கதை எழுத மிகவும் பிடிக்கும்.', 'கு கூ கொ கோ கௌ — இவை தமிழ் எழுத்துகள்.', 'இன்று இரவு மழை பலமாக பெய்யும், எனவே நாம் சீக்கிரம் புறப்பட வேண்டும்.', 'அவள் ஜன்னல் வழியாக வெளியே பார்த்து மெதுவாகச் சொன்னாள், "எல்லாம் சரியாகிவிடும்."', 'அன்பு, நம்பிக்கை, குடும்பம் — இதுவே வாழ்க்கையின் உண்மையான செல்வம்.'],
};
const content = [];
if (process.env.LONG) {
  const L = LONGTEXT[process.env.ONLY];
  const mk = (i, k) => L[(i + k) % L.length];
  for (let i = 0; i < 30; i++) {
    content.push({ type: 'sceneHeading', content: [tx(`INT. ${mk(i, 0).split(' ')[0]} - DAY ${i + 1}`)] });
    content.push({ type: 'action', content: [tx(mk(i, 1) + ' '), tx(mk(i, 2), [{ type: 'bold' }]), tx(' '), tx(mk(i, 3), [{ type: 'italic' }]), tx(' ' + mk(i, 4))] });
    content.push({ type: 'character', content: [tx('मारिया')] });
    content.push({ type: 'parenthetical', content: [tx('(' + mk(i, 2).split(' ').slice(0, 2).join(' ') + ')')] });
    content.push({ type: 'dialogue', content: [tx(mk(i, 3) + ' ' + mk(i, 0) + ' ' + mk(i, 4))] });
    content.push({ type: 'transition', content: [tx('CUT TO:')] });
  }
}
for (const [name, s] of (process.env.LONG ? [] : Object.entries(SAMPLES))) {
  content.push({ type: 'sceneHeading', content: [tx(`INT. ${name.toUpperCase()} - DAY`)] });
  content.push({ type: 'action', content: [tx(s)] });
  content.push({ type: 'action', content: [tx('Latin then '), tx(s, [{ type: 'bold' }]), tx(' and Latin again.')] });
  content.push({ type: 'character', content: [tx('MARIA')] });
  content.push({ type: 'dialogue', content: [tx(s + ' ' + s)] });
}
await t.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' }); await t.waitForSelector('.tiptap'); await sleep(2500);
const pt = await t.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Blank Document'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await t.mouse.click(pt.x, pt.y); await sleep(1200);
await t.evaluate(`(()=>{${ED}.commands.setContent(${JSON.stringify({ type: 'doc', content })},true);})()`); await sleep(2000);
await t.screenshot({ path: join(OUT, 'editor.png') });
const click = (re, sel) => t.evaluate((src, sel) => { const re = new RegExp(src); const el = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0).find((e) => re.test((e.textContent || '').trim())); (el.closest(sel) || el).click(); }, re.source, sel);
await click(/^File$/, 'button,div[class*=menu-item]'); await sleep(500);
await click(/^Export/, 'div[class*=menu-dropdown-item],button,li'); await sleep(500);
await click(/^PDF/, 'div[class*=menu-dropdown-item],button,li'); await sleep(700);
await t.evaluate(() => { const a = [...document.querySelectorAll('button')].find((x) => /^(Export|Save|Download|OK)( PDF)?$/i.test((x.textContent || '').trim())); if (a) a.click(); });
let pdf = null;
for (let i = 0; i < 120 && !pdf; i++) { await sleep(500); const f = readdirSync(DL).find((x) => x.endsWith('.pdf')); if (f) { pdf = join(OUT, process.env.OUTNAME || 'scripts.pdf'); renameSync(join(DL, f), pdf); } }
if (!pdf) { await t.screenshot({ path: join(OUT, 'no-pdf.png') }); throw new Error('no pdf'); }
console.log(execSync(`pdffonts "${pdf}" 2>/dev/null`).toString());
console.log(execSync(`pdfinfo "${pdf}" | grep -E "Pages|File size"`).toString());
execSync(`pdftoppm -png -r 70 "${pdf}" "${join(OUT, 'page')}" 2>/dev/null`);
await b.close();
