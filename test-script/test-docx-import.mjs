// Smoke test for the Word (.docx) importer.
//
// Generates four fixture .docx files (FD-style indents, style-name-only,
// plain text with patterns only, and a title page) using the `docx` library,
// then runs the same parseDocx logic against each fixture and asserts the
// classifier produces the expected element types.
//
// We use @xmldom/xmldom to provide DOMParser in Node — frontend/src/utils/
// docxImporter.ts uses the browser DOMParser at runtime; this test runs the
// same algorithm with the polyfill swapped in.
//
// Run from project root:
//   node test-script/test-docx-import.mjs
//
// Output fixtures land in test-script/output/ (gitignored).

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  LineRuleType, AlignmentType as _AT,
} from 'docx';
import JSZip from 'jszip';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

void _AT;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

// Make a global DOMParser so the imported logic finds one.  In real use,
// docxImporter.ts uses window.DOMParser inside the browser/Tauri WebView.
globalThis.DOMParser = XmldomDOMParser;

// =============================================================================
// Importer logic — duplicated from frontend/src/utils/docxImporter.ts so we can
// run it under Node.  Keep in sync if the importer changes.
// =============================================================================

const TWIPS_PER_INCH = 1440;
const INDENT_TOLERANCE_IN = 0.25;
const FD_LEFT_INDENTS = {
  sceneHeading: 1.50, action: 1.50, character: 3.50, dialogue: 2.50,
  parenthetical: 3.00, transition: 5.50, lyrics: 2.50,
};
const STYLE_NAME_MAP = [
  [/^scene\s*heading$|^slug(line)?$|^heading\s*1$/i, 'sceneHeading'],
  [/^action$|^description$|^scene\s*action$/i, 'action'],
  [/^character$|^character\s*name$|^cue$/i, 'character'],
  [/^dialog(ue)?$|^speech$/i, 'dialogue'],
  [/^parenthetical$|^paren(s)?$|^wryly$/i, 'parenthetical'],
  [/^transition$/i, 'transition'],
  [/^shot$/i, 'shot'],
  [/^lyric(s)?$|^singing$/i, 'lyrics'],
  [/^new\s*act$/i, 'newAct'],
  [/^end\s*of\s*act$/i, 'endOfAct'],
  [/^show\/?episode$|^show\s*heading$/i, 'showEpisode'],
  [/^cast\s*list$/i, 'castList'],
  [/^general$/i, 'general'],
];
const RE_SCENE_HEADING = /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/i;
const RE_TRANSITION_END = /TO:\s*$/;
const RE_TRANSITION_START = /^(FADE\s+IN|FADE\s+OUT|FADE\s+TO|CUT\s+TO|DISSOLVE\s+TO|MATCH\s+CUT|SMASH\s+CUT|JUMP\s+CUT|TIME\s+CUT)\b/i;
const RE_PAREN_ONLY = /^\(.*\)$/;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function getAttrNS(el, attr) {
  return el.getAttributeNS?.(W_NS, attr) ?? el.getAttribute?.(`w:${attr}`) ?? el.getAttribute?.(attr) ?? null;
}
function firstChildNS(parent, tag) {
  if (!parent) return null;
  const ns = parent.getElementsByTagNameNS?.(W_NS, tag);
  if (ns?.length) return ns[0];
  const fb = parent.getElementsByTagName?.(`w:${tag}`);
  return fb?.length ? fb[0] : null;
}
function childrenNS(parent, tag) {
  if (!parent) return [];
  const ns = parent.getElementsByTagNameNS?.(W_NS, tag);
  if (ns?.length) return Array.from(ns);
  return Array.from(parent.getElementsByTagName?.(`w:${tag}`) || []);
}
function parsePrIndent(pPr) {
  if (!pPr) return {};
  const ind = firstChildNS(pPr, 'ind'); if (!ind) return {};
  const left = getAttrNS(ind, 'left') ?? getAttrNS(ind, 'start');
  const right = getAttrNS(ind, 'right') ?? getAttrNS(ind, 'end');
  const out = {};
  if (left) { const n = Number(left); if (!isNaN(n)) out.left = n / TWIPS_PER_INCH; }
  if (right) { const n = Number(right); if (!isNaN(n)) out.right = n / TWIPS_PER_INCH; }
  return out;
}
function parsePrAlignment(pPr) {
  if (!pPr) return undefined;
  const jc = firstChildNS(pPr, 'jc'); if (!jc) return undefined;
  const v = (getAttrNS(jc, 'val') || '').toLowerCase();
  if (v === 'center') return 'center';
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'both' || v === 'justify') return 'justify';
  return 'left';
}
function parseRPrFlags(rPr) {
  if (!rPr) return {};
  const out = {};
  const onFlag = (tag) => {
    const el = firstChildNS(rPr, tag); if (!el) return false;
    const v = getAttrNS(el, 'val'); if (v == null) return true;
    return v !== '0' && v.toLowerCase() !== 'false';
  };
  if (onFlag('b')) out.bold = true;
  if (onFlag('i')) out.italic = true;
  const u = firstChildNS(rPr, 'u');
  if (u) { const v = (getAttrNS(u, 'val') || '').toLowerCase(); if (v && v !== 'none') out.underline = true; }
  if (onFlag('strike')) out.strike = true;
  if (onFlag('caps')) out.caps = true;
  return out;
}
function buildStyleMap(stylesXml) {
  const map = new Map(); if (!stylesXml) return map;
  const styles = childrenNS(stylesXml.documentElement, 'style');
  for (const s of styles) {
    const styleId = getAttrNS(s, 'styleId') || '';
    const nameEl = firstChildNS(s, 'name');
    const name = nameEl ? getAttrNS(nameEl, 'val') || '' : '';
    const basedOnEl = firstChildNS(s, 'basedOn');
    const basedOn = basedOnEl ? getAttrNS(basedOnEl, 'val') || undefined : undefined;
    const pPr = firstChildNS(s, 'pPr'); const rPr = firstChildNS(s, 'rPr');
    const ind = parsePrIndent(pPr); const alignment = parsePrAlignment(pPr);
    const flags = parseRPrFlags(rPr);
    map.set(styleId, { name, indentLeftIn: ind.left, indentRightIn: ind.right, alignment, bold: flags.bold, italic: flags.italic, caps: flags.caps, basedOn });
  }
  return map;
}
function resolveStyle(styleId, map) {
  const chain = []; let id = styleId; const seen = new Set();
  while (id && !seen.has(id)) { seen.add(id); const s = map.get(id); if (!s) break; chain.unshift(s); id = s.basedOn; }
  const merged = { name: '' };
  for (const s of chain) {
    if (s.name) merged.name = s.name;
    if (s.indentLeftIn != null) merged.indentLeftIn = s.indentLeftIn;
    if (s.indentRightIn != null) merged.indentRightIn = s.indentRightIn;
    if (s.alignment) merged.alignment = s.alignment;
    if (s.bold != null) merged.bold = s.bold;
    if (s.italic != null) merged.italic = s.italic;
    if (s.caps != null) merged.caps = s.caps;
  }
  return merged;
}
function readRun(r, paraStyle) {
  const rPr = firstChildNS(r, 'rPr'); const flags = parseRPrFlags(rPr);
  let text = '';
  for (const child of Array.from(r.childNodes)) {
    if (child.nodeType !== 1) continue;
    const local = child.localName;
    if (local === 't') text += child.textContent || '';
    else if (local === 'tab') text += '\t';
    else if (local === 'br') text += '\n';
  }
  const caps = flags.caps || paraStyle.caps;
  if (caps && text) text = text.toUpperCase();
  return {
    text,
    bold: !!(flags.bold ?? paraStyle.bold),
    italic: !!(flags.italic ?? paraStyle.italic),
    underline: !!flags.underline,
    strike: !!flags.strike,
  };
}
function readParagraph(p, styleMap) {
  const pPr = firstChildNS(p, 'pPr');
  const styleEl = firstChildNS(pPr, 'pStyle');
  const styleId = styleEl ? getAttrNS(styleEl, 'val') || undefined : undefined;
  const inherited = resolveStyle(styleId, styleMap);
  const directInd = parsePrIndent(pPr); const directAlign = parsePrAlignment(pPr);
  const directRPrFlags = parseRPrFlags(firstChildNS(pPr, 'rPr'));
  const indentLeftIn = directInd.left ?? inherited.indentLeftIn;
  const indentRightIn = directInd.right ?? inherited.indentRightIn;
  const alignment = directAlign ?? inherited.alignment ?? 'left';
  const paragraphBold = !!(directRPrFlags.bold ?? inherited.bold);
  const paragraphItalic = !!(directRPrFlags.italic ?? inherited.italic);
  const paragraphCaps = !!(directRPrFlags.caps ?? inherited.caps);
  const pageBreakBefore = !!firstChildNS(pPr, 'pageBreakBefore');
  const runs = [];
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType !== 1) continue;
    if (child.localName === 'r') {
      runs.push(readRun(child, { ...inherited, bold: paragraphBold, italic: paragraphItalic, caps: paragraphCaps, name: inherited.name }));
    }
  }
  let runHasPageBreak = false;
  for (const b of childrenNS(p, 'br')) {
    if ((getAttrNS(b, 'type') || '').toLowerCase() === 'page') runHasPageBreak = true;
  }
  const plainText = runs.map(r => r.text).join('').trim();
  return { styleName: inherited.name, indentLeftIn, indentRightIn, alignment, paragraphBold, paragraphItalic, paragraphCaps, pageBreakBefore: pageBreakBefore || runHasPageBreak, plainText, runs };
}
function flattenBody(body, styleMap) {
  const paragraphs = [];
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1) continue;
    if (child.localName === 'p') paragraphs.push(readParagraph(child, styleMap));
  }
  return paragraphs;
}
function approxEq(a, t, tol = INDENT_TOLERANCE_IN) { return a != null && Math.abs(a - t) <= tol; }
function looksLikeCharacter(text) {
  if (!text) return false;
  const cleaned = text.replace(/\(.*?\)$/, '').trim();
  if (!cleaned || cleaned.length > 40) return false;
  if (/[.!?]$/.test(cleaned)) return false;
  const letters = cleaned.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  return cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}
