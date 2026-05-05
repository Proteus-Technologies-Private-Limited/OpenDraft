// Round-trip diagnostic: export a known TipTap doc with docxExporter logic,
// re-import it with docxImporter logic, and compare element types.
//
// The goal is to find out why characters become dialogue and dialogue becomes
// action when you export and re-import a screenplay.
//
// Run from project root:
//   node test-script/test-docx-roundtrip.mjs

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, LineRuleType,
} from 'docx';
import JSZip from 'jszip';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });
globalThis.DOMParser = XmldomDOMParser;

// =============================================================================
// Mirror of EXPORTER constants
// =============================================================================
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const LINE_HEIGHT_PT = 12;
const FONT_FAMILY = 'Courier Prime';
const FONT_SIZE_HALFPT = 24;
const FD_INDENTS = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50], character: [3.50, 7.50],
  dialogue: [2.50, 6.00], parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50],
};
const SPACE_BEFORE = {
  sceneHeading: 1, action: 1, character: 1, dialogue: 0, parenthetical: 0,
  transition: 1, general: 0,
};
const UPPERCASE_TYPES = new Set(['sceneHeading', 'character', 'transition']);
const CENTERED_TYPES = new Set(['newAct', 'endOfAct', 'showEpisode']);
const RIGHT_ALIGNED_TYPES = new Set(['transition']);
const BOLD_TYPES = new Set(['sceneHeading']);

const layout = {
  pageWidth: 8.26, pageHeight: 11.69,
  topMargin: 72, bottomMargin: 72,
  headerMargin: 36, footerMargin: 36,
  leftMargin: 1.50, rightMargin: 0.76,
};

function indentForType(typeName) {
  const indents = FD_INDENTS[typeName] || FD_INDENTS.general;
  const leftIn = indents[0] - layout.leftMargin;
  const rightIn = (layout.pageWidth - layout.rightMargin) - indents[1];
  return { left: Math.round(leftIn * TWIPS_PER_INCH), right: Math.round(rightIn * TWIPS_PER_INCH) };
}
function alignmentForType(t) {
  if (CENTERED_TYPES.has(t)) return AlignmentType.CENTER;
  if (RIGHT_ALIGNED_TYPES.has(t)) return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}
function applyTypeStyles(text, typeName) {
  return UPPERCASE_TYPES.has(typeName) ? text.toUpperCase() : text;
}

// Build paragraph for an element node (mirrors docxExporter.buildElementParagraph)
function buildElementParagraph(node, isFirst) {
  const typeName = node.type;
  const indent = indentForType(typeName);
  const text = applyTypeStyles(node.content?.[0]?.text || '', typeName);
  const sb = isFirst ? 0 : (SPACE_BEFORE[typeName] ?? 0) * LINE_HEIGHT_PT;
  return new Paragraph({
    alignment: alignmentForType(typeName),
    indent: { left: indent.left, right: indent.right },
    spacing: {
      before: sb * TWIPS_PER_POINT,
      line: LINE_HEIGHT_PT * TWIPS_PER_POINT,
      lineRule: LineRuleType.EXACT,
    },
    children: [new TextRun({
      text,
      font: FONT_FAMILY,
      size: FONT_SIZE_HALFPT,
      bold: BOLD_TYPES.has(typeName) || undefined,
    })],
  });
}

// =============================================================================
// Sample screenplay doc (Tiptap-shaped)
// =============================================================================
const original = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. COFFEE SHOP - DAY' }] },
    { type: 'action', content: [{ type: 'text', text: 'Anna sits at a corner table with her laptop.' }] },
    { type: 'character', content: [{ type: 'text', text: 'ANNA' }] },
    { type: 'parenthetical', content: [{ type: 'text', text: '(to herself)' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Where did I leave that note?' }] },
    { type: 'action', content: [{ type: 'text', text: 'She rifles through her bag.' }] },
    { type: 'character', content: [{ type: 'text', text: 'BARISTA' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'You okay over there?' }] },
    { type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] },
    { type: 'sceneHeading', content: [{ type: 'text', text: 'EXT. STREET - NIGHT' }] },
    { type: 'action', content: [{ type: 'text', text: 'Anna runs through rain.' }] },
  ],
};

