// PDF exporter using jsPDF — renders screenplay with Final Draft formatting
// All constants match pagination.ts and screenplay.css for exact visual parity
import jsPDF from 'jspdf';
import type { JSONContent } from '@tiptap/react';
import { resolveMoresContds, resolveHeaderFooter, printedPageNumber, resolveHFFields } from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';
import { getForceBreakIds, startsOwnPage, elementIdOf, laysItselfOut } from './pageBreaks';
import { getSpaceBefore } from './elementSpacing';
import { resolveImageUrl, loadImageData } from './imageAsset';
import { jsonBlockRuns } from './nodeText';
import { wordWrapRuns, type WrapRun } from './wrapText';
import { sanitizeExportFilename } from './exportFilename';
import { findTitlePageRegion, titlePageAttrsCarryData } from './titlePageRegion';
import { extractAvBodies } from './avDocument';
import { drawAvBody, avRowNodes, avFrameKey } from './avPdfTable';
import { readColumnConfig } from '../editor/extensions/AvBlock';
import {
  embedUnicodeFonts, requiredUnicodeFaces, segmentByFace,
  type StyledText, type UnicodeFallbacks,
} from './pdfUnicodeFont';
import { embedCustomFonts, type EmbeddedFace } from './pdfCustomFonts';
import { genericFor } from './fonts';
import { isNonPrintingType } from './nonPrinting';
import {
  dualChildBounds, dualCharsPerLine, dualColumnLeadLines, dualDialogueLineCount,
  type DualColumns,
} from './dualDialogue';
import {
  applyFootnoteMarkers,
  buildEndnotePages,
  packFootnotePage,
  FOOTNOTE_CPL,
  ENDNOTE_HEADING_LINES,
  type FootnoteEntry,
  type FootnotePlan,
  type NoteSlice,
} from './footnotes';
import { noteEntryLabel } from './noteNumbering';
import { noteBlockText } from './noteContent';

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
  /** The original JSON node, kept only for `avBlock`: an AV body is a table,
   *  so the draw pass needs its rows and cells, not a flattened run list. */
  raw?: JSONContent;
  /** Index in the ORIGINAL document content. `nodes` drops the title page and
   *  the non-printing blocks, and the footnote plan is keyed on the original. */
  srcIndex: number;
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

/**
 * Every string a block holds, however deeply it is nested, with the style it
 * will be drawn in.
 *
 * An AV body and a dual-dialogue block keep `runs` empty — a table and two
 * columns cannot be flattened into one line of text, so each gets a draw pass
 * of its own further down. Their text still has to be declared, or a face that
 * can write it is never embedded and a Hindi AV script or a Cyrillic
 * simultaneous speech comes out of the exporter blank.
 */
