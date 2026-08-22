// PDF exporter using jsPDF — renders screenplay with Final Draft formatting
// All constants match pagination.ts and screenplay.css for exact visual parity
import jsPDF from 'jspdf';
import type { JSONContent } from '@tiptap/react';
import { resolveMoresContds, resolveHeaderFooter, printedPageNumber, resolveHFFields } from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';
import { getForceBreakIds, startsOwnPage } from './pageBreaks';
import { getSpaceBefore } from './elementSpacing';
import { resolveImageUrl, loadImageData } from './imageAsset';
import { jsonBlockRuns } from './nodeText';
import { wordWrapRuns, type WrapRun } from './wrapText';
import { sanitizeExportFilename } from './exportFilename';
import { findTitlePageRegion, titlePageAttrsCarryData } from './titlePageRegion';
import {
  embedUnicodeFont, needsUnicodeFont, requiredUnicodeStyles,
  type StyledText, type UnicodeFont,
} from './pdfUnicodeFont';
import { embedCustomFonts, type EmbeddedFace } from './pdfCustomFonts';
import { genericFor } from './fonts';

// --- Constants matching pagination.ts ---

const LINE_HEIGHT_PT = 12;
const PTS_PER_INCH = 72;
const FD_CPI = 10.33; // Final Draft Courier characters per inch
const FD_CHAR_WIDTH_PT = PTS_PER_INCH / FD_CPI; // ≈6.97pt per character

// Final Draft absolute indents from page edge (inches)
const FD_INDENTS: Record<string, [number, number]> = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50], character: [3.50, 7.50],
  dialogue: [2.50, 6.00], parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50], newAct: [1.50, 7.50],
  endOfAct: [1.50, 7.50], lyrics: [2.50, 6.00], showEpisode: [1.50, 7.50],
  castList: [1.50, 7.50],
};

// Characters per line — matches pagination.ts exactly
const CHARS_PER_LINE: Record<string, number> = {};
for (const [type, [l, r]] of Object.entries(FD_INDENTS)) {
  CHARS_PER_LINE[type] = Math.round((r - l) * FD_CPI);
}

// Space before each element (in lines) now comes from the active formatting
// template via getSpaceBefore() — see utils/elementSpacing.ts, which pagination
// and the DOCX exporter read too.

// Types that render in uppercase (CSS text-transform: uppercase)
const UPPERCASE_TYPES = new Set([
  'sceneHeading', 'character', 'transition', 'shot', 'newAct', 'endOfAct', 'castList',
]);

// Types that are centered (CSS text-align: center)
const CENTERED_TYPES = new Set(['newAct', 'endOfAct', 'showEpisode']);

// Types that are right-aligned (CSS text-align: right)
const RIGHT_ALIGNED_TYPES = new Set(['transition']);

// Types with inherent CSS styles applied by element class
const BOLD_TYPES = new Set(['sceneHeading', 'newAct', 'endOfAct', 'showEpisode']);
const ITALIC_TYPES = new Set(['lyrics']);
const UNDERLINE_TYPES = new Set(['newAct']);

// Dialogue-family types
const DIALOGUE_BLOCK_TYPES = new Set(['dialogue', 'parenthetical', 'lyrics']);

// --- Text run types ---

/**
 * Line breaking lives in utils/wrapText, shared with editor pagination — the
 * two must produce identical line counts or the PDF paginates differently from
 * the editor.
 */
type TextRun = WrapRun;

interface NodeInfo {
  typeName: string;
  runs: TextRun[];
  plainText: string;
  attrs?: Record<string, unknown>;
}

// --- Helpers ---


/** Styled runs for a node, with hard breaks flagged. See utils/nodeText. */
export function extractRuns(node: JSONContent): TextRun[] {
  return jsonBlockRuns(node).map((r) => ({
    text: r.text,
    bold: r.bold,
    italic: r.italic,
    underline: r.underline,
    isBreak: r.isBreak,
    fontFamily: r.fontFamily,
  }));
}

/** Apply type-level CSS styles (bold, italic, underline) to runs */
function applyTypeStyles(runs: TextRun[], typeName: string): TextRun[] {
  const forceBold = BOLD_TYPES.has(typeName);
  const forceItalic = ITALIC_TYPES.has(typeName);
  const forceUnderline = UNDERLINE_TYPES.has(typeName);
  if (!forceBold && !forceItalic && !forceUnderline) return runs;
  return runs.map(r => ({
    ...r,
    bold: r.bold || forceBold,
    italic: r.italic || forceItalic,
    underline: r.underline || forceUnderline,
  }));
}

function getPlainText(runs: TextRun[]): string {
  // A break contributes a newline, matching `leafText` on the editor side, so
  // the plain text this produces agrees with pagination's line counting.
  return runs.map((r) => (r.isBreak ? '\n' : r.text)).join('');
}

