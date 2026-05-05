// Compile docxExporter.ts via esbuild and run it to produce a real .docx,
// then inspect the OOXML to see what's going on with the title page layout
// and the body section's first paragraph.

import { build } from 'esbuild';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

// Stub out the editorStore import the exporter pulls in for HF defaults
const stubsDir = path.join(outDir, 'stubs');
mkdirSync(path.join(stubsDir, 'src/stores'), { recursive: true });
mkdirSync(path.join(stubsDir, 'src/utils'), { recursive: true });
writeFileSync(path.join(stubsDir, 'src/stores/editorStore.ts'), `
export const DEFAULT_HEADER_CONTENT = { left: '', center: '', right: '{page}.' };
export const DEFAULT_FOOTER_CONTENT = { left: '', center: '', right: '' };
export type HeaderFooterContent = { left: string; center: string; right: string };
export type PageLayout = {
  pageWidth: number; pageHeight: number;
  topMargin: number; bottomMargin: number;
  headerMargin: number; footerMargin: number;
  leftMargin: number; rightMargin: number;
  headerContent: HeaderFooterContent;
  footerContent: HeaderFooterContent;
  headerStartPage?: number;
  footerStartPage?: number;
};
`);

// Stub fileOps so saveFile is a no-op the exporter can await
writeFileSync(path.join(stubsDir, 'src/utils/fileOps.ts'), `
export async function saveFile(_data: any, _name: string, _filters?: any): Promise<boolean> { return true; }
`);

const projectRoot = path.resolve(__dirname, '..');
const exporterPath = path.join(projectRoot, 'frontend/src/utils/docxExporter.ts');

