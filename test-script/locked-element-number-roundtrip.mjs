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
import { assignElementNumbers, withElementNumbers } from './src/utils/elementNumbers';
import { collectNumberedElements } from './src/editor/extensions/ElementNumbers';
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
check('import does not lock source references',state.doc.toJSON().content.every(n=>!n.attrs?.elementNumberLocked),true);
const numberedOptions={getRules:()=>({action:{enabled:true,resetOn:[]}}),getSceneNumbersVisible:()=>false};
const numberedPlugins=ElementNumbers.config.addProseMirrorPlugins.call({options:numberedOptions});
let numbered=EditorState.create({schema,doc:schema.nodeFromJSON(parseFDXFull(xml).doc),plugins:numberedPlugins});
const typed=numbered.applyTransaction(numbered.tr.insertText('!',1));numbered=typed.state;
check('numbered format does not lock the entire imported action sequence',typed.transactions.length,1);
check('typing preserves sparse stored references with numbering enabled',refs(numbered.doc.toJSON()),expected);
check('typing does not stamp IDs on unnumbered source actions', [numbered.doc.child(0).attrs.elementNumberId,numbered.doc.child(2).attrs.elementNumberId],[null,null]);
check('format numbers other actions automatically without suffixes',assignElementNumbers(collectNumberedElements(numbered.doc).map(f=>f.item),numberedOptions.getRules(),{sceneNumbersVisible:false}),['1','2','3','S7','D8']);
const podcastOptions={getRules:()=>({dialogue:{enabled:true,resetOn:[]}}),getSceneNumbersVisible:()=>false};
const podcastPlugins=ElementNumbers.config.addProseMirrorPlugins.call({options:podcastOptions});
const podcastXML='<FinalDraft DocumentType="Script" Version="5"><Content><Paragraph Type="Dialogue" Number="1"><Text>First</Text></Paragraph><Paragraph Type="Dialogue" Number="2"><Text>Second</Text></Paragraph></Content></FinalDraft>';
let podcast=EditorState.create({schema,doc:schema.nodeFromJSON(parseFDXFull(podcastXML).doc),plugins:podcastPlugins});
podcast=podcast.applyTransaction(podcast.tr.insert(podcast.doc.content.size,schema.nodes.dialogue.create(null,schema.text('Third')))).state;
check('podcast import remains unlocked',collectNumberedElements(podcast.doc).every(f=>!f.item.numberLocked),true);
check('appended podcast dialogue follows automatic numbering',assignElementNumbers(collectNumberedElements(podcast.doc).map(f=>f.item),podcastOptions.getRules(),{sceneNumbersVisible:false}),['1','2','3']);
const resolved=withElementNumbers(podcast.doc.toJSON(),{visible:true,sceneNumbersVisible:false,rules:podcastOptions.getRules()});
const reopened=schema.nodeFromJSON(parseFDXFull(exportFDX(resolved,'Podcast')).doc);
check('reimported references opt into automatic counting',collectNumberedElements(reopened).every(f=>f.item.numberAutomatic),true);
let middle=EditorState.create({schema,doc:reopened,plugins:podcastPlugins});
middle=middle.applyTransaction(middle.tr.insert(middle.doc.child(0).nodeSize,schema.nodes.dialogue.create(null,schema.text('Middle')))).state;
const labels=state=>assignElementNumbers(collectNumberedElements(state.doc).map(f=>f.item),podcastOptions.getRules(),{sceneNumbersVisible:false});
check('insert after reimport renumbers the following lines',labels(middle),['1','2','3','4']);
const exportedMiddle=withElementNumbers(middle.doc.toJSON(),{visible:true,sceneNumbersVisible:false,rules:podcastOptions.getRules()});
check('export after a middle insertion stays unique',refs(parseFDXFull(exportFDX(exportedMiddle,'Podcast')).doc),['1','2','3','4']);
const removeAt=middle.doc.child(0).nodeSize+middle.doc.child(1).nodeSize;
middle=middle.applyTransaction(middle.tr.delete(removeAt,removeAt+middle.doc.child(2).nodeSize)).state;
check('delete after reimport closes the counter gap',labels(middle),['1','2','3']);
const commands=ElementNumbers.config.addCommands.call({options:podcastOptions});
commands.lockElementNumbers()({state:middle,tr:middle.tr,dispatch:tr=>{middle=middle.applyTransaction(tr).state;}});
check('locking after reimport freezes the unique automatic labels',refs(middle.doc.toJSON()),['1','2','3']);
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
