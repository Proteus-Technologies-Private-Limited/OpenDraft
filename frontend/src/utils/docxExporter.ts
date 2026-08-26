// Word (.docx) exporter — produces a Microsoft Word document that mirrors the
// on-screen screenplay layout (Final Draft style: Courier 12pt, exact element
// indents, single line spacing, type-level bold/italic/underline/uppercase).
//
// Layout strategy:
//   - Word page margins are taken from PageLayout (top/bottom in pt, left/right
//     in inches). All element positions are then expressed as paragraph indents
//     relative to those margins, using the same FD_INDENTS as pdfExporter.ts so
//     the visual result matches PDF / on-screen exactly.
//
// Header/footer field placeholders ({page}, {pages}, {title}, {date},
// {revision}) are translated to Word PAGE / NUMPAGES fields where applicable
// and resolved to static text otherwise.
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
  ImageRun,
} from 'docx';
import type { ISectionOptions } from 'docx';
import { resolveImageUrl, loadImageBytes } from './imageAsset';
import { jsonBlockRuns, jsonBlockText, type Run } from './nodeText';
import type { JSONContent } from '@tiptap/react';
import { resolveHeaderFooter, printedPageNumber } from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';
import { getForceBreakIds, jsonStartsOwnPage } from './pageBreaks';
import { getSpaceBefore, DEFAULT_SPACE_BEFORE } from './elementSpacing';
import { sanitizeExportFilename } from './exportFilename';
import { findTitlePageRegion, titlePageAttrsCarryData } from './titlePageRegion';
import { isNonPrintingType } from './nonPrinting';

// --- Layout constants (mirror pdfExporter.ts) ---

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const LINE_HEIGHT_PT = 12;
/**
 * The face a screenplay is written in unless the document says otherwise.
 * Word does its own line breaking, so unlike the PDF exporter nothing here
 * depends on the font being monospace — the family is simply passed through.
 */
const FONT_FAMILY = 'Courier Prime';
const FONT_SIZE_HALFPT = 24; // 12pt

const FD_INDENTS: Record<string, [number, number]> = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50], character: [3.50, 7.50],
  dialogue: [2.50, 6.00], parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50], newAct: [1.50, 7.50],
  endOfAct: [1.50, 7.50], lyrics: [2.50, 6.00], showEpisode: [1.50, 7.50],
  castList: [1.50, 7.50],
};

// Space before each element (in lines) now comes from the active formatting
// template via getSpaceBefore() — see utils/elementSpacing.ts, which pagination
// and the PDF exporter read too.

/**
 * Word paragraph-style names for each element type.
 *
 * Without these every paragraph exported as unnamed body text, so re-importing
 * a `.docx` OpenDraft wrote had nothing to classify by except indentation and
 * text shape — and General, whose 1.5" indent is shared with Action, Scene
 * Heading and the act markers, always fell through to the `action` fallback.
 * The names deliberately match `STYLE_NAME_MAP` in docxImporter, which is also
 * the vocabulary Final Draft and Fade In use, so their files gain the same
 * fidelity in the other direction.
 */
const STYLE_NAMES: Record<string, string> = {
  sceneHeading: 'Scene Heading', action: 'Action', character: 'Character',
  dialogue: 'Dialogue', parenthetical: 'Parenthetical', transition: 'Transition',
  general: 'General', shot: 'Shot', newAct: 'New Act', endOfAct: 'End of Act',
  lyrics: 'Lyrics', showEpisode: 'Show/Episode', castList: 'Cast List',
};

const UPPERCASE_TYPES = new Set([
  'sceneHeading', 'character', 'transition', 'shot', 'newAct', 'endOfAct', 'castList',
]);
const CENTERED_TYPES = new Set(['newAct', 'endOfAct', 'showEpisode']);
const RIGHT_ALIGNED_TYPES = new Set(['transition']);
const BOLD_TYPES = new Set(['sceneHeading', 'newAct', 'endOfAct', 'showEpisode']);
const ITALIC_TYPES = new Set(['lyrics', 'parenthetical']);
const UNDERLINE_TYPES = new Set(['newAct']);

// --- Run extraction ---

type RunStyle = Run;

/** Styled runs for a node, with hard breaks flagged. See utils/nodeText. */
function extractRuns(node: JSONContent): RunStyle[] {
  return jsonBlockRuns(node);
}

