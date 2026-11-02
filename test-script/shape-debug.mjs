// Print HarfBuzz output for a string next to the font's default advances.
// Usage: node test-script/shape-debug.mjs <font.ttf> <script> <text>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const hb = require('harfbuzzjs/hbjs.js')(await require('harfbuzzjs/hb.js')());
const bytes = readFileSync(process.argv[2]);
const font = hb.createFont(hb.createFace(hb.createBlob(bytes), 0));
const nominal = hb.createFont(hb.createFace(hb.createBlob(bytes), 0));
const run = (features) => {
  const b = hb.createBuffer(); b.addText(process.argv[4]); b.setDirection('ltr'); b.setScript(process.argv[3]);
  b.guessSegmentProperties(); hb.shape(font, b, features); const r = b.json(); b.destroy(); return r;
};
const shaped = run();
const plain = run('-kern,-dist,-abvm,-blwm,-mark,-mkmk');
console.log(shaped.map((g, i) => `${g.g}@${g.cl} ax=${g.ax}${plain[i] && plain[i].ax !== g.ax ? `(def ${plain[i].ax})` : ''} dx=${g.dx} dy=${g.dy}`).join('\n'));