function classifyByStyleName(name) { if (!name) return null; for (const [re, t] of STYLE_NAME_MAP) if (re.test(name.trim())) return t; return null; }
function classifyByIndent(p) {
  if (p.alignment === 'right') return 'transition';
  const left = p.indentLeftIn; if (left == null) return null;
  if (approxEq(left, FD_LEFT_INDENTS.character)) return 'character';
  if (approxEq(left, FD_LEFT_INDENTS.parenthetical)) return 'parenthetical';
  if (approxEq(left, FD_LEFT_INDENTS.dialogue)) return p.paragraphItalic ? 'lyrics' : 'dialogue';
  if (approxEq(left, FD_LEFT_INDENTS.transition)) return 'transition';
  return null;
}
function classifyByText(p) {
  const text = p.plainText; if (!text) return null;
  if (RE_SCENE_HEADING.test(text)) return 'sceneHeading';
  if (RE_TRANSITION_END.test(text) || RE_TRANSITION_START.test(text)) return 'transition';
  if (RE_PAREN_ONLY.test(text) && text.length < 80) return 'parenthetical';
  if (p.alignment === 'center' && p.paragraphBold && text === text.toUpperCase()) {
    if (/^ACT\b/i.test(text) || /\bACT\b/i.test(text)) return /END/i.test(text) ? 'endOfAct' : 'newAct';
  }
  return null;
}
function detectTitlePage(paragraphs) {
  let end = -1, sawCenter = false;
  for (let i = 0; i < Math.min(paragraphs.length, 40); i++) {
    const p = paragraphs[i];
    if (p.pageBreakBefore && i > 0) { end = i; break; }
    if (p.plainText && RE_SCENE_HEADING.test(p.plainText)) { end = i; break; }
    if (p.plainText) {
      if (p.alignment === 'center') sawCenter = true;
      else if (p.alignment === 'left' && i > 5) { end = -1; break; }
    }
  }
  if (!sawCenter || end < 0) return { tp: null, consumed: 0 };
  const tp = { tpTitle: '', tpWrittenBy: '', tpBasedOn: '', tpDraft: '', tpDraftDate: '', tpContact: '', tpCopyright: '', tpWgaRegistration: '' };
  const lines = [];
  for (let i = 0; i < end; i++) if (paragraphs[i].plainText) lines.push(paragraphs[i].plainText);
  if (!lines.length) return { tp: null, consumed: 0 };
  tp.tpTitle = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i];
    if (/^(written\s+by|by)$/i.test(t) && i + 1 < lines.length) { tp.tpWrittenBy = lines[i + 1]; i++; }
    else if (/^(based\s+on|from)/i.test(t)) tp.tpBasedOn = t;
    else if (/copyright|©/i.test(t)) tp.tpCopyright = t;
    else if (/\bWGA\b|registration/i.test(t)) tp.tpWgaRegistration = t;
    else if (/draft/i.test(t)) tp.tpDraft = t;
    else if (/@|\.com|phone|\d{3}[-.)\s]\d{3}/i.test(t)) tp.tpContact = tp.tpContact ? `${tp.tpContact}\n${t}` : t;
  }
  return { tp, consumed: end };
}