function applyTypeStyles(runs: RunStyle[], typeName: string): RunStyle[] {
  const forceBold = BOLD_TYPES.has(typeName);
  const forceItalic = ITALIC_TYPES.has(typeName);
  const forceUnderline = UNDERLINE_TYPES.has(typeName);
  const forceUpper = UPPERCASE_TYPES.has(typeName);
  if (!forceBold && !forceItalic && !forceUnderline && !forceUpper) return runs;
  return runs.map((r) => ({
    ...r,
    text: forceUpper ? r.text.toUpperCase() : r.text,
    bold: r.bold || forceBold,
    italic: r.italic || forceItalic,
    underline: r.underline || forceUnderline,
  }));
}

/**
 * Turn styled runs into docx TextRuns.
 *
 * A hard break becomes an empty run carrying `break: 1`, which the docx package
 * emits as `<w:br/>` — Word's native in-paragraph line break, so the exported
 * document breaks exactly where the editor does. The `!runs[0].isBreak` guard on
 * the empty-node early-out matters: a node whose only child is a break has one
 * run with `text === ''`, and without it the break would be swallowed.
 *
 * Exported for tests.
 */
export function buildTextRuns(runs: RunStyle[], docFont: string = FONT_FAMILY): TextRun[] {
  if (runs.length === 0 || (runs.length === 1 && runs[0].text === '' && !runs[0].isBreak)) {
    return [new TextRun({ text: '', font: docFont, size: FONT_SIZE_HALFPT })];
  }
  return runs
    .filter((r) => r.isBreak || r.text.length > 0)
    .map((r) =>
      r.isBreak
        ? new TextRun({ text: '', break: 1, font: docFont, size: FONT_SIZE_HALFPT })
        : new TextRun({
            text: r.text,
            // A run styled with its own face keeps it; everything else follows
            // the document.
            font: r.fontFamily || docFont,
            size: FONT_SIZE_HALFPT,
            bold: r.bold || undefined,
            italics: r.italic || undefined,
            underline: r.underline ? {} : undefined,
            strike: r.strike || undefined,
          }),
    );
}

// --- Indent calculation ---

interface IndentTwips {
  left: number;
  right: number;
}

function indentForType(typeName: string, layout: PageLayout): IndentTwips {
  const indents = FD_INDENTS[typeName] || FD_INDENTS.general;
  const leftIn = indents[0] - layout.leftMargin;
  const rightContentEdgeIn = layout.pageWidth - layout.rightMargin;
  const rightIn = rightContentEdgeIn - indents[1];
  return {
    left: Math.round(leftIn * TWIPS_PER_INCH),
    right: Math.round(rightIn * TWIPS_PER_INCH),
  };
}

function alignmentForType(typeName: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (CENTERED_TYPES.has(typeName)) return AlignmentType.CENTER;
  if (RIGHT_ALIGNED_TYPES.has(typeName)) return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

// --- Header/footer field resolution ---

/**
 * Convert a header/footer template like "Page {page} of {pages} — {title}"
 * into a list of TextRun children. {page} becomes a Word PAGE field (a live
 * value, offset by the section's starting number); {title}, {date}, {revision}
 * are resolved to static text at export time.
 *
 * {pages} is written as a literal when the caller knows the page count, because
 * Word's NUMPAGES counts every physical sheet — including the title page, which
 * a screenplay neither numbers nor counts. NUMPAGES is the fallback only when
 * the count wasn't supplied.
 */
function templateToChildren(
  template: string,
  title: string,
  revisionColor: string,
  docFont: string = FONT_FAMILY,
  totalPages?: number,
): TextRun[] {
  if (!template) return [];
  const tokenRe = /(\{page\}|\{pages\}|\{title\}|\{date\}|\{revision\})/gi;
  const out: TextRun[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushText = (txt: string) => {
    if (txt.length === 0) return;
    out.push(new TextRun({ text: txt, font: docFont, size: FONT_SIZE_HALFPT }));
  };

  while ((m = tokenRe.exec(template)) !== null) {
    if (m.index > lastIndex) {
      pushText(template.slice(lastIndex, m.index));
    }
    const token = m[0].toLowerCase();
    if (token === '{page}') {
      out.push(
        new TextRun({
          children: [PageNumber.CURRENT],
          font: docFont,
          size: FONT_SIZE_HALFPT,
        }),
      );
    } else if (token === '{pages}') {
      if (typeof totalPages === 'number') {
        pushText(String(totalPages));
      } else {
        out.push(
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            font: docFont,
            size: FONT_SIZE_HALFPT,
          }),
        );
      }
    } else if (token === '{title}') {
      pushText(title);
    } else if (token === '{date}') {
      pushText(new Date().toLocaleDateString());
    } else if (token === '{revision}') {
      pushText(revisionColor);
    }
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < template.length) {
    pushText(template.slice(lastIndex));
  }
  return out;
}

