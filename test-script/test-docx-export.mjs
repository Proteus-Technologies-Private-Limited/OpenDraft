// Smoke test: build a sample screenplay JSONContent and run docxExporter end-to-end
// outside the browser to verify the package produces a valid .docx file.
//
// Run from project root:
//   node test-script/test-docx-export.mjs
//
// Output is written to test-script/output/test-export.docx (gitignored).
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Header,
  Footer,
  AlignmentType,
  LineRuleType,
  PageNumber,
  TabStopType,
  PageBreak,
} from 'docx';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

// --- Mirror of docxExporter constants & helpers (cannot import .ts from .mjs without compile) ---

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const LINE_HEIGHT_PT = 12;
const FONT_FAMILY = 'Courier Prime';
const FONT_SIZE_HALFPT = 24;

const FD_INDENTS = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50], character: [3.50, 7.50],
  dialogue: [2.50, 6.00], parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50], newAct: [1.50, 7.50],
  endOfAct: [1.50, 7.50], lyrics: [2.50, 6.00], showEpisode: [1.50, 7.50],
  castList: [1.50, 7.50],
};
const SPACE_BEFORE = {
  sceneHeading: 1, action: 1, character: 1, dialogue: 0,
  parenthetical: 0, transition: 1, general: 0, shot: 1,
  newAct: 2, endOfAct: 2, lyrics: 0, showEpisode: 1, castList: 0,
};
const UPPERCASE_TYPES = new Set(['sceneHeading', 'character', 'transition', 'shot', 'newAct', 'endOfAct', 'castList']);
const CENTERED_TYPES = new Set(['newAct', 'endOfAct', 'showEpisode']);
const RIGHT_ALIGNED_TYPES = new Set(['transition']);
const BOLD_TYPES = new Set(['sceneHeading', 'newAct', 'endOfAct', 'showEpisode']);
const ITALIC_TYPES = new Set(['lyrics', 'parenthetical']);
const UNDERLINE_TYPES = new Set(['newAct']);

const layout = {
  pageWidth: 8.5,
  pageHeight: 11,
  topMargin: 90,
  bottomMargin: 62,
  headerMargin: 36,
  footerMargin: 36,
  leftMargin: 1.5,
  rightMargin: 1.0,
  headerContent: { left: '', center: '', right: '{page}.' },
  footerContent: { left: '', center: '', right: '' },
  headerStartPage: 2,
  footerStartPage: 1,
};

function indentForType(typeName) {
  const indents = FD_INDENTS[typeName] || FD_INDENTS.general;
  return {
    left: Math.round((indents[0] - layout.leftMargin) * TWIPS_PER_INCH),
    right: Math.round((layout.pageWidth - layout.rightMargin - indents[1]) * TWIPS_PER_INCH),
  };
}
function alignmentForType(typeName) {
  if (CENTERED_TYPES.has(typeName)) return AlignmentType.CENTER;
  if (RIGHT_ALIGNED_TYPES.has(typeName)) return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}
function applyTypeStyles(runs, typeName) {
  const fb = BOLD_TYPES.has(typeName), fi = ITALIC_TYPES.has(typeName);
  const fu = UNDERLINE_TYPES.has(typeName), fup = UPPERCASE_TYPES.has(typeName);
  return runs.map((r) => ({
    ...r,
    text: fup ? r.text.toUpperCase() : r.text,
    bold: r.bold || fb, italic: r.italic || fi, underline: r.underline || fu,
  }));
}
function buildElementParagraph(node, isFirst) {
  const typeName = node.type || 'general';
  const indent = indentForType(typeName);
  const sb = isFirst ? 0 : (SPACE_BEFORE[typeName] ?? 0) * LINE_HEIGHT_PT;
  const rawRuns = (node.content || [{ text: '' }]).map((c) => {
    let bold = false, italic = false, underline = false;
    for (const m of (c.marks || [])) {
      if (m.type === 'bold') bold = true;
      if (m.type === 'italic') italic = true;
      if (m.type === 'underline') underline = true;
    }
    return { text: c.text || '', bold, italic, underline };
  });
  const styled = applyTypeStyles(rawRuns, typeName);
  return new Paragraph({
    alignment: alignmentForType(typeName),
    indent: { left: indent.left, right: indent.right },
    spacing: {
      before: sb * TWIPS_PER_POINT,
      line: LINE_HEIGHT_PT * TWIPS_PER_POINT,
      lineRule: LineRuleType.EXACT,
    },
    children: styled.length === 0
      ? [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })]
      : styled.map((r) => new TextRun({
          text: r.text,
          font: FONT_FAMILY,
          size: FONT_SIZE_HALFPT,
          bold: r.bold || undefined,
          italics: r.italic || undefined,
          underline: r.underline ? {} : undefined,
        })),
  });
}