/**
 * Which of jsPDF's built-in faces to draw a family in.
 *
 * jsPDF embeds only the PDF Standard 14 — Courier, Times and Helvetica — so an
 * arbitrary family is rendered in the closest of those rather than shipping
 * megabytes of TTFs with the app.  Courier is the important one: a script in
 * any Courier must keep going through the untouched Final Draft path below.
 */
export function pdfFontFor(family: string | undefined): 'courier' | 'times' | 'helvetica' {
  if (!family || !family.trim()) return 'courier';
  switch (genericFor(family)) {
    case 'monospace': return 'courier';
    // A script face has no Standard 14 equivalent at all; Times is the less
    // wrong of the two, being the one with strokes of varying weight.
    case 'serif': case 'cursive': return 'times';
    default: return 'helvetica';
  }
}

/**
 * Everything the exporter needs to know about faces while it draws.
 *
 * `unicode` is the embedded fallback, present only when the script contains
 * text no built-in face can encode — see utils/pdfUnicodeFont.
 */
interface FontContext {
  documentFont?: string;
  /** Character spacing that stretches jsPDF's Courier to the Final Draft cell. */
  courierSpace: number;
  unicode: UnicodeFont | null;
  /**
   * The writer's own installed fonts, whose bytes are in this document — keyed
   * by lowercased family name. Empty when the script uses none.
   */
  embedded: Map<string, EmbeddedFace>;
}

/**
 * The face a piece of text is drawn in.
 *
 * Its own family, or the document's — unless the built-in faces cannot write
 * it, in which case the embedded Unicode face, which can.
 */
function faceFor(text: string, family: string | undefined, fonts: FontContext): string {
  const named = family || fonts.documentFont;
  // An installed font is drawn in itself — it carries its own glyphs, so it
  // needs no Unicode fallback and no Standard 14 approximation.
  if (named && fonts.embedded.size > 0) {
    const own = fonts.embedded.get(named.trim().toLowerCase());
    if (own) return own.id;
  }
  if (fonts.unicode && needsUnicodeFont(text)) return fonts.unicode.id;
  return pdfFontFor(named);
}

/** Whether a face sits on Final Draft's fixed cell — Courier and the fallback do. */
function isFdCell(face: string, fonts: FontContext): boolean {
  return face === 'courier' || face === fonts.unicode?.id;
}

/** The spacing correction that puts a face on the FD cell; none for a proportional one. */
function charSpaceFor(face: string, fonts: FontContext): number {
  if (fonts.unicode && face === fonts.unicode.id) return fonts.unicode.charSpace;
  return face === 'courier' ? fonts.courierSpace : 0;
}

/**
 * Draw one line of page furniture — a (MORE), a CONT'D, a scene number — in
 * the script's own face, or in the fallback when that face cannot write it.
 */
function drawPlain(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  fonts: FontContext,
  opts: { bold?: boolean } = {},
): void {
  const face = selectFace(pdf, text, fonts, opts);
  pdf.text(text, x, y, { charSpace: charSpaceFor(face, fonts) });
}

/** Select the face for a piece of text and hand it back, so callers can space and measure it. */
function selectFace(
  pdf: jsPDF,
  text: string,
  fonts: FontContext,
  opts: { bold?: boolean; italic?: boolean; family?: string } = {},
): string {
  const face = faceFor(text, opts.family, fonts);
  setFontStyle(pdf, !!opts.bold, !!opts.italic, face);
  return face;
}

function setFontStyle(pdf: jsPDF, bold: boolean, italic: boolean, face = 'courier'): void {
  if (bold && italic) {
    pdf.setFont(face, 'bolditalic');
  } else if (bold) {
    pdf.setFont(face, 'bold');
  } else if (italic) {
    pdf.setFont(face, 'italic');
  } else {
    pdf.setFont(face, 'normal');
  }
}

/**
 * How wide a piece of text draws.
 *
 * A monospace face keeps Final Draft's fixed 10.33-CPI cell, which is what
 * every indent, centre and page-break calculation in the app is built on — and
 * the Unicode fallback is monospace precisely so that stays true when a script
 * switches to it.  A proportional face has no such cell, so it is measured — it
 * still sits in the line box the monospace layout assigned, and since Times and
 * Helvetica are narrower than Courier at the same size, it fits inside it.
 */
function widthOf(pdf: jsPDF, text: string, face: string, fonts: FontContext): number {
  if (isFdCell(face, fonts)) return text.length * FD_CHAR_WIDTH_PT;
  return pdf.getTextWidth(text);
}

/**
 * Render a line of TextRun segments at (x, y), using FD Courier character spacing.
 */
function renderLine(
  pdf: jsPDF,
  lineRuns: TextRun[],
  x: number,
  y: number,
  fonts: FontContext,
): void {
  let cursorX = x;
  for (const run of lineRuns) {
    if (run.text.length === 0) continue;
    const face = selectFace(pdf, run.text, fonts, { bold: run.bold, italic: run.italic, family: run.fontFamily });
    // charSpace stretches a monospace face to Final Draft's cell; a
    // proportional one must be drawn at its own advances or the letters come
    // out scattered.
    pdf.text(run.text, cursorX, y, { charSpace: charSpaceFor(face, fonts) });
    const w = widthOf(pdf, run.text, face, fonts);
    if (run.underline) {
      const ulY = y + 1.5;
      pdf.setLineWidth(0.5);
      pdf.line(cursorX, ulY, cursorX + w, ulY);
    }
    cursorX += w;
  }
}