/**
 * Build a single header/footer paragraph that holds left/center/right segments
 * via two tab stops (center, right) — the standard Word recipe for tri-part
 * headers in a single line.
 */
function buildHFParagraph(
  content: HeaderFooterContent,
  contentWidthTwips: number,
  title: string,
  revisionColor: string,
  docFont: string = FONT_FAMILY,
  totalPages?: number,
): Paragraph {
  const centerTab = Math.round(contentWidthTwips / 2);
  const rightTab = contentWidthTwips;

  const children: TextRun[] = [];
  if (content.left) {
    children.push(...templateToChildren(content.left, title, revisionColor, docFont, totalPages));
  }
  if (content.center) {
    children.push(new TextRun({ text: '\t', font: docFont, size: FONT_SIZE_HALFPT }));
    children.push(...templateToChildren(content.center, title, revisionColor, docFont, totalPages));
  }
  if (content.right) {
    children.push(new TextRun({ text: '\t', font: docFont, size: FONT_SIZE_HALFPT }));
    children.push(...templateToChildren(content.right, title, revisionColor, docFont, totalPages));
  }

  return new Paragraph({
    tabStops: [
      { type: TabStopType.CENTER, position: centerTab },
      { type: TabStopType.RIGHT, position: rightTab },
    ],
    children,
  });
}

// --- Title page ---

/**
 * Plain text of a node. Hard breaks come through as newlines, which the title
 * page builder below already splits on to emit `break: 1` runs — so a break in
 * a title-page field renders as a real line break in the DOCX.
 */
const nodeText = jsonBlockText;

/**
 * Build the title-page paragraphs in DOCUMENT ORDER (free-flow / WYSIWYG):
 * titlePage text nodes (aligned by field; title bold + size) and image nodes,
 * exactly as arranged in the editor. Empty titlePage nodes become blank lines.
 */
function buildTitlePageFlow(
  nodes: JSONContent[],
  images: Map<number, { data: Uint8Array; w: number; h: number; align: string }>,
  docFont: string = FONT_FAMILY,
): Paragraph[] {
  const paras: Paragraph[] = [];
  nodes.forEach((node, i) => {
    if (node.type === 'screenplayImage') {
      const img = images.get(i);
      if (!img) return;
      paras.push(new Paragraph({
        alignment: img.align === 'left' ? AlignmentType.LEFT : img.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER,
        children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: img.w, height: img.h } })],
      }));
      return;
    }
    // A node absorbed into the region that is not a title-page node is a stray
    // blank line (see utils/titlePageRegion); render it as a spacer, never as
    // the title — which is bold, uppercased and possibly 72pt.
    const field = node.type === 'titlePage' ? ((node.attrs?.field as string) || 'title') : 'blank';
    const isTitle = field === 'title';
    const align = field === 'draft' ? AlignmentType.LEFT
      : (field === 'contact' || field === 'copyright') ? AlignmentType.RIGHT
        : AlignmentType.CENTER;
    const size = isTitle ? (Number(node.attrs?.tpTitleFontSize) || 12) * 2 : FONT_SIZE_HALFPT;
    const lines = nodeText(node).split('\n');
    const children = lines.map((line, idx) => new TextRun({
      text: isTitle ? line.toUpperCase() : line,
      font: docFont,
      size,
      bold: isTitle || undefined,
      break: idx > 0 ? 1 : undefined,
    }));
    paras.push(new Paragraph({
      alignment: align,
      spacing: { line: size * 10, lineRule: LineRuleType.EXACT },
      children: children.length ? children : [new TextRun({ text: '', font: docFont, size: FONT_SIZE_HALFPT })],
    }));
  });
  return paras;
}

// --- Element paragraph builder ---