async function parseDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const docXmlText = await zip.file('word/document.xml').async('string');
  const stylesFile = zip.file('word/styles.xml');
  const stylesXmlText = stylesFile ? await stylesFile.async('string') : null;
  const parser = new XmldomDOMParser();
  const docXml = parser.parseFromString(docXmlText, 'application/xml');
  const stylesXml = stylesXmlText ? parser.parseFromString(stylesXmlText, 'application/xml') : null;
  const styleMap = buildStyleMap(stylesXml);
  const body = docXml.getElementsByTagNameNS(W_NS, 'body')[0] || docXml.getElementsByTagName('w:body')[0];
  // Page-margin compensation
  const sectPrs = body.getElementsByTagNameNS(W_NS, 'sectPr');
  let pageMarginLeftIn = 0;
  if (sectPrs.length > 0) {
    const pgMar = firstChildNS(sectPrs[sectPrs.length - 1], 'pgMar');
    if (pgMar) {
      const left = getAttrNS(pgMar, 'left') ?? getAttrNS(pgMar, 'start');
      if (left != null) { const n = Number(left); if (!isNaN(n)) pageMarginLeftIn = n / TWIPS_PER_INCH; }
    }
  }
  const paragraphs = flattenBody(body, styleMap);
  if (pageMarginLeftIn !== 0) {
    for (const p of paragraphs) if (p.indentLeftIn != null) p.indentLeftIn += pageMarginLeftIn;
  }
  const { tp, consumed } = detectTitlePage(paragraphs);
  const types = new Array(paragraphs.length).fill('action');
  let ambiguousCount = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (i < consumed) continue;
    const p = paragraphs[i];
    if (!p.plainText) { types[i] = 'action'; continue; }
    let cls = classifyByStyleName(p.styleName) || classifyByIndent(p) || classifyByText(p);
    if (cls) types[i] = cls;
    else if (looksLikeCharacter(p.plainText)) types[i] = 'character';
    else { types[i] = 'action'; ambiguousCount++; }
  }
  // Sequencing pass — walk the whole dialogue block after a confirmed character.
  for (let i = 0; i < paragraphs.length; i++) {
    if (types[i] !== 'character') continue;
    let next = i + 1;
    while (next < paragraphs.length && !paragraphs[next].plainText) next++;
    if (next >= paragraphs.length) { types[i] = 'action'; continue; }
    const np0 = paragraphs[next], nt0 = types[next];
    const looksDialogue0 = nt0 === 'dialogue' || nt0 === 'parenthetical' || nt0 === 'lyrics';
    const indentSuggestsDialogue0 = approxEq(np0.indentLeftIn, FD_LEFT_INDENTS.dialogue) || approxEq(np0.indentLeftIn, FD_LEFT_INDENTS.parenthetical);
    const ft0 = np0.plainText;
    const followerLooksLikeProse0 = ft0.length > 0 && ft0 !== ft0.toUpperCase() && !RE_SCENE_HEADING.test(ft0) && !RE_TRANSITION_END.test(ft0) && !RE_TRANSITION_START.test(ft0);
    if (!looksDialogue0 && !indentSuggestsDialogue0 && !followerLooksLikeProse0) { types[i] = 'action'; continue; }
    let j = next;
    while (j < paragraphs.length) {
      const np = paragraphs[j];
      if (!np.plainText) { j++; continue; }
      const tj = types[j];
      if (tj === 'sceneHeading' || tj === 'transition' || tj === 'newAct' || tj === 'endOfAct' || tj === 'shot' || tj === 'showEpisode' || tj === 'castList') break;
      if (tj === 'character') break;
      if (looksLikeCharacter(np.plainText) && tj !== 'parenthetical') break;
      if (tj === 'action' && !RE_PAREN_ONLY.test(np.plainText)) types[j] = 'dialogue';
      j++;
      const k = j;
      if (k < paragraphs.length && paragraphs[k].plainText) {
        const npk = paragraphs[k], tk = types[k];
        const stillBlock = tk === 'dialogue' || tk === 'parenthetical' || tk === 'lyrics' ||
          approxEq(npk.indentLeftIn, FD_LEFT_INDENTS.dialogue) ||
          approxEq(npk.indentLeftIn, FD_LEFT_INDENTS.parenthetical) ||
          RE_PAREN_ONLY.test(npk.plainText);
        if (!stillBlock) break;
      }
    }
  }
  return { types, paragraphs, tp, consumed, ambiguousCount };
}