/** Width of a whole line, for centring and right alignment. */
function measureLine(pdf: jsPDF, lineRuns: TextRun[], fonts: FontContext): number {
  let total = 0;
  for (const run of lineRuns) {
    if (run.text.length === 0) continue;
    const face = faceFor(run.text, run.fontFamily, fonts);
    // getTextWidth reads the current font, so it has to be set first.
    if (!isFdCell(face, fonts)) setFontStyle(pdf, run.bold, run.italic, face);
    total += widthOf(pdf, run.text, face, fonts);
  }
  return total;
}

// --- Main export function ---

export interface PDFExportOptions {
  sceneNumbersVisible?: boolean;
  /** Document title for header/footer {title} field */
  documentTitle?: string;
  /** Current revision color for {revision} field */
  revisionColor?: string;
  /**
   * The document's typeface.  Omitted or any Courier keeps the Final Draft
   * Courier output untouched; anything else is what the writer chose, and the
   * script is drawn in the closest face jsPDF embeds.
   */
  documentFont?: string;
}

/** Resolve dynamic field placeholders in header/footer text. Shared with the
 *  editor and the settings preview so all three render a template identically. */
const resolveFields = resolveHFFields;

export async function exportPDF(doc: JSONContent, title: string, layout: PageLayout, options?: PDFExportOptions): Promise<void> {
  const { saveFile } = await import('./fileOps');
  const filename = `${sanitizeExportFilename(title)}.pdf`;

  if (!doc || !doc.content || doc.content.length === 0) {
    const pdf = new jsPDF({
      unit: 'pt',
      format: [layout.pageWidth * PTS_PER_INCH, layout.pageHeight * PTS_PER_INCH],
    });
    await saveFile(new Uint8Array(pdf.output('arraybuffer')), filename, [{ name: 'PDF', extensions: ['pdf'] }]);
    return;
  }

  const pageWidthPt = layout.pageWidth * PTS_PER_INCH;
  const pageHeightPt = layout.pageHeight * PTS_PER_INCH;
  const topMarginPt = layout.topMargin;
  const bottomMarginPt = layout.bottomMargin;
  const usableBottomPt = pageHeightPt - bottomMarginPt;
  // "Mores & Continueds" config for page-break (MORE)/(CONT'D) markers.
  const mc = resolveMoresContds(layout);

  const pdf = new jsPDF({
    unit: 'pt',
    format: [pageWidthPt, pageHeightPt],
  });

  const documentFont = options?.documentFont;
  pdf.setFontSize(12);

  // Character spacing adjustment: make jsPDF Courier match FD Courier (10.33 CPI).
  // Measured on Courier itself, since that is what it is applied to.
  pdf.setFont('courier', 'normal');
  const courierSpace = FD_CHAR_WIDTH_PT - pdf.getTextWidth('M');
  pdf.setFont(pdfFontFor(documentFont), 'normal');

  // Build the body node list, separating the title-page region: the leading run
  // of titlePage + image nodes. The title page renders its nodes in DOCUMENT
  // ORDER (free-flow / WYSIWYG), matching the editor and DOCX.
  const nodes: NodeInfo[] = [];
  interface TitleItem { kind: 'text' | 'image'; field?: string; text?: string; titleSize?: number; font?: string; attrs?: Record<string, unknown>; }
  const titleItems: TitleItem[] = [];

  // Where the title page ends. Shared with the paginator, the DOCX exporter and
  // the Title Page dialog so all four agree even when something stray sits above
  // the title (issue #52) — see utils/titlePageRegion.
  const docNodes = doc.content;
  const region = findTitlePageRegion(
    docNodes.map((node) => ({
      type: node.type || 'general',
      hasText: getPlainText(extractRuns(node)).trim().length > 0,
      hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
    })),
  );
  const hasTitlePage = region.isReal;

  docNodes.forEach((node, index) => {
    const typeName = node.type || 'general';

    if (hasTitlePage && index < region.length) {
      if (typeName === 'screenplayImage') {
        titleItems.push({ kind: 'image', attrs: (node.attrs || {}) as Record<string, unknown> });
      } else {
        const titleRuns = extractRuns(node);
        titleItems.push({
          kind: 'text',
          // A node absorbed into the region that is not a title-page node is a
          // stray blank line; render it as a spacer, never as the title.
          field: typeName === 'titlePage' ? ((node.attrs?.field as string) || 'title') : 'blank',
          text: getPlainText(titleRuns),
          titleSize: Number(node.attrs?.tpTitleFontSize) || 12,
          // The title page is where a display face earns its keep, so the line
          // is drawn in the font its text carries rather than the document's.
          // One font per line: the page is flattened to plain text here, as it
          // has been since it was laid out free-flow.
          font: titleRuns.find((r) => r.text.trim() && r.fontFamily)?.fontFamily,
        });
      }
      return;
    }

    // Nothing worth a title page: the region's nodes are body content after all.
    // Blank title-page spacers are dropped rather than printed as a screenful of
    // empty lines, but anything carrying text is kept — the old code threw the
    // whole region away and lost it.
    if (!hasTitlePage && typeName === 'titlePage' && getPlainText(extractRuns(node)).trim() === '') {
      return;
    }

    const rawRuns = extractRuns(node);
    const runs = applyTypeStyles(rawRuns, typeName);
    nodes.push({
      typeName,
      runs,
      plainText: getPlainText(rawRuns),
      attrs: node.attrs as Record<string, unknown> | undefined,
    });
  });

  // Header and footer text, resolved once the page count is known but written
  // from strings that are already fixed here.
  const hf = resolveHeaderFooter(layout);
  const hContent = hf.headerContent;
  const fContent = hf.footerContent;
  const docTitle = options?.documentTitle || title;
  const revColor = options?.revisionColor || '';

  // Anything the built-in faces cannot encode — Cyrillic, Greek, and the rest —
  // is drawn in an embedded font instead. Which styles of it to embed is known
  // only from the text itself, so every string this export will draw is
  // collected first, with the style it will be drawn in.
  const drawn: StyledText[] = [];
  for (const node of nodes) {
    for (const run of node.runs) drawn.push({ text: run.text, bold: run.bold, italic: run.italic });
    // A dialogue block broken across a page repeats the character name.
    if (node.typeName === 'character') drawn.push({ text: node.plainText });
  }
  for (const it of titleItems) {
    if (it.kind === 'text') drawn.push({ text: it.text || '', bold: it.field === 'title' });
  }
  drawn.push(
    { text: mc.moreText }, { text: mc.contdText },
    { text: docTitle }, { text: revColor }, { text: new Date().toLocaleDateString() },
    ...[hContent, fContent].flatMap((c) => [{ text: c.left }, { text: c.center }, { text: c.right }]),
  );

  // Fonts the writer installed themselves are embedded outright, so a script
  // set in one exports as that font rather than as the nearest built-in.
  const usedFamilies = new Set<string>();
  if (documentFont) usedFamilies.add(documentFont);
  for (const node of nodes) {
    for (const run of node.runs) if (run.fontFamily) usedFamilies.add(run.fontFamily);
  }
  for (const it of titleItems) if (it.font) usedFamilies.add(it.font);

  const fonts: FontContext = {
    documentFont,
    courierSpace,
    unicode: await embedUnicodeFont(pdf, requiredUnicodeStyles(drawn), FD_CHAR_WIDTH_PT),
    embedded: embedCustomFonts(pdf, usedFamilies),
  };

  let currentY = topMarginPt;
  let pageNumber = 1;
  let isFirstElement = true;

  // Pre-load title-page images (rendered in document order).
  const titleImgData = new Map<number, { dataUrl: string; wPt: number; hPt: number }>();
  if (hasTitlePage) {
    const contentW = pageWidthPt - (layout.leftMargin + layout.rightMargin) * PTS_PER_INCH;
    for (let k = 0; k < titleItems.length; k++) {
      const it = titleItems[k];
      if (it.kind !== 'image') continue;
      const url = resolveImageUrl(it.attrs || {});
      if (!url) continue;
      const d = await loadImageData(url);
      if (!d) continue;
      const widthPx = Number(it.attrs?.width) || 0;
      let wPt = widthPx > 0 ? widthPx * 0.75 : Math.min(d.width * 0.75, contentW * 0.6);
      wPt = Math.min(wPt, contentW);
      titleImgData.set(k, { dataUrl: d.dataUrl, wPt, hPt: wPt * (d.height / (d.width || 1)) });
    }
  }

  // Render the title page in document order (free-flow), top-to-bottom.
  if (hasTitlePage) {
    const centerX = pageWidthPt / 2;
    const leftX = layout.leftMargin * PTS_PER_INCH;
    const rightX = pageWidthPt - layout.rightMargin * PTS_PER_INCH;
    const bottom = pageHeightPt - bottomMarginPt;
    let y = topMarginPt;
    let dropped = 0;
    for (let k = 0; k < titleItems.length; k++) {
      const it = titleItems[k];
      if (it.kind === 'image') {
        const im = titleImgData.get(k);
        if (!im || y + im.hPt > bottom) continue;
        const align = (it.attrs?.align as string) || 'center';
        const x = align === 'left' ? leftX : align === 'right' ? rightX - im.wPt : centerX - im.wPt / 2;
        pdf.addImage(im.dataUrl, 'PNG', x, y, im.wPt, im.hPt);
        y += im.hPt + 6;
      } else {
        const isTitle = it.field === 'title';
        const align: 'left' | 'center' | 'right' =
          it.field === 'draft' ? 'left' : (it.field === 'contact' || it.field === 'copyright') ? 'right' : 'center';
        const lineH = isTitle ? (it.titleSize || 12) : LINE_HEIGHT_PT;
        pdf.setFontSize(isTitle ? (it.titleSize || 12) : 12);
        const x = align === 'left' ? leftX : align === 'right' ? rightX : centerX;
        const lines = (it.text || '').split('\n');
        for (const line of lines) {
          const drawnLine = isTitle ? line.toUpperCase() : line;
          // Per line, so a Cyrillic title above a Latin credit each get a face
          // that can write them. jsPDF aligns on its own measurement here, as
          // the title page has always been laid out free-flow rather than on
          // the Final Draft cell.
          selectFace(pdf, drawnLine, fonts, { bold: isTitle, family: it.font });
          if (line && y + lineH <= bottom) {
            pdf.text(drawnLine, x, y + lineH, { align });
          } else if (line) {
            dropped++;
          }
          y += lineH;
        }
        pdf.setFontSize(12);
        // No inter-element gap. The title page is built as a fixed number of
        // 12pt lines (see buildTitlePageBlocks), and an extra 4pt per element
        // added up to a third of a page over ~50 of them — enough that the
        // draft, contact, copyright and notes block ran off the bottom and was
        // silently skipped by the bounds check above (issue #52).
      }
    }
    if (dropped > 0) {
      console.warn(
        `[pdf] ${dropped} title-page line(s) did not fit the page and were not drawn.`,
      );
    }

    // Start the screenplay on a fresh sheet. This is physical page 2 of the
    // file; it is script page 1, and the header/footer pass below numbers it
    // that way so the PDF agrees with the page count in the editor.
    pdf.addPage([pageWidthPt, pageHeightPt]);
    pageNumber = 2;
    currentY = topMarginPt;
  }

  function newPage(): void {
    pdf.addPage([pageWidthPt, pageHeightPt]);
    pageNumber++;
    currentY = topMarginPt;
  }

  // Pre-load inserted images (async) so the render loop below stays synchronous.
  const contentWidthPt = pageWidthPt - (layout.leftMargin + layout.rightMargin) * PTS_PER_INCH;
  const imageMap = new Map<number, { dataUrl: string; wPt: number; hPt: number; align: string }>();
  for (let k = 0; k < nodes.length; k++) {
    if (nodes[k].typeName !== 'screenplayImage') continue;
    const attrs = (nodes[k].attrs || {}) as Record<string, unknown>;
    const url = resolveImageUrl(attrs);
    if (!url) continue;
    const d = await loadImageData(url);
    if (!d) continue;
    const widthPx = Number(attrs.width) || 0;
    let wPt = widthPx > 0 ? widthPx * 0.75 : Math.min(d.width * 0.75, contentWidthPt * 0.9);
    wPt = Math.min(wPt, contentWidthPt);
    const hPt = wPt * (d.height / (d.width || 1));
    imageMap.set(k, { dataUrl: d.dataUrl, wPt, hPt, align: (attrs.align as string) || 'center' });
  }

  // Element ids the active template requires to start a new page (e.g. TV newAct).
  const forceBreakIds = getForceBreakIds();
  // Blank lines before each element, from the same template the editor
  // paginates with — resolved once so the whole document uses one answer.
  const spaceBeforeLines = getSpaceBefore();

  /** True when this node must open a fresh page (template rule or manual flag). */
  function mustStartNewPage(node: NodeInfo): boolean {
    if (isFirstElement || currentY <= topMarginPt) return false;
    return startsOwnPage({ type: node.typeName, attrs: node.attrs }, forceBreakIds);
  }

  // Process each node
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const typeName = node.typeName;
    const forcedBreak = mustStartNewPage(node);

    // Inserted image — place it, paginating if it doesn't fit.
    if (typeName === 'screenplayImage') {
      const img = imageMap.get(i);
      if (img) {
        const sbPt = isFirstElement ? 0 : LINE_HEIGHT_PT;
        if (forcedBreak) {
          newPage();
        } else if (currentY + sbPt + img.hPt > pageHeightPt - bottomMarginPt && currentY > topMarginPt) {
          newPage();
        } else {
          currentY += sbPt;
        }
        const contentLeft = layout.leftMargin * PTS_PER_INCH;
        const contentRight = pageWidthPt - layout.rightMargin * PTS_PER_INCH;
        let x = contentLeft;
        if (img.align === 'center') x = (contentLeft + contentRight) / 2 - img.wPt / 2;
        else if (img.align === 'right') x = contentRight - img.wPt;
        pdf.addImage(img.dataUrl, 'PNG', x, currentY, img.wPt, img.hPt);
        currentY += img.hPt;
        isFirstElement = false;
      }
      i++;
      continue;
    }
    const indents = FD_INDENTS[typeName] || FD_INDENTS.general;
    const leftPt = indents[0] * PTS_PER_INCH;
    const rightPt = indents[1] * PTS_PER_INCH;
    const maxChars = CHARS_PER_LINE[typeName] || 62;
    const forceUpper = UPPERCASE_TYPES.has(typeName);

    const spaceBefore = isFirstElement ? 0 : (spaceBeforeLines[typeName] ?? 0);
    const spaceBeforePt = spaceBefore * LINE_HEIGHT_PT;

    const wrappedLines = wordWrapRuns(node.runs, maxChars, forceUpper);
    const elementHeightPt = wrappedLines.length * LINE_HEIGHT_PT;
    const totalHeightPt = spaceBeforePt + elementHeightPt;

    // Check if this is a character node starting a dialogue block
    let isDialogueBlock = false;
    let dialogueBlockNodes: number[] = [];
    let dialogueBlockHeight = totalHeightPt;

    if (typeName === 'character') {
      isDialogueBlock = true;
      dialogueBlockNodes = [i];
      let j = i + 1;
      // Never absorb an element that opens its own page — it has to be laid out
      // separately so its forced break is honoured.
      while (j < nodes.length && DIALOGUE_BLOCK_TYPES.has(nodes[j].typeName)
             && !startsOwnPage({ type: nodes[j].typeName, attrs: nodes[j].attrs }, forceBreakIds)) {
        const dNode = nodes[j];
        const dMaxChars = CHARS_PER_LINE[dNode.typeName] || 36;
        const dSb = (spaceBeforeLines[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
        const dLines = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));
        dialogueBlockHeight += dSb + dLines.length * LINE_HEIGHT_PT;
        dialogueBlockNodes.push(j);
        j++;
      }
    }

    // Scene heading: try to keep with the next element
    let keepWithNext = false;
    let nextElementHeight = 0;
    if (typeName === 'sceneHeading' && i + 1 < nodes.length
        && !startsOwnPage({ type: nodes[i + 1].typeName, attrs: nodes[i + 1].attrs }, forceBreakIds)) {
      keepWithNext = true;
      const nNode = nodes[i + 1];
      const nMaxChars = CHARS_PER_LINE[nNode.typeName] || 62;
      const nSb = (spaceBeforeLines[nNode.typeName] ?? 0) * LINE_HEIGHT_PT;
      const nLines = wordWrapRuns(nNode.runs, nMaxChars, UPPERCASE_TYPES.has(nNode.typeName));
      nextElementHeight = nSb + nLines.length * LINE_HEIGHT_PT;
    }

    // Determine if we need a page break
    const projectedY = currentY + spaceBeforePt + elementHeightPt;

    if (forcedBreak) {
      // Template rule or manual "start on new page" flag — unconditional break.
      newPage();
    } else if (isDialogueBlock && currentY + dialogueBlockHeight > usableBottomPt && currentY > topMarginPt + LINE_HEIGHT_PT) {
      // Try to split dialogue block across pages
      const remaining = usableBottomPt - currentY;

      // Can we fit at least the character name + 2 lines of dialogue?
      const charHeight = spaceBeforePt + elementHeightPt;
      const MIN_DIALOGUE_LINES = 2;
      const minSplitHeight = charHeight + MIN_DIALOGUE_LINES * LINE_HEIGHT_PT;

      if (remaining >= minSplitHeight) {
        // Render character name
        currentY += spaceBeforePt;
        renderElement(pdf, wrappedLines, leftPt, rightPt, currentY, typeName, fonts);
        currentY += elementHeightPt;
        isFirstElement = false;

        // Render as many dialogue/parenthetical nodes as fit
        let dIdx = 1;

        while (dIdx < dialogueBlockNodes.length) {
          const dNodeIdx = dialogueBlockNodes[dIdx];
          const dNode = nodes[dNodeIdx];
          const dIndents = FD_INDENTS[dNode.typeName] || FD_INDENTS.general;
          const dLeftPt = dIndents[0] * PTS_PER_INCH;
          const dRightPt = dIndents[1] * PTS_PER_INCH;
          const dMaxChars = CHARS_PER_LINE[dNode.typeName] || 36;
          const dSb = (spaceBeforeLines[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
          const dWrapped = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));
          const dHeight = dSb + dWrapped.length * LINE_HEIGHT_PT;

          if (currentY + dHeight > usableBottomPt) {
            break;
          }

          currentY += dSb;
          renderElement(pdf, dWrapped, dLeftPt, dRightPt, currentY, dNode.typeName, fonts);
          currentY += dWrapped.length * LINE_HEIGHT_PT;
          dIdx++;
        }

        // Check if we still have dialogue nodes to render on next page
        if (dIdx < dialogueBlockNodes.length) {
          // Render (MORE) indicator
          const moreIndents = FD_INDENTS.character || FD_INDENTS.general;
          const moreLeftPt = moreIndents[0] * PTS_PER_INCH;
          if (mc.dialogueBreakContd && currentY + LINE_HEIGHT_PT <= usableBottomPt) {
            drawPlain(pdf, mc.moreText, moreLeftPt, currentY + LINE_HEIGHT_PT, fonts);
          }

          newPage();

          // Render CONT'D character name
          const charName = node.plainText.trim().toUpperCase();
          const contdIndents = FD_INDENTS.character || FD_INDENTS.general;
          const contdLeftPt = contdIndents[0] * PTS_PER_INCH;
          if (mc.dialogueBreakContd) {
            drawPlain(pdf, `${charName} ${mc.contdText}`, contdLeftPt, currentY + LINE_HEIGHT_PT, fonts);
            currentY += LINE_HEIGHT_PT;
          }

          // Render remaining dialogue nodes
          while (dIdx < dialogueBlockNodes.length) {
            const dNodeIdx = dialogueBlockNodes[dIdx];
            const dNode = nodes[dNodeIdx];
            const dIndents = FD_INDENTS[dNode.typeName] || FD_INDENTS.general;
            const dLeftPt = dIndents[0] * PTS_PER_INCH;
            const dRightPt = dIndents[1] * PTS_PER_INCH;
            const dMaxChars = CHARS_PER_LINE[dNode.typeName] || 36;
            const dSb = (spaceBeforeLines[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
            const dWrapped = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));
            const dHeight = dSb + dWrapped.length * LINE_HEIGHT_PT;

            // Check for another page break within continued dialogue
            if (currentY + dHeight > usableBottomPt) {
              if (mc.dialogueBreakContd && currentY + LINE_HEIGHT_PT <= usableBottomPt) {
                drawPlain(pdf, mc.moreText, contdLeftPt, currentY + LINE_HEIGHT_PT, fonts);
              }
              newPage();
              if (mc.dialogueBreakContd) {
                drawPlain(pdf, `${charName} ${mc.contdText}`, contdLeftPt, currentY + LINE_HEIGHT_PT, fonts);
                currentY += LINE_HEIGHT_PT;
              }
            }

            currentY += dSb;
            renderElement(pdf, dWrapped, dLeftPt, dRightPt, currentY, dNode.typeName, fonts);
            currentY += dWrapped.length * LINE_HEIGHT_PT;
            dIdx++;
          }
        }

        // Skip past all dialogue block nodes
        i = dialogueBlockNodes[dialogueBlockNodes.length - 1] + 1;
        continue;
      } else {
        // Not enough room to split — push entire block to next page
        newPage();
      }
    } else if (keepWithNext && projectedY + nextElementHeight > usableBottomPt && currentY > topMarginPt + LINE_HEIGHT_PT) {
      // Scene heading won't fit with at least its next element — push to next page
      newPage();
    } else if (projectedY > usableBottomPt && currentY > topMarginPt + LINE_HEIGHT_PT) {
      // Regular page break
      newPage();
    }

    // Apply space before. An element that was forced onto its own page sits at
    // the very top of it — matching the editor, which drops the space-before of
    // any element pushed to a new page.
    if (!isFirstElement && !forcedBreak) {
      currentY += spaceBeforePt;
    }

    // Render the element
    renderElement(pdf, wrappedLines, leftPt, rightPt, currentY, typeName, fonts);

    // Render scene numbers on both sides if enabled
    if (typeName === 'sceneHeading' && options?.sceneNumbersVisible && node.attrs?.sceneNumber) {
      const sceneNum = String(node.attrs.sceneNumber);
      const y = currentY + LINE_HEIGHT_PT; // baseline of first line
      pdf.setFontSize(12);
      const numFace = selectFace(pdf, sceneNum, fonts, { bold: true }); // bold like scene heading
      // Left side: just inside left margin
      const leftNumX = 1.0 * PTS_PER_INCH;
      drawPlain(pdf, sceneNum, leftNumX, y, fonts, { bold: true });
      // Right side: near right margin, right-aligned
      const rightNumX = 7.75 * PTS_PER_INCH - widthOf(pdf, sceneNum, numFace, fonts);
      drawPlain(pdf, sceneNum, rightNumX, y, fonts, { bold: true });
    }

    currentY += elementHeightPt;
    isFirstElement = false;

    // If this is a dialogue block, render the rest of the block
    if (isDialogueBlock && dialogueBlockNodes.length > 1) {
      for (let dIdx = 1; dIdx < dialogueBlockNodes.length; dIdx++) {
        const dNodeIdx = dialogueBlockNodes[dIdx];
        const dNode = nodes[dNodeIdx];
        const dIndents = FD_INDENTS[dNode.typeName] || FD_INDENTS.general;
        const dLeftPt = dIndents[0] * PTS_PER_INCH;
        const dRightPt = dIndents[1] * PTS_PER_INCH;
        const dMaxChars = CHARS_PER_LINE[dNode.typeName] || 36;
        const dSb = (spaceBeforeLines[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
        const dWrapped = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));

        currentY += dSb;
        renderElement(pdf, dWrapped, dLeftPt, dRightPt, currentY, dNode.typeName, fonts);
        currentY += dWrapped.length * LINE_HEIGHT_PT;
      }
      i = dialogueBlockNodes[dialogueBlockNodes.length - 1] + 1;
      continue;
    }

    i++;
  }

  // Final pass: render headers and footers on all pages (now that totalPages is known)
  //
  // A title page is not a script page. It carries no number and does not count
  // towards `{pages}`, which is how the editor's page count and every other
  // exporter treat it — but this loop used the physical sheet index for both,
  // so a script with a title page printed "2." on its own first page and
  // reported one page more than the editor did.
  const titleSheets = hasTitlePage ? 1 : 0;
  const totalSheets = pageNumber;
  const scriptPages = Math.max(1, totalSheets - titleSheets);
  // Printed numbers, not sheet indices: the starting-number offset shifts every
  // page, so `{pages}` has to be the number on the LAST page for "{page} of
  // {pages}" to stay coherent.
  const totalPages = printedPageNumber(scriptPages, hf.startingPageNumber);
  const hStart = hf.headerStartPage;
  const fStart = hf.footerStartPage;

  for (let sheet = 1; sheet <= totalSheets; sheet++) {
    if (sheet <= titleSheets) continue; // the title page is never numbered
    const p = printedPageNumber(sheet - titleSheets, hf.startingPageNumber);
    pdf.setPage(sheet);
    // Header
    if (p >= hStart && (hContent.left || hContent.center || hContent.right)) {
      const headerY = layout.headerMargin + 12;
      renderHFLine(pdf, hContent, p, totalPages, docTitle, revColor, headerY, layout, fonts);
    }
    // Footer
    if (p >= fStart && (fContent.left || fContent.center || fContent.right)) {
      const footerY = pageHeightPt - layout.footerMargin;
      renderHFLine(pdf, fContent, p, totalPages, docTitle, revColor, footerY, layout, fonts);
    }
  }

  await saveFile(new Uint8Array(pdf.output('arraybuffer')), filename, [{ name: 'PDF', extensions: ['pdf'] }]);
}