function buildElementParagraph(
  node: JSONContent,
  layout: PageLayout,
  isFirst: boolean,
  pageBreakBefore = false,
  docFont: string = FONT_FAMILY,
  spaceBeforeLines: Record<string, number> = DEFAULT_SPACE_BEFORE,
): Paragraph {
  const typeName = node.type || 'general';
  const indent = indentForType(typeName, layout);
  const alignment = alignmentForType(typeName);
  const sb = isFirst ? 0 : (spaceBeforeLines[typeName] ?? 0) * LINE_HEIGHT_PT;
  const styledRuns = applyTypeStyles(extractRuns(node), typeName);
  const children = buildTextRuns(styledRuns, docFont);

  return new Paragraph({
    alignment,
    style: STYLE_NAMES[typeName] ? typeName : undefined,
    indent: {
      left: indent.left,
      right: indent.right,
    },
    pageBreakBefore: pageBreakBefore || undefined,
    spacing: {
      before: sb * TWIPS_PER_POINT,
      line: LINE_HEIGHT_PT * TWIPS_PER_POINT,
      lineRule: LineRuleType.EXACT,
    },
    children,
  });
}

// --- Main export ---

export interface DocxExportOptions {
  documentTitle?: string;
  revisionColor?: string;
  /** The document's typeface; defaults to the screenplay Courier. */
  documentFont?: string;
  /** Script pages as OpenDraft paginated them, excluding the title page. Lets
   *  `{pages}` be written as a literal instead of Word's NUMPAGES, which counts
   *  the title page and so is always one too high for a script that has one. */
  scriptPageCount?: number;
}

