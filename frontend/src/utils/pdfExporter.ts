// PDF exporter using jsPDF — renders screenplay with Final Draft formatting
// All constants match pagination.ts and screenplay.css for exact visual parity
import jsPDF from 'jspdf';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_HEADER_CONTENT, DEFAULT_FOOTER_CONTENT, resolveMoresContds } from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';
import { resolveImageUrl, loadImageData } from './imageAsset';

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

// Space before each element type (in lines) — matches pagination.ts & CSS margin-top values
const SPACE_BEFORE: Record<string, number> = {
  sceneHeading: 1, action: 1, character: 1, dialogue: 0,
  parenthetical: 0, transition: 1, general: 0, shot: 1,
  newAct: 2, endOfAct: 2, lyrics: 0, showEpisode: 1, castList: 0,
};

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

interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

interface NodeInfo {
  typeName: string;
  runs: TextRun[];
  plainText: string;
  attrs?: Record<string, unknown>;
}

// --- Helpers ---

function extractRuns(node: JSONContent): TextRun[] {
  if (!node.content || node.content.length === 0) {
    return [{ text: '', bold: false, italic: false, underline: false }];
  }
  return node.content.map((child) => {
    const text = child.text || '';
    let bold = false, italic = false, underline = false;
    if (child.marks) {
      for (const mark of child.marks) {
        if (mark.type === 'bold') bold = true;
        if (mark.type === 'italic') italic = true;
        if (mark.type === 'underline') underline = true;
      }
    }
    return { text, bold, italic, underline };
  });
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
  return runs.map((r) => r.text).join('');
}

function setFontStyle(pdf: jsPDF, bold: boolean, italic: boolean): void {
  if (bold && italic) {
    pdf.setFont('courier', 'bolditalic');
  } else if (bold) {
    pdf.setFont('courier', 'bold');
  } else if (italic) {
    pdf.setFont('courier', 'italic');
  } else {
    pdf.setFont('courier', 'normal');
  }
}

/**
 * Word-wrap text runs using character counting (monospace).
 * Uses CHARS_PER_LINE to match editor pagination exactly.
 */
function wordWrapRuns(
  runs: TextRun[],
  maxChars: number,
  forceUppercase: boolean,
): TextRun[][] {
  interface Word {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
  }

  const words: Word[] = [];
  for (const run of runs) {
    const text = forceUppercase ? run.text.toUpperCase() : run.text;
    const parts = text.split(' ');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && words.length > 0) {
        words[words.length - 1].text += ' ';
      }
      if (parts[i].length > 0) {
        words.push({
          text: parts[i],
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
        });
      }
    }
  }

  if (words.length === 0) {
    return [[{ text: '', bold: false, italic: false, underline: false }]];
  }

  const lines: TextRun[][] = [];
  let currentLine: TextRun[] = [];
  let currentLineChars = 0;

  for (const word of words) {
    const wordLen = word.text.length;

    if (currentLine.length === 0) {
      currentLine.push({ text: word.text, bold: word.bold, italic: word.italic, underline: word.underline });
      currentLineChars = wordLen;
    } else if (currentLineChars + wordLen <= maxChars) {
      const last = currentLine[currentLine.length - 1];
      if (last.bold === word.bold && last.italic === word.italic && last.underline === word.underline) {
        last.text += word.text;
      } else {
        currentLine.push({ text: word.text, bold: word.bold, italic: word.italic, underline: word.underline });
      }
      currentLineChars += wordLen;
    } else {
      if (currentLine.length > 0) {
        const lastRun = currentLine[currentLine.length - 1];
        lastRun.text = lastRun.text.replace(/ +$/, '');
      }
      lines.push(currentLine);
      const trimmedWord = word.text.replace(/^ +/, '');
      currentLine = [{ text: trimmedWord, bold: word.bold, italic: word.italic, underline: word.underline }];
      currentLineChars = trimmedWord.length;
    }
  }

  if (currentLine.length > 0) {
    const lastRun = currentLine[currentLine.length - 1];
    lastRun.text = lastRun.text.replace(/ +$/, '');
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [[{ text: '', bold: false, italic: false, underline: false }]];
}

/**
 * Render a line of TextRun segments at (x, y), using FD Courier character spacing.
 */
function renderLine(
  pdf: jsPDF,
  lineRuns: TextRun[],
  x: number,
  y: number,
  charSpace: number,
): void {
  let cursorX = x;
  for (const run of lineRuns) {
    if (run.text.length === 0) continue;
    setFontStyle(pdf, run.bold, run.italic);
    pdf.text(run.text, cursorX, y, { charSpace });
    const w = run.text.length * FD_CHAR_WIDTH_PT;
    if (run.underline) {
      const ulY = y + 1.5;
      pdf.setLineWidth(0.5);
      pdf.line(cursorX, ulY, cursorX + w, ulY);
    }
    cursorX += w;
  }
}