// --- Render helpers ---

/** Render a three-part header or footer line (left, center, right) */
function renderHFLine(
  pdf: jsPDF,
  content: HeaderFooterContent,
  pageNum: number,
  totalPages: number,
  title: string,
  revisionColor: string,
  y: number,
  layout: PageLayout,
  fonts: FontContext,
): void {
  const leftMarginPt = layout.leftMargin * PTS_PER_INCH;
  const rightMarginPt = (layout.pageWidth - layout.rightMargin) * PTS_PER_INCH;
  const centerPt = (leftMarginPt + rightMarginPt) / 2;

  // Page furniture is set in the script's own face, as Final Draft does — or
  // in the fallback, when a Cyrillic title reaches the header.
  pdf.setFontSize(12);

  // Left
  const leftText = resolveFields(content.left, pageNum, totalPages, title, revisionColor);
  if (leftText) {
    drawPlain(pdf, leftText, leftMarginPt, y, fonts);
  }

  // Center
  const centerText = resolveFields(content.center, pageNum, totalPages, title, revisionColor);
  if (centerText) {
    const face = selectFace(pdf, centerText, fonts);
    drawPlain(pdf, centerText, centerPt - widthOf(pdf, centerText, face, fonts) / 2, y, fonts);
  }

  // Right
  const rightText = resolveFields(content.right, pageNum, totalPages, title, revisionColor);
  if (rightText) {
    const face = selectFace(pdf, rightText, fonts);
    drawPlain(pdf, rightText, rightMarginPt - widthOf(pdf, rightText, face, fonts), y, fonts);
  }
}