// --- Sample screenplay ---
const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'titlePage',
      attrs: {
        field: 'title',
        tpTitle: 'The Cipher',
        tpWrittenBy: 'Jane Q. Writer',
        tpBasedOn: 'Based on a true story',
        tpDraft: 'First Draft',
        tpDraftDate: 'May 5, 2026',
        tpContact: 'Jane Q. Writer\n123 Main St\nNew York, NY 10001\njane@example.com',
        tpCopyright: '© 2026 Jane Q. Writer',
        tpWgaRegistration: 'WGAW #1234567',
      },
    },
    { type: 'sceneHeading', content: [{ text: 'INT. COFFEE SHOP - DAY' }] },
    { type: 'action', content: [{ text: 'A bustling coffee shop. ANNA, 30s, sits at a corner table with her laptop open.' }] },
    { type: 'character', content: [{ text: 'ANNA' }] },
    { type: 'parenthetical', content: [{ text: '(to herself)' }] },
    { type: 'dialogue', content: [{ text: 'Where did I leave that note?' }] },
    { type: 'action', content: [
      { text: 'She rifles through her bag. ' },
      { text: 'Nothing.', marks: [{ type: 'italic' }] },
    ]},
    { type: 'character', content: [{ text: 'BARISTA (O.S.)' }] },
    { type: 'dialogue', content: [{ text: 'You okay over there?' }] },
    { type: 'transition', content: [{ text: 'CUT TO:' }] },
    { type: 'sceneHeading', content: [{ text: 'EXT. STREET - NIGHT' }] },
    { type: 'action', content: [{ text: 'Anna runs through rain-slick streets, ' },
      { text: 'breathless', marks: [{ type: 'bold' }] }, { text: '.' }] },
    { type: 'newAct', content: [{ text: 'Act Two' }] },
    { type: 'lyrics', content: [{ text: 'Hold on, hold on...' }] },
  ],
};

// --- Build document ---
let titlePage = null;
const bodyNodes = [];
for (const node of sampleDoc.content) {
  if (node.type === 'titlePage' && node.attrs?.field === 'title') {
    titlePage = node.attrs;
  } else if (node.type !== 'titlePage') {
    bodyNodes.push(node);
  }
}

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

const contentWidthTw =
  pageWidthTw -
  Math.round(layout.leftMargin * TWIPS_PER_INCH) -
  Math.round(layout.rightMargin * TWIPS_PER_INCH);

const headerPara = new Paragraph({
  tabStops: [
    { type: TabStopType.CENTER, position: Math.round(contentWidthTw / 2) },
    { type: TabStopType.RIGHT, position: contentWidthTw },
  ],
  children: [
    new TextRun({ text: '\t\t', font: FONT_FAMILY, size: FONT_SIZE_HALFPT }),
    new TextRun({ children: [PageNumber.CURRENT], font: FONT_FAMILY, size: FONT_SIZE_HALFPT }),
    new TextRun({ text: '.', font: FONT_FAMILY, size: FONT_SIZE_HALFPT }),
  ],
});

const titleParagraphs = [];
const blank = () => new Paragraph({
  spacing: { line: 240, lineRule: LineRuleType.EXACT },
  children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
});
const center = (text, opts) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { line: 240, lineRule: LineRuleType.EXACT },
  children: [new TextRun({ text, font: FONT_FAMILY, size: FONT_SIZE_HALFPT, bold: opts?.bold || undefined })],
});
for (let i = 0; i < 18; i++) titleParagraphs.push(blank());
titleParagraphs.push(center((titlePage.tpTitle || '').toUpperCase(), { bold: true }));
titleParagraphs.push(blank());
titleParagraphs.push(blank());
titleParagraphs.push(center('Written by'));
titleParagraphs.push(blank());
titleParagraphs.push(center(titlePage.tpWrittenBy));
titleParagraphs.push(new Paragraph({ children: [new PageBreak()] }));

const bodyParagraphs = bodyNodes.map((n, i) => buildElementParagraph(n, i === 0));

const document = new Document({
  creator: 'OpenDraft',
  title: 'The Cipher',
  styles: {
    default: {
      document: {
        run: { font: FONT_FAMILY, size: FONT_SIZE_HALFPT },
        paragraph: { spacing: { line: LINE_HEIGHT_PT * TWIPS_PER_POINT, lineRule: LineRuleType.EXACT } },
      },
    },
  },
  sections: [
    {
      properties: { ...sectionPageProps, titlePage: true },
      children: titleParagraphs,
    },
    {
      properties: sectionPageProps,
      headers: { default: new Header({ children: [headerPara] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [] })] }) },
      children: bodyParagraphs,
    },
  ],
});

const buf = await Packer.toBuffer(document);
const outPath = path.join(outDir, 'test-export.docx');
writeFileSync(outPath, buf);
console.log(`Wrote ${outPath} (${buf.length} bytes)`);

// Sanity check: docx files are zip-based.  First two bytes should be 'PK'.
if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
  console.error('FAIL: output does not start with PK signature');
  process.exit(1);
}
console.log('OK: PK zip signature present.');