// =============================================================================
// Build .docx
// =============================================================================
const pageWidthTw = Math.round(layout.pageWidth * TWIPS_PER_INCH);
const pageHeightTw = Math.round(layout.pageHeight * TWIPS_PER_INCH);
const sectionPageProps = {
  page: {
    size: { width: pageWidthTw, height: pageHeightTw },
    margin: {
      top: Math.round(layout.topMargin * TWIPS_PER_POINT),
      bottom: Math.round(layout.bottomMargin * TWIPS_PER_POINT),
      left: Math.round(layout.leftMargin * TWIPS_PER_INCH),
      right: Math.round(layout.rightMargin * TWIPS_PER_INCH),
      header: Math.round(layout.headerMargin * TWIPS_PER_POINT),
      footer: Math.round(layout.footerMargin * TWIPS_PER_POINT),
    },
  },
};
const bodyParagraphs = original.content.map((n, i) => buildElementParagraph(n, i === 0));
const doc = new Document({
  creator: 'OpenDraft test',
  styles: {
    default: { document: { run: { font: FONT_FAMILY, size: FONT_SIZE_HALFPT } } },
  },
  sections: [{ properties: sectionPageProps, children: bodyParagraphs }],
});
const buf = await Packer.toBuffer(doc);
writeFileSync(path.join(outDir, 'roundtrip.docx'), buf);
console.log(`Exported ${path.join(outDir, 'roundtrip.docx')}`);

// =============================================================================
// Inspect raw OOXML to see what was written
// =============================================================================
const zip = await JSZip.loadAsync(buf);
const docXmlText = await zip.file('word/document.xml').async('string');

// Extract paragraphs with their indent + alignment + plain text
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parser = new XmldomDOMParser();
const xml = parser.parseFromString(docXmlText, 'application/xml');
const ps = xml.getElementsByTagNameNS(W_NS, 'p');
console.log(`\n=== Inspect emitted paragraphs (${ps.length}) ===`);
for (let i = 0; i < ps.length; i++) {
  const p = ps[i];
  const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  const ind = pPr ? pPr.getElementsByTagNameNS(W_NS, 'ind')[0] : null;
  const indLeft = ind ? (ind.getAttributeNS(W_NS, 'left') || ind.getAttribute('w:left')) : null;
  const indRight = ind ? (ind.getAttributeNS(W_NS, 'right') || ind.getAttribute('w:right')) : null;
  const jc = pPr ? pPr.getElementsByTagNameNS(W_NS, 'jc')[0] : null;
  const align = jc ? (jc.getAttributeNS(W_NS, 'val') || jc.getAttribute('w:val')) : 'left';
  const ts = p.getElementsByTagNameNS(W_NS, 't');
  let text = '';
  for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
  console.log(`  [${i}] indL=${indLeft}, indR=${indRight}, align=${align}, text=${JSON.stringify(text.slice(0, 40))}`);
}

// =============================================================================
// Run the importer logic
// =============================================================================
import { promisify } from 'util';
import { spawn } from 'child_process';

// We can't directly import the .ts importer.  Re-implement the relevant bits inline.
// (Mirrors docxImporter.ts after the fix: includes page-margin compensation.)

const FD_LEFT_INDENTS = {
  sceneHeading: 1.50, action: 1.50, character: 3.50, dialogue: 2.50,
  parenthetical: 3.00, transition: 5.50, lyrics: 2.50,
};
const INDENT_TOLERANCE_IN = 0.25;
const RE_SCENE_HEADING = /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/i;
const RE_TRANSITION_END = /TO:\s*$/;
const RE_TRANSITION_START = /^(FADE\s+IN|FADE\s+OUT|FADE\s+TO|CUT\s+TO|DISSOLVE\s+TO|MATCH\s+CUT|SMASH\s+CUT|JUMP\s+CUT|TIME\s+CUT)\b/i;
const RE_PAREN_ONLY = /^\(.*\)$/;

function approxEq(a, t, tol = INDENT_TOLERANCE_IN) { return a != null && Math.abs(a - t) <= tol; }
function looksLikeCharacter(text) {
  if (!text) return false;
  const cleaned = text.replace(/\(.*?\)$/, '').trim();
  if (!cleaned || cleaned.length > 40) return false;
  if (/[.!?]$/.test(cleaned)) return false;
  if (cleaned.replace(/[^A-Za-z]/g, '').length === 0) return false;
  return cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}