function collectNestedText(node: JSONContent, out: StyledText[]): void {
  const content = node.content ?? [];
  if (content.some((child) => child.type === 'text')) {
    const runs = applyTypeStyles(extractRuns(node), String(node.type ?? ''));
    for (const run of runs) out.push({ text: run.text, bold: run.bold, italic: run.italic });
  }
  for (const child of content) {
    if (child.type !== 'text') collectNestedText(child, out);
  }
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
 * `fallbacks` are the embedded fonts, present only when the script contains
 * text no built-in face can encode — see utils/pdfUnicodeFont.
 */
interface FontContext {
  documentFont?: string;
  /** Character spacing that stretches jsPDF's Courier to the Final Draft cell. */
  courierSpace: number;
  fallbacks: UnicodeFallbacks;
  /**
   * The writer's own installed fonts, whose bytes are in this document — keyed
   * by lowercased family name. Empty when the script uses none.
   */
  embedded: Map<string, EmbeddedFace>;
}

/**
 * A piece of a run, resolved down to the face that draws it and how it is
 * spaced and measured there.
 */
interface DrawnPiece {
  /** The text as the face needs it ordered — see utils/devanagari. */
  text: string;
  face: string;
  charSpace: number;
  /** Whether its width is the character count on Final Draft's cell. */
  fdCell: boolean;
}

/**
 * The run's own face: its family, or the document's, or the nearest built-in.
 *
 * An installed font is drawn in itself — it carries its own glyphs, so it needs
 * no Unicode fallback and no Standard 14 approximation.
 */
function baseFaceFor(family: string | undefined, fonts: FontContext): string {
  const named = family || fonts.documentFont;
  if (named && fonts.embedded.size > 0) {
    const own = fonts.embedded.get(named.trim().toLowerCase());
    if (own) return own.id;
  }
  return pdfFontFor(named);
}

/** Whether the run's own face is one of the writer's, which draws the lot itself. */
function isOwnFont(family: string | undefined, fonts: FontContext): boolean {
  const named = family || fonts.documentFont;
  return !!named && fonts.embedded.has(named.trim().toLowerCase());
}

/**
 * Break a piece of text into the faces that have to draw it.
 *
 * Usually one piece: a Latin script, or one of the writer's own fonts, which is
 * left to write whatever it carries. A script the built-in faces cannot encode
 * is split by the bundled font each part needs, so a Latin word inside a Hindi
 * line stays on Courier's cell rather than being pulled into a proportional
 * face with it.
 */
function drawnPieces(
  text: string,
  family: string | undefined,
  fonts: FontContext,
  opts: { freeFlow?: boolean } = {},
): DrawnPiece[] {
  const base = baseFaceFor(family, fonts);
  const asBase = (s: string): DrawnPiece => ({
    text: s,
    face: base,
    charSpace: base === 'courier' ? fonts.courierSpace : 0,
    fdCell: base === 'courier',
  });

  const pieces = isOwnFont(family, fonts)
    ? [asBase(text)]
    : segmentByFace(text, fonts.fallbacks).map((segment): DrawnPiece => (segment.fallback
      ? {
        text: segment.fallback.shape(segment.text),
        face: segment.fallback.id,
        charSpace: segment.fallback.charSpace,
        fdCell: segment.fallback.monospace,
      }
      : asBase(segment.text)));

  // The title page is laid out free-flow rather than on the Final Draft cell,
  // and has been since it was written: nothing there is stretched to the cell
  // and nothing is measured by character count.
  if (opts.freeFlow) return pieces.map((piece) => ({ ...piece, charSpace: 0, fdCell: false }));
  return pieces;
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
  drawPieces(pdf, drawnPieces(text, undefined, fonts), x, y, !!opts.bold, false);
}

/** How wide a piece of furniture draws, across every face it needs. */
function measurePlain(
  pdf: jsPDF,
  text: string,
  fonts: FontContext,
  opts: { bold?: boolean } = {},
): number {
  return measurePieces(pdf, drawnPieces(text, undefined, fonts), !!opts.bold, false);
}

/**
 * Draw the pieces of one run, left to right, and return where the cursor
 * ended up.
 */
function drawPieces(
  pdf: jsPDF,
  pieces: DrawnPiece[],
  x: number,
  y: number,
  bold: boolean,
  italic: boolean,
): number {
  let cursorX = x;
  for (const piece of pieces) {
    if (piece.text.length === 0) continue;
    setFontStyle(pdf, bold, italic, piece.face);
    // charSpace stretches a monospace face to Final Draft's cell; a
    // proportional one must be drawn at its own advances or the letters come
    // out scattered.
    pdf.text(piece.text, cursorX, y, { charSpace: piece.charSpace });
    cursorX += pieceWidth(pdf, piece);
  }
  return cursorX;
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
 * the DejaVu fallback is monospace precisely so that stays true when a script
 * switches to it.  A proportional face has no such cell, so it is measured — it
 * still sits in the line box the monospace layout assigned, and since Times,
 * Helvetica and Noto Sans Devanagari are all narrower than Courier at the same
 * size, it fits inside it.
 *
 * `getTextWidth` reads whatever face is currently set, so a measured piece has
 * to have its own selected first.
 */
function pieceWidth(pdf: jsPDF, piece: DrawnPiece): number {
  if (piece.fdCell) return piece.text.length * FD_CHAR_WIDTH_PT;
  return pdf.getTextWidth(piece.text);
}

/** Total width of a run's pieces, selecting each face it has to measure. */
function measurePieces(pdf: jsPDF, pieces: DrawnPiece[], bold: boolean, italic: boolean): number {
  let total = 0;
  for (const piece of pieces) {
    if (piece.text.length === 0) continue;
    if (!piece.fdCell) setFontStyle(pdf, bold, italic, piece.face);
    total += pieceWidth(pdf, piece);
  }
  return total;
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
    const pieces = drawnPieces(run.text, run.fontFamily, fonts);
    const nextX = drawPieces(pdf, pieces, cursorX, y, run.bold, run.italic);
    if (run.underline) {
      const ulY = y + 1.5;
      pdf.setLineWidth(0.5);
      pdf.line(cursorX, ulY, nextX, ulY);
    }
    cursorX = nextX;
    if (run.marker) {
      // Raised, small, and advancing nothing: it overhangs into the space that
      // follows, which is what the editor's marker decoration does and what
      // keeps this line the same length in both. See utils/footnotes.
      pdf.setFontSize(8);
      drawPieces(pdf, drawnPieces(run.marker, undefined, fonts), cursorX, y - 3.5, false, false);
      pdf.setFontSize(12);
    }
  }
}

/** Width of a whole line, for centring and right alignment. */
function measureLine(pdf: jsPDF, lineRuns: TextRun[], fonts: FontContext): number {
  let total = 0;
  for (const run of lineRuns) {
    if (run.text.length === 0) continue;
    total += measurePieces(pdf, drawnPieces(run.text, run.fontFamily, fonts), run.bold, run.italic);
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
  /**
   * Printing script notes. Absent — the usual case — and this exporter is
   * byte-for-byte what it was before footnotes existed.
   */
  footnotes?: FootnotePlan | null;
  /**
   * Whether the title page is drawn at all. Absent or true keeps it.
   *
   * The writer's own preference, not the document's: rendered output — this,
   * print and DOCX — honours it, while the interchange formats (FDX, Fountain,
   * Fade In/OSF and .odraft) always carry the title-page data whatever it says.
   * Sending a script to a producer who wants the pages and nothing else should
   * not edit the script (issue #98).
   */
  includeTitlePage?: boolean;
}

/** Resolve dynamic field placeholders in header/footer text. Shared with the
 *  editor and the settings preview so all three render a template identically. */
const resolveFields = resolveHFFields;

/** A rendered PDF: the bytes, and what to call the file they belong in. */
export interface RenderedPDF {
  bytes: Uint8Array;
  filename: string;
}

/**
 * Lay the script out as a PDF and hand back the bytes.
 *
 * Split out from exportPDF because the file is no longer only ever destined
 * for disk: on iOS and Android it is also what File → Print sends to the
 * system printer (issues #97, and Android's silent Print), and those want the
 * bytes rather than a save dialog. Everything about the document itself —
 * pagination, fonts, headers, footnotes — lives here, so print and export can
 * never drift apart.
 */
export async function renderPDF(doc: JSONContent, title: string, layout: PageLayout, options?: PDFExportOptions): Promise<RenderedPDF> {
  const filename = `${sanitizeExportFilename(title)}.pdf`;

  if (!doc || !doc.content || doc.content.length === 0) {
    const pdf = new jsPDF({
      unit: 'pt',
      format: [layout.pageWidth * PTS_PER_INCH, layout.pageHeight * PTS_PER_INCH],
    });
    return { bytes: new Uint8Array(pdf.output('arraybuffer')), filename };
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

  // Printing notes reach a file only when the writer asked them to. One flag,
  // read from the same resolver the editor reads, so turning it off restores
  // exactly today's output.
  const plan = options?.footnotes && options.footnotes.settings.includeInExports
    ? options.footnotes
    : null;

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
  // Excluding the title page has to drop the region outright. It cannot lean on
  // the `!hasTitlePage` path below: that one exists for a region that was never
  // a title page in the first place, so it keeps whatever carries text as body
  // content — which here would print the title as the first line of page 1.
  const excludeTitlePage = options?.includeTitlePage === false;
  const hasTitlePage = region.isReal && !excludeTitlePage;
  const dropTitleRegion = region.isReal && excludeTitlePage;

  docNodes.forEach((node, index) => {
    const typeName = node.type || 'general';

    if (dropTitleRegion && index < region.length) return;

    // Fountain's Sections and Notes are outline, not script. The spec is
    // explicit that they stay in the file and off the printed page, and
    // pagination already counts them as nothing — so the PDF must not draw
    // them, or the file would run longer than the page count on screen.
    if (isNonPrintingType(typeName)) return;

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

    // An AV body is a table and cannot be flattened into a run list — it gets
    // its own draw pass below, which needs the node itself. Dual dialogue is
    // two columns and cannot either: flattening it asked `jsonBlockRuns` for
    // the text of a node whose children are columns, which is none, so the
    // block came out of the exporter empty and the speeches were simply
    // missing from the PDF.
    if (typeName === 'avBlock' || typeName === 'dualDialogue') {
      nodes.push({ typeName, runs: [], plainText: '', attrs: node.attrs as Record<string, unknown> | undefined, raw: node, srcIndex: index });
      return;
    }

    const rawRuns = extractRuns(node);
    const styled = applyTypeStyles(rawRuns, typeName);
    // References anchored in this block. A superscript rides beside the text
    // and advances nothing; a bracketed one is spliced in as real characters,
    // padded to the width the editor reserved — see utils/footnotes.
    const refs = plan?.refsByNode.get(index);
    const runs = refs && refs.length > 0
      ? applyFootnoteMarkers(styled, refs, plan!.settings.markerStyle, plan!.markerWidth)
      : styled;
    nodes.push({
      typeName,
      runs,
      plainText: getPlainText(rawRuns),
      attrs: node.attrs as Record<string, unknown> | undefined,
      srcIndex: index,
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
    // A block that draws itself carries its text below the run list.
    if (node.raw) collectNestedText(node.raw, drawn);
  }
  for (const it of titleItems) {
    if (it.kind === 'text') drawn.push({ text: it.text || '', bold: it.field === 'title' });
  }
  if (plan) {
    // Every string this export will draw has to be declared here or a face
    // that cannot encode it is never embedded — the dagger and the section
    // sign in the symbol format are outside Latin-1, and so is most citation
    // text that is not English.
    for (const ref of plan.refs) drawn.push({ text: ref.label });
    for (const entry of plan.entries) {
      drawn.push({ text: entry.entryLabel });
      for (const b of entry.blocks) drawn.push({ text: noteBlockText(b) });
    }
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
    fallbacks: await embedUnicodeFonts(pdf, requiredUnicodeFaces(drawn), FD_CHAR_WIDTH_PT),
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
          // that can write them — and a line that needs two faces is drawn and
          // aligned piece by piece, since jsPDF's own `align` can only measure
          // one. Measured widths, free-flow: the same numbers jsPDF's `align`
          // was reaching for when this drew every line in a single face.
          if (line && y + lineH <= bottom) {
            const pieces = drawnPieces(drawnLine, it.font, fonts, { freeFlow: true });
            const w = measurePieces(pdf, pieces, isTitle, false);
            const startX = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
            drawPieces(pdf, pieces, startX, y + lineH, isTitle, false);
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

  // Footnotes owed by the page being laid out, and any lines carried in from
  // the page before. The usable bottom moves up to make room for them, so the
  // reserve is taken from the same place the editor takes it — the content
  // area — and the two page counts stay equal.
  const drawFootnotes = !!plan;
  let pageEntries: FootnoteEntry[] = [];
  /** Parts of a note still to be drawn, continuing onto the next page. */
  let pendingSlices: NoteSlice[] = [];
  const linesPerPage = Math.floor((pageHeightPt - topMarginPt - bottomMarginPt) / LINE_HEIGHT_PT);

  function reserveLines(): number {
    if (!drawFootnotes) return 0;
    return packFootnotePage(pendingSlices, pageEntries, linesPerPage).reserve;
  }

  /** Where the script has to stop on this page. */
  function bottomPt(): number {
    return usableBottomPt - reserveLines() * LINE_HEIGHT_PT;
  }

  /**
   * Every line a note occupies, so a slice of it can be drawn on its own.
   * The label opens the first line, exactly as `footnoteEntryLines` measured it.
   */
  function noteLines(entry: FootnoteEntry, label: string | null): TextRun[][] {
    const out: TextRun[][] = [];
    const wrap = (text: string, bold = false) => {
      for (const line of wordWrapRuns(
        [{ text, bold, italic: false, underline: false }], FOOTNOTE_CPL, false,
      )) out.push(line as TextRun[]);
    };
    let first = true;
    if (entry.title) {
      wrap(label ? `${label} ${entry.title}` : entry.title, true);
      first = false;
    }
    for (const b of entry.blocks) {
      if (b.kind === 'image') continue; // measured by height, not drawn here
      const text = noteBlockText(b);
      wrap(label && first ? `${label} ${text}` : text);
      first = false;
    }
    if (out.length === 0 && label) wrap(label);
    return out;
  }

  /**
   * Draw this page's footnotes, bottom-aligned on the content area's edge.
   *
   * Only this page's share of each note is drawn — a note longer than the room
   * the page can spare continues at the foot of the next one, which is both
   * what Word does and what stops it overflowing into the script.
   */
  function flushFootnotes(): void {
    if (!drawFootnotes) return;
    const fill = packFootnotePage(pendingSlices, pageEntries, linesPerPage);
    pendingSlices = fill.pending;
    pageEntries = [];
    if (fill.reserve === 0) return;

    const leftPt = FD_INDENTS.action[0] * PTS_PER_INCH;
    let y = usableBottomPt - (fill.reserve - 1) * LINE_HEIGHT_PT;

    // A blank line, then Word's short rule — drawn on a continuation page too.
    const ruleY = y - LINE_HEIGHT_PT * 0.4;
    pdf.setLineWidth(0.5);
    pdf.line(leftPt, ruleY, leftPt + 2 * PTS_PER_INCH, ruleY);
    y += LINE_HEIGHT_PT;

    for (const slice of fill.slices) {
      const entry = plan!.entryById.get(slice.noteId);
      if (!entry) continue;
      const label = !slice.isStart
        ? null
        : plan!.settings.numbering === 'restartEachPage'
          ? noteEntryLabel(plan!.settings.startAt + Math.max(0, fill.slices.indexOf(slice)), plan!.settings.numberFormat)
          : entry.entryLabel;
      const lines = noteLines(entry, label);
      for (const line of lines.slice(slice.fromLine, slice.fromLine + slice.lines)) {
        renderLine(pdf, line, leftPt, y, fonts);
        y += LINE_HEIGHT_PT;
      }
    }
  }

  function newPage(): void {
    flushFootnotes();
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

  // Storyboard frames, preloaded for the same reason inserted images are: the
  // render loop below is synchronous.
  const avImageMap = new Map<string, { dataUrl: string; width: number; height: number }>();
  for (const n of nodes) {
    if (n.typeName !== 'avBlock' || !n.raw) continue;
    for (const rn of avRowNodes(n.raw)) {
      if (!rn.image) continue;
      const attrs = (rn.image.attrs || {}) as Record<string, unknown>;
      const key = avFrameKey(attrs as { src?: string | null; assetId?: string | null; scratchId?: string | null });
      if (!key || avImageMap.has(key)) continue;
      const url = resolveImageUrl(attrs);
      if (!url) continue;
      const d = await loadImageData(url);
      if (d) avImageMap.set(key, { dataUrl: d.dataUrl, width: d.width, height: d.height });
    }
  }

  // Element ids the active template requires to start a new page (e.g. TV newAct).
  const forceBreakIds = getForceBreakIds();
  // Blank lines before each element, from the same template the editor
  // paginates with — resolved once so the whole document uses one answer.
  const spaceBeforeLines = getSpaceBefore();

  /**
   * Blank lines above an element, in points.
   *
   * Keyed by the element's template id, not its node type — a custom element
   * is `customElement` to the schema and `sceneCharacters` (say) to the
   * template that gives it its spacing. Reading the node type dropped that
   * spacing here while the editor kept it, so a script using a custom element
   * paginated differently in the file (issue #123).
   */
  const spaceBeforePtOf = (n: NodeInfo): number =>
    (spaceBeforeLines[elementIdOf({ type: n.typeName, attrs: n.attrs })] ?? 0) * LINE_HEIGHT_PT;

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

    // Decided jointly with the block, exactly as the paginator decides it: if
    // the block plus its own notes will not fit, both move to the next page and
    // the reservation returns to what it was.
    const claimed: FootnoteEntry[] = [];
    if (drawFootnotes) {
      for (const ref of plan!.refsByNode.get(node.srcIndex) ?? []) {
        // A note anchored here but sent to the end of the script still gets its
        // reference number in the text; it just costs this page nothing.
        if (!plan!.footnoteIds.has(ref.noteId)) continue;
        const entry = plan!.entryById.get(ref.noteId);
        if (entry && !pageEntries.includes(entry)) { pageEntries.push(entry); claimed.push(entry); }
      }
    }
    /**
     * Break the page for this block. The block's own notes travel with it
     * rather than being drawn on the page it has just left — which is exactly
     * why the reservation cannot oscillate.
     */
    const breakForBlock = () => {
      for (const e of claimed) {
        const at = pageEntries.indexOf(e);
        if (at >= 0) pageEntries.splice(at, 1);
      }
      newPage();
      for (const e of claimed) pageEntries.push(e);
    };

    // Dual dialogue — two speeches side by side, each in half the text column.
    // Drawn by its own pass for the same reason an AV body is: it is not one
    // run of text, and flattening it lost both speeches entirely.
    if (typeName === 'dualDialogue' && node.raw) {
      const columns = (node.raw.content ?? []).map((column) =>
        (column.content ?? []).map((child) => {
          const childType = String(child.type ?? 'dialogue');
          const runs = extractRuns(child);
          return {
            type: childType,
            text: getPlainText(runs),
            runs: applyTypeStyles(runs, childType),
          };
        }));
      const heightPt = dualDialogueLineCount(columns as DualColumns) * LINE_HEIGHT_PT;
      const sbPt = isFirstElement ? 0 : spaceBeforePtOf(node);

      if (forcedBreak || (currentY + sbPt + heightPt > bottomPt() && currentY > topMarginPt)) {
        breakForBlock();
      }
      if (!isFirstElement && currentY > topMarginPt) currentY += sbPt;

      const top = currentY;
      columns.forEach((children, col) => {
        // Each column's own first cue sits a line below the top of the block,
        // which is the margin the stylesheet gives it.
        let y = top + dualColumnLeadLines(children as DualColumns[number]) * LINE_HEIGHT_PT;
        for (const child of children) {
          const [leftIn, rightIn] = dualChildBounds(col, child.type);
          const wrapped = wordWrapRuns(
            child.runs, dualCharsPerLine(child.type), UPPERCASE_TYPES.has(child.type),
          );
          renderElement(
            pdf, wrapped, leftIn * PTS_PER_INCH, rightIn * PTS_PER_INCH, y, child.type, fonts,
          );
          y += wrapped.length * LINE_HEIGHT_PT;
        }
      });
      // The taller column decides how far the page has filled.
      currentY = top + heightPt;
      isFirstElement = false;
      i++;
      continue;
    }

    // AV body — a table, drawn by its own pass with row-level pagination and a
    // repeated header. See utils/avPdfTable.
    if (typeName === 'avBlock' && node.raw) {
      if (forcedBreak) breakForBlock();
      const bodies = extractAvBodies({ type: 'doc', content: [node.raw] });
      const body = bodies[0];
      if (body) {
        const cfg = readColumnConfig(node.attrs);
        const repeatHeaders = (node.attrs as { repeatHeaders?: boolean } | undefined)?.repeatHeaders !== false;
        drawAvBody(
          {
            pdf,
            drawLine: (line, xPt, yPt) => renderLine(pdf, line as TextRun[], xPt, yPt, fonts),
            charWidthPt: FD_CHAR_WIDTH_PT,
            lineHeightPt: LINE_HEIGHT_PT,
            leftPt: layout.leftMargin * PTS_PER_INCH,
            contentWidthPt,
            topMarginPt,
            bottomMarginPt,
            pageHeightPt,
            getY: () => currentY,
            setY: (y) => { currentY = y; },
            newPage,
            images: avImageMap,
          },
          body,
          avRowNodes(node.raw),
          { widths: cfg.widths, repeatHeaders },
        );
      }
      isFirstElement = false;
      i++;
      continue;
    }

    // Inserted image — place it, paginating if it doesn't fit.
    if (typeName === 'screenplayImage') {
      const img = imageMap.get(i);
      if (img) {
        const sbPt = isFirstElement ? 0 : LINE_HEIGHT_PT;
        if (forcedBreak) {
          breakForBlock();
        } else if (currentY + sbPt + img.hPt > pageHeightPt - bottomMarginPt && currentY > topMarginPt) {
          breakForBlock();
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

    const spaceBeforePt = isFirstElement ? 0 : spaceBeforePtOf(node);

    const wrappedLines = wordWrapRuns(node.runs, maxChars, forceUpper);
    const elementHeightPt = wrappedLines.length * LINE_HEIGHT_PT;
    const totalHeightPt = spaceBeforePt + elementHeightPt;

    /**
     * The block this element opens, measured once — the same grouping
     * `computeBreaks` paginates the editor with, because a group that fits on
     * screen has to be a group that fits in the file.
     *
     * Part 0 is the element itself. A character name takes the paragraphs that
     * follow it; a scene heading takes the element after it so it is never left
     * alone at a page foot, and when that element is a character it takes the
     * whole speech, not just the name.
     */
    interface BlockPart {
      nodeIndex: number; sbPt: number; wrapped: TextRun[][]; lines: number; heightPt: number;
    }
    const measure = (at: number): BlockPart => {
      const n = nodes[at];
      const w = wordWrapRuns(
        n.runs, CHARS_PER_LINE[n.typeName] || 62, UPPERCASE_TYPES.has(n.typeName),
      );
      const sb = spaceBeforePtOf(n);
      return {
        nodeIndex: at, sbPt: sb, wrapped: w, lines: w.length,
        heightPt: sb + w.length * LINE_HEIGHT_PT,
      };
    };
    const parts: BlockPart[] = [{
      nodeIndex: i, sbPt: spaceBeforePt, wrapped: wrappedLines,
      lines: wrappedLines.length, heightPt: totalHeightPt,
    }];
    /** Index in `parts` of the character name, when this block is a speech. */
    let speechAt = -1;

    // Never absorb an element that opens its own page — it has to be laid out
    // separately so its forced break is honoured.
    // ...and never one that is drawn by a pass of its own: it is not a run of
    // text, so a block holding it would measure it as nothing and draw it as
    // nothing. See laysItselfOut.
    const absorbable = (at: number) => at < nodes.length
      && !startsOwnPage({ type: nodes[at].typeName, attrs: nodes[at].attrs }, forceBreakIds)
      && !laysItselfOut(nodes[at].typeName);

    if (typeName === 'character' && i + 1 < nodes.length) {
      speechAt = 0;
    } else if (typeName === 'sceneHeading' && absorbable(i + 1)) {
      parts.push(measure(i + 1));
      if (nodes[i + 1].typeName === 'character' && i + 2 < nodes.length) speechAt = 1;
    }

    if (speechAt >= 0) {
      let j = parts[speechAt].nodeIndex + 1;
      while (j < nodes.length && DIALOGUE_BLOCK_TYPES.has(nodes[j].typeName) && absorbable(j)) {
        parts.push(measure(j));
        j++;
      }
      // Nothing was said after all — there is no speech to split.
      if (parts.length - 1 === speechAt) speechAt = -1;
    }

    const blockHeightPt = parts.reduce((h, p) => h + p.heightPt, 0);

    /** Draw one measured part of the block at the cursor. */
    const drawPart = (part: BlockPart, withSpaceBefore = true): void => {
      const dNode = nodes[part.nodeIndex];
      const dIndents = FD_INDENTS[dNode.typeName] || FD_INDENTS.general;
      if (withSpaceBefore) currentY += part.sbPt;
      renderElement(
        pdf, part.wrapped, dIndents[0] * PTS_PER_INCH, dIndents[1] * PTS_PER_INCH,
        currentY, dNode.typeName, fonts,
      );
      currentY += part.lines * LINE_HEIGHT_PT;
    };

    /**
     * Where to break a speech that will not fit — the index of the last part
     * staying on this page, or -1 to move the whole block down.
     *
     * This is the rule `computeBreaks` paginates the editor with, and it has to
     * stay that rule: any other answer puts the (MORE) on a different line on
     * screen than in the file (issue #123). Final Draft keeps at least two
     * lines of dialogue on each side of the turn, so the page is filled as far
     * as it will go and then backed off a paragraph at a time until what is
     * carried over is worth carrying.
     */
    const chooseDialogueSplit = (): number => {
      const MIN_DIALOGUE_LINES = 2;
      const remaining = bottomPt() - currentY;
      // The name, and the scene heading above it when one introduces the
      // speech: nothing down to there can be divided.
      let headPt = 0;
      for (let p = 0; p <= speechAt; p++) headPt += parts[p].heightPt;
      if (remaining < headPt + MIN_DIALOGUE_LINES * LINE_HEIGHT_PT) return -1;
      /** Dialogue lines left in the speech after a break following part `p`. */
      const linesAfter = (p: number): number => {
        let n = 0;
        for (let q = p + 1; q < parts.length; q++) n += parts[q].lines;
        return n;
      };
      let fittedPt = headPt;
      let fittedLines = 0;
      let chosen = -1;
      for (let p = speechAt + 1; p < parts.length; p++) {
        if (fittedPt + parts[p].heightPt > remaining) break;
        fittedPt += parts[p].heightPt;
        fittedLines += parts[p].lines;
        // The fullest boundary that satisfies both sides wins; a fuller one
        // that would leave a single line behind is passed over for it.
        if (fittedLines >= MIN_DIALOGUE_LINES && linesAfter(p) >= MIN_DIALOGUE_LINES) chosen = p;
      }
      return chosen;
    };

    if (forcedBreak) {
      // Template rule or manual "start on new page" flag — unconditional break.
      breakForBlock();
    } else if (currentY + blockHeightPt > bottomPt() && currentY > topMarginPt) {
      const splitAfter = speechAt >= 0 ? chooseDialogueSplit() : -1;

      if (splitAfter > 0) {
        // The head, then the paragraphs that stay on this page.
        for (let p = 0; p <= splitAfter; p++) drawPart(parts[p]);
        isFirstElement = false;

        const charIndents = FD_INDENTS.character || FD_INDENTS.general;
        const charLeftPt = charIndents[0] * PTS_PER_INCH;
        const charName = nodes[parts[speechAt].nodeIndex].plainText.trim().toUpperCase();
        if (mc.dialogueBreakContd && currentY + LINE_HEIGHT_PT <= bottomPt()) {
          drawPlain(pdf, mc.moreText, charLeftPt, currentY + LINE_HEIGHT_PT, fonts);
        }

        breakForBlock();

        /** Open the continued page: the CONT'D line costs a line only when it
         *  is actually printed, which is how the editor counts it too. */
        const openContinuation = () => {
          if (!mc.dialogueBreakContd) return;
          drawPlain(pdf, `${charName} ${mc.contdText}`, charLeftPt, currentY + LINE_HEIGHT_PT, fonts);
          currentY += LINE_HEIGHT_PT;
        };
        openContinuation();

        let drawnHere = false;
        for (let p = splitAfter + 1; p < parts.length; p++) {
          // A speech longer than a whole page turns again, paragraph by
          // paragraph, as `computeBreaks` turns it. The editor used to lay the
          // whole remainder out in one run instead, so a monologue ran off the
          // foot of the page on screen and the file put the rest elsewhere.
          if (drawnHere && currentY + parts[p].heightPt > bottomPt()) {
            if (mc.dialogueBreakContd && currentY + LINE_HEIGHT_PT <= bottomPt()) {
              drawPlain(pdf, mc.moreText, charLeftPt, currentY + LINE_HEIGHT_PT, fonts);
            }
            breakForBlock();
            openContinuation();
            drawnHere = false;
          }
          // The first paragraph after a turn sits at the top of the page, with
          // no space above it — as every element pushed to a new page does.
          drawPart(parts[p], drawnHere);
          drawnHere = true;
        }

        i = parts[parts.length - 1].nodeIndex + 1;
        continue;
      }
      // Either it is not a speech, or no boundary leaves enough on both sides:
      // the whole block moves down together.
      breakForBlock();
    }

    // Space before — unless the element has just landed at the top of a page.
    // The editor drops it there: its page-break decoration sets the element's
    // margin-top outright rather than adding to it, so on screen nothing ever
    // stands above the first element of a page. Only a *forced* break used to
    // be treated that way here, so every ordinary page turn started its page
    // one or two lines lower in the file than on screen — and being a whole
    // line, the error stayed for the rest of the page and moved its last
    // element off it (issue #123).
    if (!isFirstElement && currentY > topMarginPt) {
      currentY += spaceBeforePt;
    }

    // Render the element
    renderElement(pdf, wrappedLines, leftPt, rightPt, currentY, typeName, fonts);

    // Render scene numbers on both sides if enabled
    if (typeName === 'sceneHeading' && options?.sceneNumbersVisible && node.attrs?.sceneNumber) {
      const sceneNum = String(node.attrs.sceneNumber);
      const y = currentY + LINE_HEIGHT_PT; // baseline of first line
      pdf.setFontSize(12);
      // Left side: just inside left margin
      const leftNumX = 1.0 * PTS_PER_INCH;
      drawPlain(pdf, sceneNum, leftNumX, y, fonts, { bold: true });
      // Right side: near right margin, right-aligned
      const rightNumX = 7.75 * PTS_PER_INCH
        - measurePlain(pdf, sceneNum, fonts, { bold: true }); // bold like scene heading
      drawPlain(pdf, sceneNum, rightNumX, y, fonts, { bold: true });
    }

    currentY += elementHeightPt;
    isFirstElement = false;

    // Whatever else the block holds — the speech under a character name, or
    // the element a scene heading was kept with — follows it on this page.
    if (parts.length > 1) {
      for (let p = 1; p < parts.length; p++) drawPart(parts[p]);
      i = parts[parts.length - 1].nodeIndex + 1;
      continue;
    }

    i++;
  }

  // The last page has no break after it, so nothing has drawn its footnotes yet.
  flushFootnotes();


  // Endnote mode: the notes collect on their own sheets at the end of the
  // script, packed by the same helper the editor draws from, so the two agree
  // on how many sheets there are and what is on each.
  // Whatever the script ran out of room to continue finishes on the sheets at
  // the end, exactly as the editor lays it out.
  if (plan && (plan.endnoteEntries.length > 0 || pendingSlices.length > 0)) {
    const endnoteLeftPt = FD_INDENTS.action[0] * PTS_PER_INCH;
    const endnoteRightPt = FD_INDENTS.action[1] * PTS_PER_INCH;
    for (const page of buildEndnotePages(plan.endnoteEntries, linesPerPage, pendingSlices)) {
      pdf.addPage([pageWidthPt, pageHeightPt]);
      pageNumber++;
      let y = topMarginPt + LINE_HEIGHT_PT;
      if (page.hasHeading) {
        const heading = 'NOTES';
        const x = (endnoteLeftPt + endnoteRightPt) / 2 - measurePlain(pdf, heading, fonts) / 2;
        drawPlain(pdf, heading, x, y, fonts, {});
        y += ENDNOTE_HEADING_LINES * LINE_HEIGHT_PT;
      }
      for (const slice of page.slices) {
        const entry = plan.entryById.get(slice.noteId);
        if (!entry) continue;
        const lines = noteLines(entry, slice.isStart ? entry.entryLabel : null);
        // Only this slice's share of the note; the rest is on the next sheet.
        for (const line of lines.slice(slice.fromLine, slice.fromLine + slice.lines)) {
          renderLine(pdf, line, endnoteLeftPt, y, fonts);
          y += LINE_HEIGHT_PT;
        }
      }
    }
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

  return { bytes: new Uint8Array(pdf.output('arraybuffer')), filename };
}

/** Render the script and put it somewhere the writer chose. */
export async function exportPDF(doc: JSONContent, title: string, layout: PageLayout, options?: PDFExportOptions): Promise<void> {
  const { saveFile } = await import('./fileOps');
  const { bytes, filename } = await renderPDF(doc, title, layout, options);
  await saveFile(bytes, filename, [{ name: 'PDF', extensions: ['pdf'] }]);
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
    drawPlain(pdf, centerText, centerPt - measurePlain(pdf, centerText, fonts) / 2, y, fonts);
  }

  // Right
  const rightText = resolveFields(content.right, pageNum, totalPages, title, revisionColor);
  if (rightText) {
    drawPlain(pdf, rightText, rightMarginPt - measurePlain(pdf, rightText, fonts), y, fonts);
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