// =============================================================================
// Fixture builders
// =============================================================================

function indentParagraph(text, leftIn, rightIn, opts = {}) {
  return new Paragraph({
    indent: { left: Math.round(leftIn * TWIPS_PER_INCH), right: Math.round(rightIn * TWIPS_PER_INCH) },
    alignment: opts.alignment || AlignmentType.LEFT,
    spacing: { line: 240, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text, font: 'Courier Prime', size: 24, bold: opts.bold, italics: opts.italic })],
  });
}
function styleParagraph(text, styleName) {
  return new Paragraph({
    style: styleName.replace(/\s+/g, ''), // docx lib derives styleId by collapsing spaces
    spacing: { line: 240, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text, font: 'Courier Prime', size: 24 })],
  });
}
function plainParagraph(text, opts = {}) {
  return new Paragraph({
    alignment: opts.alignment || AlignmentType.LEFT,
    spacing: { line: 240, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text, font: 'Courier Prime', size: 24, bold: opts.bold, italics: opts.italic })],
  });
}

async function buildIndentFixture() {
  // FD-style indents: every element at its canonical indent. No style names.
  const doc = new Document({
    creator: 'OpenDraft test',
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 0, right: 0 } },
      },
      children: [
        indentParagraph('INT. COFFEE SHOP - DAY', 1.50, 1.00, { bold: true }),
        indentParagraph('Anna sits with her laptop.', 1.50, 1.00),
        indentParagraph('ANNA', 3.50, 1.00),
        indentParagraph('(to herself)', 3.00, 2.50),
        indentParagraph('Where is that note?', 2.50, 2.00),
        indentParagraph('CUT TO:', 5.50, 1.00, { alignment: AlignmentType.RIGHT }),
        indentParagraph('EXT. STREET - NIGHT', 1.50, 1.00, { bold: true }),
        indentParagraph('She runs.', 1.50, 1.00),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function buildStyleFixture() {
  // Style-name only — no explicit indents.  Use docx's custom paragraph styles.
  const styles = {
    paragraphStyles: [
      { id: 'SceneHeading', name: 'Scene Heading', basedOn: 'Normal', next: 'Normal', run: { font: 'Courier Prime', size: 24, bold: true } },
      { id: 'Action', name: 'Action', basedOn: 'Normal', next: 'Normal', run: { font: 'Courier Prime', size: 24 } },
      { id: 'Character', name: 'Character', basedOn: 'Normal', next: 'Normal', run: { font: 'Courier Prime', size: 24 } },
      { id: 'Dialogue', name: 'Dialogue', basedOn: 'Normal', next: 'Normal', run: { font: 'Courier Prime', size: 24 } },
      { id: 'Parenthetical', name: 'Parenthetical', basedOn: 'Normal', next: 'Normal', run: { font: 'Courier Prime', size: 24 } },
      { id: 'Transition', name: 'Transition', basedOn: 'Normal', next: 'Normal', run: { font: 'Courier Prime', size: 24 } },
    ],
  };
  const doc = new Document({
    creator: 'OpenDraft test',
    styles,
    sections: [{
      children: [
        styleParagraph('INT. KITCHEN - MORNING', 'Scene Heading'),
        styleParagraph('Bob fries an egg.', 'Action'),
        styleParagraph('BOB', 'Character'),
        styleParagraph('(squinting)', 'Parenthetical'),
        styleParagraph('Where did I leave the spatula?', 'Dialogue'),
        styleParagraph('FADE OUT.', 'Transition'),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function buildPlainFixture() {
  // No styles, no indents — text patterns only.
  const doc = new Document({
    creator: 'OpenDraft test',
    sections: [{
      children: [
        plainParagraph('INT. PARK - DAY'),
        plainParagraph('A dog chases a frisbee.'),
        plainParagraph('OWNER'),
        plainParagraph('Good boy!'),
        plainParagraph('CUT TO:', { alignment: AlignmentType.RIGHT }),
        plainParagraph('(under his breath)'),
        plainParagraph('Mostly action that does not match patterns.'),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function buildTitlePageFixture() {
  const doc = new Document({
    creator: 'OpenDraft test',
    sections: [
      {
        properties: { titlePage: true },
        children: [
          plainParagraph('THE CIPHER', { alignment: AlignmentType.CENTER, bold: true }),
          plainParagraph('', { alignment: AlignmentType.CENTER }),
          plainParagraph('Written by', { alignment: AlignmentType.CENTER }),
          plainParagraph('Jane Q. Writer', { alignment: AlignmentType.CENTER }),
          new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
          plainParagraph('INT. ROOM - DAY'),
          plainParagraph('Jane writes.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// =============================================================================
// Run tests
// =============================================================================

let failures = 0;
function expect(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

console.log('=== Fixture 1: FD-style indents ===');
{
  const buf = await buildIndentFixture();
  writeFileSync(path.join(outDir, 'import-indent.docx'), buf);
  const r = await parseDocx(buf);
  const expected = ['sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'sceneHeading', 'action'];
  for (let i = 0; i < expected.length; i++) {
    expect(r.types[i] === expected[i], `paragraph ${i}: got "${r.types[i]}", expected "${expected[i]}" — text: ${JSON.stringify(r.paragraphs[i].plainText.slice(0,40))}`);
  }
}

console.log('\n=== Fixture 2: Style names ===');
{
  const buf = await buildStyleFixture();
  writeFileSync(path.join(outDir, 'import-styles.docx'), buf);
  const r = await parseDocx(buf);
  const expected = ['sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition'];
  for (let i = 0; i < expected.length; i++) {
    expect(r.types[i] === expected[i], `paragraph ${i}: got "${r.types[i]}", expected "${expected[i]}" — text: ${JSON.stringify(r.paragraphs[i].plainText.slice(0,40))}`);
  }
}

console.log('\n=== Fixture 3: Text patterns only ===');
{
  const buf = await buildPlainFixture();
  writeFileSync(path.join(outDir, 'import-plain.docx'), buf);
  const r = await parseDocx(buf);
  // The 7th paragraph is genuinely ambiguous — should default to action.
  expect(r.types[0] === 'sceneHeading', `paragraph 0: scene heading detected — got "${r.types[0]}"`);
  expect(r.types[1] === 'action', `paragraph 1: action detected — got "${r.types[1]}"`);
  expect(r.types[2] === 'character', `paragraph 2: ALL-CAPS char cue — got "${r.types[2]}"`);
  expect(r.types[3] === 'dialogue', `paragraph 3: follows char → dialogue — got "${r.types[3]}"`);
  expect(r.types[4] === 'transition', `paragraph 4: right-aligned TO: — got "${r.types[4]}"`);
  expect(r.types[5] === 'parenthetical', `paragraph 5: parens → parenthetical — got "${r.types[5]}"`);
  expect(r.types[6] === 'action', `paragraph 6: defaulted to action — got "${r.types[6]}"`);
}

console.log('\n=== Fixture 4: Title page ===');
{
  const buf = await buildTitlePageFixture();
  writeFileSync(path.join(outDir, 'import-titlepage.docx'), buf);
  const r = await parseDocx(buf);
  expect(r.tp != null, 'title page detected');
  if (r.tp) {
    expect(r.tp.tpTitle === 'THE CIPHER', `tpTitle = "THE CIPHER" — got ${JSON.stringify(r.tp.tpTitle)}`);
    expect(r.tp.tpWrittenBy === 'Jane Q. Writer', `tpWrittenBy = "Jane Q. Writer" — got ${JSON.stringify(r.tp.tpWrittenBy)}`);
  }
  // After consumed title page, scene heading should still classify
  const sceneIdx = r.types.findIndex((t, i) => i >= r.consumed && t === 'sceneHeading');
  expect(sceneIdx >= 0, 'scene heading found after title page');
}

console.log(`\n=== Result: ${failures === 0 ? 'PASS' : `FAIL (${failures} failure${failures === 1 ? '' : 's'})`} ===`);
process.exit(failures === 0 ? 0 : 1);