export async function exportDocx(
  doc: JSONContent,
  title: string,
  layout: PageLayout,
  options?: DocxExportOptions,
): Promise<void> {
  const { saveFile } = await import('./fileOps');
  const filename = `${sanitizeExportFilename(title)}.docx`;

  // Separate the title-page region (the leading run of titlePage + image nodes)
  // from the body. The title page renders its nodes in DOCUMENT ORDER (free-flow),
  // matching the editor and PDF.
  // Where the title page ends. Shared with the paginator, the PDF exporter and
  // the Title Page dialog so all four agree even when something stray sits above
  // the title (issue #52) — see utils/titlePageRegion.
  const bodyNodes: JSONContent[] = [];
  const titleRegionNodes: JSONContent[] = [];
  const docNodes = doc?.content ?? [];
  const region = findTitlePageRegion(
    docNodes.map((node) => ({
      type: node.type || 'general',
      hasText: nodeText(node).trim().length > 0,
      hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
    })),
  );
  const hasTitlePage = region.isReal;
  docNodes.forEach((node, index) => {
    // Sections and Notes never reach the page — see utils/nonPrinting.ts.
    if (isNonPrintingType(node.type)) return;
    if (hasTitlePage && index < region.length) {
      titleRegionNodes.push(node);
      return;
    }
    // Nothing worth a title page: the region's nodes are body content after all.
    // Blank title-page spacers are dropped rather than written as a screenful of
    // empty lines; anything carrying text is kept, where the old code discarded
    // the whole region.
    if (!hasTitlePage && node.type === 'titlePage' && nodeText(node).trim() === '') return;
    bodyNodes.push(node);
  });

  // Page geometry in twips
  const pageWidthTw = Math.round(layout.pageWidth * TWIPS_PER_INCH);
  const pageHeightTw = Math.round(layout.pageHeight * TWIPS_PER_INCH);
  const leftMarginTw = Math.round(layout.leftMargin * TWIPS_PER_INCH);
  const rightMarginTw = Math.round(layout.rightMargin * TWIPS_PER_INCH);
  const topMarginTw = Math.round(layout.topMargin * TWIPS_PER_POINT);
  const bottomMarginTw = Math.round(layout.bottomMargin * TWIPS_PER_POINT);
  const headerMarginTw = Math.round(layout.headerMargin * TWIPS_PER_POINT);
  const footerMarginTw = Math.round(layout.footerMargin * TWIPS_PER_POINT);
  const contentWidthTw = pageWidthTw - leftMarginTw - rightMarginTw;

  const docTitle = options?.documentTitle || title;
  const revColor = options?.revisionColor || '';
  const docFont = options?.documentFont || FONT_FAMILY;
  const hf = resolveHeaderFooter(layout);
  const headerContent = hf.headerContent;
  const footerContent = hf.footerContent;
  const showHeader = !!(headerContent.left || headerContent.center || headerContent.right);
  const showFooter = !!(footerContent.left || footerContent.center || footerContent.right);
  // The number the FIRST script page carries. Word's "different first page" is
  // the only per-page switch available, so each band is compared against this
  // one number — they are decided independently, never as a single shared flag.
  const firstPrinted = hf.startingPageNumber;
  const headerOnFirst = hf.headerStartPage <= firstPrinted;
  const footerOnFirst = hf.footerStartPage <= firstPrinted;
  const totalPrinted = typeof options?.scriptPageCount === 'number' && options.scriptPageCount > 0
    ? printedPageNumber(options.scriptPageCount, hf.startingPageNumber)
    : undefined;
  // Word can only special-case a section's first page. A band told to start
  // later than the second script page still appears there; say so rather than
  // exporting a file that silently disagrees with the PDF.
  if ((showHeader && hf.headerStartPage > firstPrinted + 1)
    || (showFooter && hf.footerStartPage > firstPrinted + 1)) {
    console.warn(
      '[docx] Word can only suppress a header/footer on the first page of a section; '
      + 'a start page beyond the second script page is exported as "skip the first page".',
    );
  }

  // Body paragraphs
  // Pre-load inserted images (async) before building paragraphs.
  const contentWidthPx = contentWidthTw / 15; // 15 twips per CSS px @ 96dpi
  const imageMap = new Map<number, { data: Uint8Array; w: number; h: number; align: string }>();
  for (let i = 0; i < bodyNodes.length; i++) {
    if (bodyNodes[i].type !== 'screenplayImage') continue;
    const attrs = (bodyNodes[i].attrs || {}) as Record<string, unknown>;
    const url = resolveImageUrl(attrs);
    if (!url) continue;
    const b = await loadImageBytes(url);
    if (!b) continue;
    const widthPx = Number(attrs.width) || 0;
    let w = widthPx > 0 ? widthPx : Math.min(b.width, Math.round(contentWidthPx * 0.9));
    w = Math.min(w, Math.round(contentWidthPx));
    const h = Math.round(w * (b.height / (b.width || 1)));
    imageMap.set(i, { data: b.data, w, h, align: (attrs.align as string) || 'center' });
  }

  // Pre-load title-page images, keyed by their index in the title region (so the
  // flow builder can place them in document order).
  const titleImageMap = new Map<number, { data: Uint8Array; w: number; h: number; align: string }>();
  for (let i = 0; i < titleRegionNodes.length; i++) {
    const node = titleRegionNodes[i];
    if (node.type !== 'screenplayImage') continue;
    const attrs = (node.attrs || {}) as Record<string, unknown>;
    const url = resolveImageUrl(attrs);
    if (!url) continue;
    const b = await loadImageBytes(url);
    if (!b) continue;
    const widthPx = Number(attrs.width) || 0;
    let w = widthPx > 0 ? widthPx : Math.min(b.width, Math.round(contentWidthPx * 0.5));
    w = Math.min(w, Math.round(contentWidthPx));
    const h = Math.round(w * (b.height / (b.width || 1)));
    titleImageMap.set(i, { data: b.data, w, h, align: (attrs.align as string) || 'center' });
  }

  // Element ids the active template requires to start a new page (e.g. TV newAct).
  const forceBreakIds = getForceBreakIds();
  // Blank lines before each element, from the same template the editor
  // paginates with — resolved once so the whole document uses one answer.
  const spaceBeforeLines = getSpaceBefore();

  const bodyParagraphs: Paragraph[] = [];
  for (let i = 0; i < bodyNodes.length; i++) {
    // The title page lives in its own section, and a section break already
    // starts a new page — adding `pageBreakBefore` to the body's first
    // paragraph on top of it would leave a blank sheet in between.
    // The template's forced-break elements and the per-element "start on new
    // page" flag still each open a page of their own.
    const forcePageBreak = i > 0 && jsonStartsOwnPage(bodyNodes[i], forceBreakIds);
    const img = imageMap.get(i);
    if (img) {
      bodyParagraphs.push(new Paragraph({
        alignment: img.align === 'left' ? AlignmentType.LEFT : img.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER,
        ...(forcePageBreak ? { pageBreakBefore: true } : {}),
        children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: img.w, height: img.h } })],
      }));
      continue;
    }
    bodyParagraphs.push(
      buildElementParagraph(bodyNodes[i], layout, i === 0, forcePageBreak, docFont, spaceBeforeLines),
    );
  }
  if (bodyParagraphs.length === 0) {
    bodyParagraphs.push(
      new Paragraph({
        spacing: { line: 240, lineRule: LineRuleType.EXACT },
        children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
      }),
    );
  }

  // Build sections.
  //
  // A title page needs its OWN section, not just a blanked first-page header on
  // a shared one. Word numbers physical sheets, so with one section the title
  // page is page 1 and the first script page is page 2 — which printed "2." on
  // the opening page and gave the first script page a header that the layout
  // said to suppress. A second section restarts numbering at the script's
  // starting number and gets its own "different first page", so "first page"
  // means the first page of the SCRIPT rather than the title page.
  const headerPara = showHeader
    ? buildHFParagraph(headerContent, contentWidthTw, docTitle, revColor, docFont, totalPrinted)
    : null;
  const footerPara = showFooter
    ? buildHFParagraph(footerContent, contentWidthTw, docTitle, revColor, docFont, totalPrinted)
    : null;

  const sectionPageProps = {
    page: {
      size: { width: pageWidthTw, height: pageHeightTw },
      margin: {
        top: topMarginTw,
        bottom: bottomMarginTw,
        left: leftMarginTw,
        right: rightMarginTw,
        header: headerMarginTw,
        footer: footerMarginTw,
      },
    },
  } as const;

  const emptyP = (): Paragraph => new Paragraph({
    children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
  });

  /** Header/footer set for the section that holds the screenplay. Each band's
   *  first page is decided on its own, so a footer that starts on page 1
   *  survives a header that starts on page 2 — they used to share one flag. */
  const buildScriptBands = () => {
    const differentFirst = (showHeader && !headerOnFirst) || (showFooter && !footerOnFirst);
    const headers: { default?: Header; first?: Header } = {};
    const footers: { default?: Footer; first?: Footer } = {};
    if (headerPara) {
      headers.default = new Header({ children: [headerPara] });
      // With w:titlePg set, a band with no first-page definition renders blank.
      // The band that DOES belong on page 1 has to repeat its content there.
      if (differentFirst) {
        headers.first = headerOnFirst
          ? new Header({ children: [headerPara] })
          : new Header({ children: [emptyP()] });
      }
    }
    if (footerPara) {
      footers.default = new Footer({ children: [footerPara] });
      if (differentFirst) {
        footers.first = footerOnFirst
          ? new Footer({ children: [footerPara] })
          : new Footer({ children: [emptyP()] });
      }
    }
    return { differentFirst, headers, footers };
  };

  const sections: ISectionOptions[] = [];
  const { differentFirst, headers, footers } = buildScriptBands();
  const scriptProps: Record<string, unknown> = {
    ...sectionPageProps,
    // Restart the count so the first script page carries the number the layout
    // says it should, whatever precedes it.
    page: { ...sectionPageProps.page, pageNumbers: { start: hf.startingPageNumber } },
  };
  if (differentFirst) scriptProps.titlePage = true;

  if (hasTitlePage) {
    // Section 1 — the title page: never numbered, never carries a band.
    sections.push({
      properties: sectionPageProps as never,
      children: buildTitlePageFlow(titleRegionNodes, titleImageMap, docFont),
    });
    // Section 2 — the screenplay. A section break already starts a new page, so
    // the body's first paragraph must NOT also carry `pageBreakBefore`; the two
    // together leave a blank sheet between the title page and the script.
    sections.push({
      properties: scriptProps as never,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      footers: Object.keys(footers).length > 0 ? footers : undefined,
      children: bodyParagraphs,
    });
  } else {
    sections.push({
      properties: scriptProps as never,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      footers: Object.keys(footers).length > 0 ? footers : undefined,
      children: bodyParagraphs,
    });
  }

  const document = new Document({
    creator: 'OpenDraft',
    title: docTitle,
    styles: {
      default: {
        document: {
          run: { font: docFont, size: FONT_SIZE_HALFPT },
          paragraph: {
            spacing: { line: LINE_HEIGHT_PT * TWIPS_PER_POINT, lineRule: LineRuleType.EXACT },
          },
        },
      },
      // Named styles carry the element type through the file. The per-paragraph
      // indent/spacing/run properties are still written directly, so a reader
      // that ignores styles sees exactly what it saw before.
      paragraphStyles: Object.entries(STYLE_NAMES).map(([id, name]) => ({
        id,
        name,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
      })),
    },
    sections,
  });

  const blob = await Packer.toBlob(document);
  const buf = new Uint8Array(await blob.arrayBuffer());
  await saveFile(buf, filename, [{ name: 'Word Document', extensions: ['docx'] }]);
}

export async function downloadDocx(
  doc: JSONContent,
  title: string,
  layout: PageLayout,
  options?: DocxExportOptions,
): Promise<void> {
  await exportDocx(doc, title, layout, options);
}