const result = await build({
  entryPoints: [exporterPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['docx', 'jszip'],
  write: false,
  loader: { '.ts': 'ts' },
  plugins: [{
    name: 'stub-resolver',
    setup(b) {
      b.onResolve({ filter: /editorStore$/ }, () => ({ path: path.join(stubsDir, 'src/stores/editorStore.ts') }));
      b.onResolve({ filter: /fileOps$/ }, () => ({ path: path.join(stubsDir, 'src/utils/fileOps.ts') }));
    },
  }],
});
const compiled = result.outputFiles[0].text;
const tmpFile = path.join(outDir, 'docxExporter.bundled.mjs');
writeFileSync(tmpFile, compiled);
const mod = await import(tmpFile);

// We need to capture the bytes the exporter produces.  Replace saveFile to
// store them in a closure variable.
let captured = null;
const captureSaveFileSrc = `
export async function saveFile(data, _name, _filters) {
  if (typeof data === 'string') globalThis.__captured = new TextEncoder().encode(data);
  else globalThis.__captured = data;
  return true;
}
`;
writeFileSync(path.join(stubsDir, 'src/utils/fileOps.ts'), captureSaveFileSrc);

const result2 = await build({
  entryPoints: [exporterPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['docx', 'jszip'],
  write: false,
  loader: { '.ts': 'ts' },
  plugins: [{
    name: 'stub-resolver',
    setup(b) {
      b.onResolve({ filter: /editorStore$/ }, () => ({ path: path.join(stubsDir, 'src/stores/editorStore.ts') }));
      b.onResolve({ filter: /fileOps$/ }, () => ({ path: path.join(stubsDir, 'src/utils/fileOps.ts') }));
    },
  }],
});
writeFileSync(tmpFile, result2.outputFiles[0].text);
const mod2 = await import(tmpFile + '?2');

const layout = {
  pageWidth: 8.5, pageHeight: 11,
  topMargin: 72, bottomMargin: 72,
  headerMargin: 36, footerMargin: 36,
  leftMargin: 1.5, rightMargin: 1.0,
  headerContent: { left: '', center: '', right: '{page}.' },
  footerContent: { left: '', center: '', right: '' },
  headerStartPage: 2,
  footerStartPage: 1,
};

const doc = {
  type: 'doc',
  content: [
    { type: 'titlePage', attrs: { field: 'title', tpTitle: 'TEST TITLE', tpWrittenBy: 'A. Writer', tpDraft: 'First Draft', tpDraftDate: 'May 2026', tpContact: 'a@b.com\n555-1212', tpCopyright: '© 2026', tpWgaRegistration: 'WGA #123' } },
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
    { type: 'action', content: [{ type: 'text', text: 'Stuff happens.' }] },
    { type: 'character', content: [{ type: 'text', text: 'BOB' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Hello.' }] },
  ],
};

await mod2.exportDocx(doc, 'TestTitlePage', layout);
const buf = globalThis.__captured;
if (!buf) throw new Error('Exporter did not produce output');
writeFileSync(path.join(outDir, 'inspect-titlepage.docx'), Buffer.from(buf));
console.log(`Wrote ${path.join(outDir, 'inspect-titlepage.docx')} (${buf.length} bytes)`);

// Inspect OOXML
const zip = await JSZip.loadAsync(buf);
const docXmlText = await zip.file('word/document.xml').async('string');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = new DOMParser().parseFromString(docXmlText, 'application/xml');

console.log('\n=== Sections (sectPr) ===');
const sectPrs = xml.getElementsByTagNameNS(W_NS, 'sectPr');
for (let i = 0; i < sectPrs.length; i++) {
  const sp = sectPrs[i];
  const type = sp.getElementsByTagNameNS(W_NS, 'type')[0];
  const tpVal = type ? (type.getAttributeNS(W_NS, 'val') || type.getAttribute('w:val')) : '(none)';
  const titlePg = sp.getElementsByTagNameNS(W_NS, 'titlePg').length > 0 ? 'YES' : 'no';
  const pgMar = sp.getElementsByTagNameNS(W_NS, 'pgMar')[0];
  const top = pgMar ? (pgMar.getAttributeNS(W_NS, 'top') || pgMar.getAttribute('w:top')) : '?';
  const left = pgMar ? (pgMar.getAttributeNS(W_NS, 'left') || pgMar.getAttribute('w:left')) : '?';
  console.log(`  Section ${i}: type=${tpVal}, titlePg=${titlePg}, top=${top}tw, left=${left}tw`);
}

console.log('\n=== All paragraphs (top-level) ===');
const body = xml.getElementsByTagNameNS(W_NS, 'body')[0];
let idx = 0;
for (const child of Array.from(body.childNodes)) {
  if (child.nodeType !== 1 || child.localName !== 'p') continue;
  const pPr = child.getElementsByTagNameNS(W_NS, 'pPr')[0];
  const spacing = pPr ? pPr.getElementsByTagNameNS(W_NS, 'spacing')[0] : null;
  const before = spacing ? (spacing.getAttributeNS(W_NS, 'before') || spacing.getAttribute('w:before')) : '0';
  const ind = pPr ? pPr.getElementsByTagNameNS(W_NS, 'ind')[0] : null;
  const indL = ind ? (ind.getAttributeNS(W_NS, 'left') || ind.getAttribute('w:left')) : null;
  const align = pPr ? pPr.getElementsByTagNameNS(W_NS, 'jc')[0]?.getAttributeNS(W_NS, 'val') : null;
  const pageBreakBefore = pPr ? pPr.getElementsByTagNameNS(W_NS, 'pageBreakBefore').length > 0 : false;
  const sectPrInside = pPr ? pPr.getElementsByTagNameNS(W_NS, 'sectPr').length > 0 : false;
  const ts = child.getElementsByTagNameNS(W_NS, 't');
  let text = '';
  for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
  const brs = child.getElementsByTagNameNS(W_NS, 'br');
  let brTypes = [];
  for (let j = 0; j < brs.length; j++) brTypes.push(brs[j].getAttributeNS(W_NS, 'type') || brs[j].getAttribute('w:type') || 'line');
  console.log(`  [${idx++}] before=${before}tw, indL=${indL}, align=${align}, pgBrBefore=${pageBreakBefore}, sectPrInside=${sectPrInside}, brTypes=[${brTypes.join(',')}], text=${JSON.stringify(text.slice(0, 50))}`);
}