function renderElement(
  pdf: jsPDF,
  wrappedLines: TextRun[][],
  leftPt: number,
  rightPt: number,
  startY: number,
  typeName: string,
  fonts: FontContext,
): void {
  const isCentered = CENTERED_TYPES.has(typeName);
  const isRightAligned = RIGHT_ALIGNED_TYPES.has(typeName);
  const maxWidthPt = rightPt - leftPt;

  for (let lineIdx = 0; lineIdx < wrappedLines.length; lineIdx++) {
    const lineRuns = wrappedLines[lineIdx];
    const y = startY + (lineIdx + 1) * LINE_HEIGHT_PT; // +1 because jsPDF text baseline

    if (isCentered) {
      const totalWidth = measureLine(pdf, lineRuns, fonts);
      const centerX = leftPt + (maxWidthPt - totalWidth) / 2;
      renderLine(pdf, lineRuns, centerX, y, fonts);
    } else if (isRightAligned) {
      const totalWidth = measureLine(pdf, lineRuns, fonts);
      const rightX = rightPt - totalWidth;
      renderLine(pdf, lineRuns, rightX, y, fonts);
    } else {
      renderLine(pdf, lineRuns, leftPt, y, fonts);
    }
  }
}

// Convenience download function matching the pattern of other exporters
export async function downloadPDF(doc: JSONContent, title: string, layout: PageLayout, options?: PDFExportOptions): Promise<void> {
  await exportPDF(doc, title, layout, options);
}
