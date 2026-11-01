/**
 * Browser regression for sparse FDX references and numbering repair.
 * Run `node test-script/locked-element-number-roundtrip.mjs`, then open the
 * generated index.html in Chromium. The result is in window.numberingResults.
 * Uses the browser's real XML selectors; xmldom cannot drive parseFDXFull.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'frontend/package.json'));
const { build } = require('esbuild');
const out = join(root, 'test-script/output/locked-element-number-roundtrip');
mkdirSync(out, { recursive: true });
await build({
  stdin: {
    contents: `
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { testExtensions } from './src/test/screenplaySchema';
import { ElementNumbers, elementNumbersPluginKey } from './src/editor/extensions/ElementNumbers';
import { parseFDXFull } from './src/utils/fdxParser';
import { exportFDX } from './src/utils/fdxExporter';
const results=[];
const check=(label,got,want)=>{if(JSON.stringify(got)!==JSON.stringify(want))throw Error(label+': '+JSON.stringify(got));results.push(label);};
const xml='<FinalDraft DocumentType="Script" Version="5"><Content><Paragraph Type="Action"><Text>Before</Text></Paragraph><Paragraph Type="Action" Number="12"><Text>Source</Text></Paragraph><Paragraph Type="Action"><Text>After</Text></Paragraph><Paragraph Type="Shot" Number="S7"><Text>CLOSE ON</Text></Paragraph><Paragraph Type="Dialogue" Number="D8"><Text>Words.</Text></Paragraph></Content></FinalDraft>';
const schema=getSchema([...testExtensions,ElementNumbers]);
const options={getRules:()=>({}),getSceneNumbersVisible:()=>false};
const plugins=ElementNumbers.config.addProseMirrorPlugins.call({options});
let state=EditorState.create({schema,doc:schema.nodeFromJSON(parseFDXFull(xml).doc),plugins});
const refs=doc=>doc.content.map(n=>n.attrs?.elementNumber??null);
const expected=[null,'12',null,'S7','D8'];
check('imported references stay sparse',refs(state.doc.toJSON()),expected);
check('only source-numbered elements have decorations',elementNumbersPluginKey.getState(state).find().length,3);
const applied=state.applyTransaction(state.tr.insertText('!',1));state=applied.state;
check('ordinary edit creates no repair transaction',applied.transactions.length,1);
const exported=exportFDX(state.doc.toJSON(),'References');
check('FDX round trip preserves all supported references',refs(parseFDXFull(exported).doc),expected);
const hidden=exportFDX(state.doc.toJSON(),'References',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{elementNumbersVisible:false});
check('explicit hiding affects only exported references',refs(parseFDXFull(hidden).doc),[null,null,null,null,null]);
check('export leaves native references intact',refs(state.doc.toJSON()),expected);
window.numberingResults={passed:true,checks:results};
document.querySelector('#out').textContent=results.map(s=>'PASS '+s).join('\\n');
`,
    resolveDir: join(root, 'frontend'),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  outfile: join(out, 'check.js'),
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>FDX references regression</title><pre id="out">Running…</pre><script src="check.js"></script>',
);
console.log(join(out, 'index.html'));
