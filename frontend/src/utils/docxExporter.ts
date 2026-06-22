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
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_HEADER_CONTENT, DEFAULT_FOOTER_CONTENT } from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';

// --- Layout constants (mirror pdfExporter.ts) ---

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const LINE_HEIGHT_PT = 12;
const FONT_FAMILY = 'Courier Prime';
const FONT_SIZE_HALFPT = 24; // 12pt

const FD_INDENTS: Record<string, [number, number]> = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50], character: [3.50, 7.50],
  dialogue: [2.50, 6.00], parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50], newAct: [1.50, 7.50],
  endOfAct: [1.50, 7.50], lyrics: [2.50, 6.00], showEpisode: [1.50, 7.50],
  castList: [1.50, 7.50],
};

const SPACE_BEFORE: Record<string, number> = {
  sceneHeading: 1, action: 1, character: 1, dialogue: 0,
  parenthetical: 0, transition: 1, general: 0, shot: 1,
  newAct: 2, endOfAct: 2, lyrics: 0, showEpisode: 1, castList: 0,
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

interface RunStyle {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

function extractRuns(node: JSONContent): RunStyle[] {
  if (!node.content || node.content.length === 0) {
    return [{ text: '', bold: false, italic: false, underline: false, strike: false }];
  }
  return node.content.map((child) => {
    const text = child.text || '';
    let bold = false, italic = false, underline = false, strike = false;
    if (child.marks) {
      for (const mark of child.marks) {
        if (mark.type === 'bold') bold = true;
        if (mark.type === 'italic') italic = true;
        if (mark.type === 'underline') underline = true;
        if (mark.type === 'strike') strike = true;
      }
    }
    return { text, bold, italic, underline, strike };
  });
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

function buildTextRuns(runs: RunStyle[]): TextRun[] {
  if (runs.length === 0 || (runs.length === 1 && runs[0].text === '')) {
    return [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })];
  }
  return runs
    .filter((r) => r.text.length > 0)
    .map(
      (r) =>
        new TextRun({
          text: r.text,
          font: FONT_FAMILY,
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
 * into a list of TextRun children. {page} and {pages} become Word PAGE /
 * NUMPAGES fields (live values); {title}, {date}, {revision} are resolved
 * to static text at export time.
 */
function templateToChildren(
  template: string,
  title: string,
  revisionColor: string,
): TextRun[] {
  if (!template) return [];
  const tokenRe = /(\{page\}|\{pages\}|\{title\}|\{date\}|\{revision\})/gi;
  const out: TextRun[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushText = (txt: string) => {
    if (txt.length === 0) return;
    out.push(new TextRun({ text: txt, font: FONT_FAMILY, size: FONT_SIZE_HALFPT }));
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
          font: FONT_FAMILY,
          size: FONT_SIZE_HALFPT,
        }),
      );
    } else if (token === '{pages}') {
      out.push(
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          font: FONT_FAMILY,
          size: FONT_SIZE_HALFPT,
        }),
      );
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
): Paragraph {
  const centerTab = Math.round(contentWidthTwips / 2);
  const rightTab = contentWidthTwips;

  const children: TextRun[] = [];
  if (content.left) {
    children.push(...templateToChildren(content.left, title, revisionColor));
  }
  if (content.center) {
    children.push(new TextRun({ text: '\t', font: FONT_FAMILY, size: FONT_SIZE_HALFPT }));
    children.push(...templateToChildren(content.center, title, revisionColor));
  }
  if (content.right) {
    children.push(new TextRun({ text: '\t', font: FONT_FAMILY, size: FONT_SIZE_HALFPT }));
    children.push(...templateToChildren(content.right, title, revisionColor));
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

/** Plain text of a node (joins text children, honoring nested content). */
function nodeText(node: JSONContent): string {
  if (!node.content) return '';
  return node.content.map((c) => (c.type === 'text' ? (c.text || '') : nodeText(c))).join('');
}

/**
 * Build the title-page paragraphs in DOCUMENT ORDER (free-flow / WYSIWYG):
 * titlePage text nodes (aligned by field; title bold + size) and image nodes,
 * exactly as arranged in the editor. Empty titlePage nodes become blank lines.
 */
function buildTitlePageFlow(
  nodes: JSONContent[],
  images: Map<number, { data: Uint8Array; w: number; h: number; align: string }>,
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
    const field = (node.attrs?.field as string) || 'title';
    const isTitle = field === 'title';
    const align = field === 'draft' ? AlignmentType.LEFT
      : (field === 'contact' || field === 'copyright') ? AlignmentType.RIGHT
        : AlignmentType.CENTER;
    const size = isTitle ? (Number(node.attrs?.tpTitleFontSize) || 12) * 2 : FONT_SIZE_HALFPT;
    const lines = nodeText(node).split('\n');
    const children = lines.map((line, idx) => new TextRun({
      text: isTitle ? line.toUpperCase() : line,
      font: FONT_FAMILY,
      size,
      bold: isTitle || undefined,
      break: idx > 0 ? 1 : undefined,
    }));
    paras.push(new Paragraph({
      alignment: align,
      spacing: { line: size * 10, lineRule: LineRuleType.EXACT },
      children: children.length ? children : [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
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
): Paragraph {
  const typeName = node.type || 'general';
  const indent = indentForType(typeName, layout);
  const alignment = alignmentForType(typeName);
  const sb = isFirst ? 0 : (SPACE_BEFORE[typeName] ?? 0) * LINE_HEIGHT_PT;
  const styledRuns = applyTypeStyles(extractRuns(node), typeName);
  const children = buildTextRuns(styledRuns);

  return new Paragraph({
    alignment,
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
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '') || 'Untitled';
}

export async function exportDocx(
  doc: JSONContent,
  title: string,
  layout: PageLayout,
  options?: DocxExportOptions,
): Promise<void> {
  const { saveFile } = await import('./fileOps');
  const filename = `${sanitizeFilename(title)}.docx`;

  // Separate the title-page region (the leading run of titlePage + image nodes)
  // from the body. The title page renders its nodes in DOCUMENT ORDER (free-flow),
  // matching the editor and PDF.
  const bodyNodes: JSONContent[] = [];
  const titleRegionNodes: JSONContent[] = [];
  let hasTitlePage = false;
  let inLeadingRegion = true;
  if (doc?.content) {
    for (const node of doc.content) {
      if (inLeadingRegion && (node.type === 'titlePage' || node.type === 'screenplayImage')) {
        if (node.type === 'titlePage' && node.attrs?.field === 'title' && node.attrs?.tpTitle) hasTitlePage = true;
        titleRegionNodes.push(node);
        continue;
      }
      inLeadingRegion = false;
      bodyNodes.push(node);
    }
  }
  // No real title page → leading images are top-of-body content; restore them.
  if (!hasTitlePage && titleRegionNodes.length > 0) {
    bodyNodes.unshift(...titleRegionNodes.filter((n) => n.type === 'screenplayImage'));
    titleRegionNodes.length = 0;
  }

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
  const headerContent = layout.headerContent || DEFAULT_HEADER_CONTENT;
  const footerContent = layout.footerContent || DEFAULT_FOOTER_CONTENT;
  const showHeader = !!(headerContent.left || headerContent.center || headerContent.right);
  const showFooter = !!(footerContent.left || footerContent.center || footerContent.right);
  const skipFirstPage = (layout.headerStartPage ?? 2) >= 2 || (layout.footerStartPage ?? 1) >= 2;

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

  const bodyParagraphs: Paragraph[] = [];
  for (let i = 0; i < bodyNodes.length; i++) {
    // When a title page precedes the body, force the screenplay's first
    // paragraph to start on a new page.  This is belt-and-suspenders on top
    // of the section break and prevents Word from rendering the screenplay
    // partway down page 2 if the title page didn't fully consume page 1.
    const forcePageBreak = i === 0 && hasTitlePage;
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
      buildElementParagraph(bodyNodes[i], layout, i === 0, forcePageBreak),
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

  // Build sections.  When a title page exists, use two sections so headers
  // and footers can be suppressed on the title page.  Otherwise a single
  // section covers everything; "different first page" handles headerStartPage=2.
  const headerPara = showHeader
    ? buildHFParagraph(headerContent, contentWidthTw, docTitle, revColor)
    : null;
  const footerPara = showFooter
    ? buildHFParagraph(footerContent, contentWidthTw, docTitle, revColor)
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

  const sections: ISectionOptions[] = [];

  if (hasTitlePage) {
    // Single section with `titlePage: true` so Word uses the empty first-page
    // header/footer for page 1 (the title page) and the real header/footer
    // for page 2+ (the screenplay).  The body's first paragraph carries
    // `pageBreakBefore: true` to start the screenplay on page 2.  Using ONE
    // section avoids the double-page-break that happens when you combine a
    // section break (NEXT_PAGE) with a paragraph-level page break.
    const headers: { default?: Header; first?: Header } = {};
    const footers: { default?: Footer; first?: Footer } = {};
    const emptyP = (): Paragraph => new Paragraph({
      children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
    });
    if (headerPara) {
      headers.default = new Header({ children: [headerPara] });
      headers.first = new Header({ children: [emptyP()] });
    }
    if (footerPara) {
      footers.default = new Footer({ children: [footerPara] });
      footers.first = new Footer({ children: [emptyP()] });
    }
    sections.push({
      properties: { ...sectionPageProps, titlePage: true },
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      footers: Object.keys(footers).length > 0 ? footers : undefined,
      children: [
        ...buildTitlePageFlow(titleRegionNodes, titleImageMap),
        ...bodyParagraphs,
      ],
    });
  } else {
    // Single section.  Use "different first page" to suppress HF on page 1
    // when headerStartPage >= 2 (the default).
    const props: Record<string, unknown> = { ...sectionPageProps };
    if (skipFirstPage && (showHeader || showFooter)) {
      props.titlePage = true; // docx flag enabling separate first-page header/footer
    }
    const headers: { default?: Header; first?: Header } = {};
    const footers: { default?: Footer; first?: Footer } = {};
    if (headerPara) {
      headers.default = new Header({ children: [headerPara] });
      if (skipFirstPage) {
        headers.first = new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
            }),
          ],
        });
      }
    }
    if (footerPara) {
      footers.default = new Footer({ children: [footerPara] });
      if (skipFirstPage) {
        footers.first = new Footer({
          children: [
            new Paragraph({
              children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZE_HALFPT })],
            }),
          ],
        });
      }
    }
    sections.push({
      properties: props as never,
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
          run: { font: FONT_FAMILY, size: FONT_SIZE_HALFPT },
          paragraph: {
            spacing: { line: LINE_HEIGHT_PT * TWIPS_PER_POINT, lineRule: LineRuleType.EXACT },
          },
        },
      },
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