// --- Main export function ---

export interface PDFExportOptions {
  sceneNumbersVisible?: boolean;
  /** Document title for header/footer {title} field */
  documentTitle?: string;
  /** Current revision color for {revision} field */
  revisionColor?: string;
}

/** Resolve dynamic field placeholders in header/footer text */
function resolveFields(
  text: string,
  pageNum: number,
  totalPages: number,
  title: string,
  revisionColor: string,
): string {
  if (!text) return '';
  return text
    .replace(/\{page\}/gi, String(pageNum))
    .replace(/\{pages\}/gi, String(totalPages))
    .replace(/\{title\}/gi, title)
    .replace(/\{date\}/gi, new Date().toLocaleDateString())
    .replace(/\{revision\}/gi, revisionColor);
}

export async function exportPDF(doc: JSONContent, title: string, layout: PageLayout, options?: PDFExportOptions): Promise<void> {
  const { saveFile } = await import('./fileOps');
  const filename = `${sanitizeFilename(title)}.pdf`;

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

  pdf.setFont('courier', 'normal');
  pdf.setFontSize(12);

  // Character spacing adjustment: make jsPDF Courier match FD Courier (10.33 CPI)
  const baseCharWidth = pdf.getTextWidth('M');
  const charSpace = FD_CHAR_WIDTH_PT - baseCharWidth;

  // Build the body node list, separating the title-page region: the leading run
  // of titlePage + image nodes. The title page renders its nodes in DOCUMENT
  // ORDER (free-flow / WYSIWYG), matching the editor and DOCX.
  const nodes: NodeInfo[] = [];
  interface TitleItem { kind: 'text' | 'image'; field?: string; text?: string; titleSize?: number; attrs?: Record<string, unknown>; }
  const titleItems: TitleItem[] = [];
  let inLeadingRegion = true;
  let hasTitlePage = false;
  for (const node of doc.content) {
    const typeName = node.type || 'general';
    if (inLeadingRegion && (typeName === 'titlePage' || typeName === 'screenplayImage')) {
      if (typeName === 'titlePage') {
        if (node.attrs?.field === 'title' && node.attrs?.tpTitle) hasTitlePage = true;
        titleItems.push({
          kind: 'text',
          field: (node.attrs?.field as string) || 'title',
          text: getPlainText(extractRuns(node)),
          titleSize: Number(node.attrs?.tpTitleFontSize) || 12,
        });
      } else {
        titleItems.push({ kind: 'image', attrs: (node.attrs || {}) as Record<string, unknown> });
      }
      continue;
    }
    inLeadingRegion = false;
    const rawRuns = extractRuns(node);
    const runs = applyTypeStyles(rawRuns, typeName);
    nodes.push({
      typeName,
      runs,
      plainText: getPlainText(rawRuns),
      attrs: node.attrs as Record<string, unknown> | undefined,
    });
  }
  // No real title page → leading images are top-of-body content; restore them.
  if (!hasTitlePage && titleItems.length > 0) {
    const restored: NodeInfo[] = titleItems
      .filter((it) => it.kind === 'image')
      .map((it) => ({ typeName: 'screenplayImage', runs: [], plainText: '', attrs: it.attrs }));
    nodes.unshift(...restored);
    titleItems.length = 0;
  }

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
        pdf.setFont('courier', isTitle ? 'bold' : 'normal');
        pdf.setFontSize(isTitle ? (it.titleSize || 12) : 12);
        const x = align === 'left' ? leftX : align === 'right' ? rightX : centerX;
        const lines = (it.text || '').split('\n');
        for (const line of lines) {
          if (line && y + lineH <= bottom) pdf.text(isTitle ? line.toUpperCase() : line, x, y + lineH, { align });
          y += lineH;
        }
        pdf.setFontSize(12);
        y += 4; // small gap between elements
      }
    }

    // Start page 2 for the screenplay
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

  // Process each node
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const typeName = node.typeName;

    // Inserted image — place it, paginating if it doesn't fit.
    if (typeName === 'screenplayImage') {
      const img = imageMap.get(i);
      if (img) {
        const sbPt = isFirstElement ? 0 : LINE_HEIGHT_PT;
        if (currentY + sbPt + img.hPt > pageHeightPt - bottomMarginPt && currentY > topMarginPt) {
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

    const spaceBefore = isFirstElement ? 0 : (SPACE_BEFORE[typeName] ?? 0);
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
      while (j < nodes.length && DIALOGUE_BLOCK_TYPES.has(nodes[j].typeName)) {
        const dNode = nodes[j];
        const dMaxChars = CHARS_PER_LINE[dNode.typeName] || 36;
        const dSb = (SPACE_BEFORE[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
        const dLines = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));
        dialogueBlockHeight += dSb + dLines.length * LINE_HEIGHT_PT;
        dialogueBlockNodes.push(j);
        j++;
      }
    }

    // Scene heading: try to keep with the next element
    let keepWithNext = false;
    let nextElementHeight = 0;
    if (typeName === 'sceneHeading' && i + 1 < nodes.length) {
      keepWithNext = true;
      const nNode = nodes[i + 1];
      const nMaxChars = CHARS_PER_LINE[nNode.typeName] || 62;
      const nSb = (SPACE_BEFORE[nNode.typeName] ?? 0) * LINE_HEIGHT_PT;
      const nLines = wordWrapRuns(nNode.runs, nMaxChars, UPPERCASE_TYPES.has(nNode.typeName));
      nextElementHeight = nSb + nLines.length * LINE_HEIGHT_PT;
    }

    // Determine if we need a page break
    const projectedY = currentY + spaceBeforePt + elementHeightPt;

    if (isDialogueBlock && currentY + dialogueBlockHeight > usableBottomPt && currentY > topMarginPt + LINE_HEIGHT_PT) {
      // Try to split dialogue block across pages
      const remaining = usableBottomPt - currentY;

      // Can we fit at least the character name + 2 lines of dialogue?
      const charHeight = spaceBeforePt + elementHeightPt;
      const MIN_DIALOGUE_LINES = 2;
      const minSplitHeight = charHeight + MIN_DIALOGUE_LINES * LINE_HEIGHT_PT;

      if (remaining >= minSplitHeight) {
        // Render character name
        currentY += spaceBeforePt;
        renderElement(pdf, wrappedLines, leftPt, rightPt, currentY, typeName, charSpace);
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
          const dSb = (SPACE_BEFORE[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
          const dWrapped = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));
          const dHeight = dSb + dWrapped.length * LINE_HEIGHT_PT;

          if (currentY + dHeight > usableBottomPt) {
            break;
          }

          currentY += dSb;
          renderElement(pdf, dWrapped, dLeftPt, dRightPt, currentY, dNode.typeName, charSpace);
          currentY += dWrapped.length * LINE_HEIGHT_PT;
          dIdx++;
        }

        // Check if we still have dialogue nodes to render on next page
        if (dIdx < dialogueBlockNodes.length) {
          // Render (MORE) indicator
          const moreIndents = FD_INDENTS.character || FD_INDENTS.general;
          const moreLeftPt = moreIndents[0] * PTS_PER_INCH;
          if (mc.dialogueBreakContd && currentY + LINE_HEIGHT_PT <= usableBottomPt) {
            setFontStyle(pdf, false, false);
            pdf.text(mc.moreText, moreLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
          }

          newPage();

          // Render CONT'D character name
          const charName = node.plainText.trim().toUpperCase();
          const contdIndents = FD_INDENTS.character || FD_INDENTS.general;
          const contdLeftPt = contdIndents[0] * PTS_PER_INCH;
          if (mc.dialogueBreakContd) {
            setFontStyle(pdf, false, false);
            pdf.text(`${charName} ${mc.contdText}`, contdLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
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
            const dSb = (SPACE_BEFORE[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
            const dWrapped = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));
            const dHeight = dSb + dWrapped.length * LINE_HEIGHT_PT;

            // Check for another page break within continued dialogue
            if (currentY + dHeight > usableBottomPt) {
              if (mc.dialogueBreakContd && currentY + LINE_HEIGHT_PT <= usableBottomPt) {
                setFontStyle(pdf, false, false);
                pdf.text(mc.moreText, contdLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
              }
              newPage();
              if (mc.dialogueBreakContd) {
                setFontStyle(pdf, false, false);
                pdf.text(`${charName} ${mc.contdText}`, contdLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
                currentY += LINE_HEIGHT_PT;
              }
            }

            currentY += dSb;
            renderElement(pdf, dWrapped, dLeftPt, dRightPt, currentY, dNode.typeName, charSpace);
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

    // Apply space before
    if (!isFirstElement) {
      currentY += spaceBeforePt;
    }

    // Render the element
    renderElement(pdf, wrappedLines, leftPt, rightPt, currentY, typeName, charSpace);

    // Render scene numbers on both sides if enabled
    if (typeName === 'sceneHeading' && options?.sceneNumbersVisible && node.attrs?.sceneNumber) {
      const sceneNum = String(node.attrs.sceneNumber);
      const y = currentY + LINE_HEIGHT_PT; // baseline of first line
      setFontStyle(pdf, true, false); // bold like scene heading
      pdf.setFontSize(12);
      // Left side: just inside left margin
      const leftNumX = 1.0 * PTS_PER_INCH;
      pdf.text(sceneNum, leftNumX, y, { charSpace });
      // Right side: near right margin, right-aligned
      const numWidth = sceneNum.length * FD_CHAR_WIDTH_PT;
      const rightNumX = 7.75 * PTS_PER_INCH - numWidth;
      pdf.text(sceneNum, rightNumX, y, { charSpace });
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
        const dSb = (SPACE_BEFORE[dNode.typeName] ?? 0) * LINE_HEIGHT_PT;
        const dWrapped = wordWrapRuns(dNode.runs, dMaxChars, UPPERCASE_TYPES.has(dNode.typeName));

        currentY += dSb;
        renderElement(pdf, dWrapped, dLeftPt, dRightPt, currentY, dNode.typeName, charSpace);
        currentY += dWrapped.length * LINE_HEIGHT_PT;
      }
      i = dialogueBlockNodes[dialogueBlockNodes.length - 1] + 1;
      continue;
    }

    i++;
  }

  // Final pass: render headers and footers on all pages (now that totalPages is known)
  const totalPages = pageNumber;
  const hContent = layout.headerContent || DEFAULT_HEADER_CONTENT;
  const fContent = layout.footerContent || DEFAULT_FOOTER_CONTENT;
  const hStart = layout.headerStartPage ?? 2;
  const fStart = layout.footerStartPage ?? 1;
  const docTitle = options?.documentTitle || title;
  const revColor = options?.revisionColor || '';

  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    // Header
    if (p >= hStart && (hContent.left || hContent.center || hContent.right)) {
      const headerY = layout.headerMargin + 12;
      renderHFLine(pdf, hContent, p, totalPages, docTitle, revColor, headerY, layout, charSpace);
    }
    // Footer
    if (p >= fStart && (fContent.left || fContent.center || fContent.right)) {
      const footerY = pageHeightPt - layout.footerMargin;
      renderHFLine(pdf, fContent, p, totalPages, docTitle, revColor, footerY, layout, charSpace);
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
  charSpace: number,
): void {
  const leftMarginPt = layout.leftMargin * PTS_PER_INCH;
  const rightMarginPt = (layout.pageWidth - layout.rightMargin) * PTS_PER_INCH;
  const centerPt = (leftMarginPt + rightMarginPt) / 2;

  setFontStyle(pdf, false, false);
  pdf.setFontSize(12);

  // Left
  const leftText = resolveFields(content.left, pageNum, totalPages, title, revisionColor);
  if (leftText) {
    pdf.text(leftText, leftMarginPt, y, { charSpace });
  }

  // Center
  const centerText = resolveFields(content.center, pageNum, totalPages, title, revisionColor);
  if (centerText) {
    const cWidth = centerText.length * FD_CHAR_WIDTH_PT;
    pdf.text(centerText, centerPt - cWidth / 2, y, { charSpace });
  }

  // Right
  const rightText = resolveFields(content.right, pageNum, totalPages, title, revisionColor);
  if (rightText) {
    const rWidth = rightText.length * FD_CHAR_WIDTH_PT;
    pdf.text(rightText, rightMarginPt - rWidth, y, { charSpace });
  }
}


function renderElement(
  pdf: jsPDF,
  wrappedLines: TextRun[][],
  leftPt: number,
  rightPt: number,
  startY: number,
  typeName: string,
  charSpace: number,
): void {
  const isCentered = CENTERED_TYPES.has(typeName);
  const isRightAligned = RIGHT_ALIGNED_TYPES.has(typeName);
  const maxWidthPt = rightPt - leftPt;

  for (let lineIdx = 0; lineIdx < wrappedLines.length; lineIdx++) {
    const lineRuns = wrappedLines[lineIdx];
    const y = startY + (lineIdx + 1) * LINE_HEIGHT_PT; // +1 because jsPDF text baseline

    if (isCentered) {
      const totalChars = lineRuns.reduce((sum, r) => sum + r.text.length, 0);
      const totalWidth = totalChars * FD_CHAR_WIDTH_PT;
      const centerX = leftPt + (maxWidthPt - totalWidth) / 2;
      renderLine(pdf, lineRuns, centerX, y, charSpace);
    } else if (isRightAligned) {
      const totalChars = lineRuns.reduce((sum, r) => sum + r.text.length, 0);
      const totalWidth = totalChars * FD_CHAR_WIDTH_PT;
      const rightX = rightPt - totalWidth;
      renderLine(pdf, lineRuns, rightX, y, charSpace);
    } else {
      renderLine(pdf, lineRuns, leftPt, y, charSpace);
    }
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '') || 'Untitled';
}

// Convenience download function matching the pattern of other exporters
export async function downloadPDF(doc: JSONContent, title: string, layout: PageLayout, options?: PDFExportOptions): Promise<void> {
  await exportPDF(doc, title, layout, options);
}