function classifyByIndent(absLeft, alignment, italic) {
  if (alignment === 'right') return 'transition';
  if (absLeft == null) return null;
  if (approxEq(absLeft, FD_LEFT_INDENTS.character)) return 'character';
  if (approxEq(absLeft, FD_LEFT_INDENTS.parenthetical)) return 'parenthetical';
  if (approxEq(absLeft, FD_LEFT_INDENTS.dialogue)) return italic ? 'lyrics' : 'dialogue';
  if (approxEq(absLeft, FD_LEFT_INDENTS.transition)) return 'transition';
  return null;
}
function classifyByText(text, alignment, bold) {
  if (!text) return null;
  if (RE_SCENE_HEADING.test(text)) return 'sceneHeading';
  if (RE_TRANSITION_END.test(text) || RE_TRANSITION_START.test(text)) return 'transition';
  if (RE_PAREN_ONLY.test(text) && text.length < 80) return 'parenthetical';
  if (alignment === 'center' && bold && text === text.toUpperCase()) {
    if (/^ACT\b/i.test(text) || /\bACT\b/i.test(text)) return /END/i.test(text) ? 'endOfAct' : 'newAct';
  }
  return null;
}

// Read page margin from sectPr
const sectPr = xml.getElementsByTagNameNS(W_NS, 'sectPr')[0];
const pgMar = sectPr ? sectPr.getElementsByTagNameNS(W_NS, 'pgMar')[0] : null;
const pageMarginLeftIn = pgMar ? (Number(pgMar.getAttributeNS(W_NS, 'left') || pgMar.getAttribute('w:left') || '0') / TWIPS_PER_INCH) : 0;
console.log(`\nPage margin left: ${pageMarginLeftIn} in`);

console.log('\n=== Classify (current importer behavior, NO margin compensation) ===');
const types = [];
for (let i = 0; i < ps.length; i++) {
  const p = ps[i];
  const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  const ind = pPr ? pPr.getElementsByTagNameNS(W_NS, 'ind')[0] : null;
  const rawL = ind ? Number(ind.getAttributeNS(W_NS, 'left') || ind.getAttribute('w:left') || '0') / TWIPS_PER_INCH : null;
  const jc = pPr ? pPr.getElementsByTagNameNS(W_NS, 'jc')[0] : null;
  const align = jc ? (jc.getAttributeNS(W_NS, 'val') || jc.getAttribute('w:val')) : 'left';
  const ts = p.getElementsByTagNameNS(W_NS, 't');
  let text = '';
  for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
  text = text.trim();

  const noCompCls = classifyByIndent(rawL, align, false) || classifyByText(text, align, false) || (looksLikeCharacter(text) ? 'character' : null) || 'action';
  types.push(noCompCls);
}
const expected = original.content.map((n) => n.type);
console.log('  Original:  ' + expected.join(', '));
console.log('  Imported:  ' + types.join(', '));
let mismatchCount = 0;
for (let i = 0; i < expected.length; i++) {
  if (types[i] !== expected[i]) {
    console.log(`    Mismatch [${i}]: expected ${expected[i]}, got ${types[i]} — text: ${JSON.stringify(original.content[i].content[0].text.slice(0, 40))}`);
    mismatchCount++;
  }
}
console.log(`  Mismatches (no compensation): ${mismatchCount}`);

console.log('\n=== Classify WITH page-margin compensation ===');
const types2 = [];
for (let i = 0; i < ps.length; i++) {
  const p = ps[i];
  const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  const ind = pPr ? pPr.getElementsByTagNameNS(W_NS, 'ind')[0] : null;
  const rawL = ind ? Number(ind.getAttributeNS(W_NS, 'left') || ind.getAttribute('w:left') || '0') / TWIPS_PER_INCH : null;
  const absL = rawL != null ? rawL + pageMarginLeftIn : null;
  const jc = pPr ? pPr.getElementsByTagNameNS(W_NS, 'jc')[0] : null;
  const align = jc ? (jc.getAttributeNS(W_NS, 'val') || jc.getAttribute('w:val')) : 'left';
  const ts = p.getElementsByTagNameNS(W_NS, 't');
  let text = '';
  for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
  text = text.trim();

  let cls = classifyByIndent(absL, align, false);
  if (!cls) cls = classifyByText(text, align, false);
  if (!cls && looksLikeCharacter(text)) cls = 'character';
  if (!cls) cls = 'action';
  types2.push(cls);
}
console.log('  Original:  ' + expected.join(', '));
console.log('  Imported:  ' + types2.join(', '));
let mismatchCount2 = 0;
for (let i = 0; i < expected.length; i++) {
  if (types2[i] !== expected[i]) {
    console.log(`    Mismatch [${i}]: expected ${expected[i]}, got ${types2[i]} — text: ${JSON.stringify(original.content[i].content[0].text.slice(0, 40))}`);
    mismatchCount2++;
  }
}
console.log(`  Mismatches (with compensation): ${mismatchCount2}`);
