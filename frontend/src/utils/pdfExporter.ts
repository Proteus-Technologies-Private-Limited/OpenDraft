// PDF exporter using jsPDF — renders screenplay with Final Draft formatting
// All constants match pagination.ts and screenplay.css for exact visual parity
import jsPDF from 'jspdf';
import type { JSONContent } from '@tiptap/react';
import type { PageLayout } from '../stores/editorStore';

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

export async function exportPDF(doc: JSONContent, title: string, layout: PageLayout): Promise<void> {
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

  const pdf = new jsPDF({
    unit: 'pt',
    format: [pageWidthPt, pageHeightPt],
  });

  pdf.setFont('courier', 'normal');
  pdf.setFontSize(12);

  // Character spacing adjustment: make jsPDF Courier match FD Courier (10.33 CPI)
  const baseCharWidth = pdf.getTextWidth('M');
  const charSpace = FD_CHAR_WIDTH_PT - baseCharWidth;

  // Build node list with type-level styles applied
  const nodes: NodeInfo[] = [];
  for (const node of doc.content) {
    const typeName = node.type || 'general';
    const rawRuns = extractRuns(node);
    const runs = applyTypeStyles(rawRuns, typeName);
    nodes.push({
      typeName,
      runs,
      plainText: getPlainText(rawRuns),
      attrs: node.attrs as Record<string, unknown> | undefined,
    });
  }

  let currentY = topMarginPt;
  let pageNumber = 1;
  let isFirstElement = true;

  function newPage(): void {
    pdf.addPage([pageWidthPt, pageHeightPt]);
    pageNumber++;
    currentY = topMarginPt;

    // Page number in header margin (does NOT consume content space)
    if (pageNumber >= 2) {
      renderPageNumber(pdf, pageNumber, layout, charSpace);
    }
  }

  // Process each node
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const typeName = node.typeName;
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
          if (currentY + LINE_HEIGHT_PT <= usableBottomPt) {
            setFontStyle(pdf, false, false);
            pdf.text('(MORE)', moreLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
          }

          newPage();

          // Render CONT'D character name
          const charName = node.plainText.trim().toUpperCase();
          setFontStyle(pdf, false, false);
          const contdIndents = FD_INDENTS.character || FD_INDENTS.general;
          const contdLeftPt = contdIndents[0] * PTS_PER_INCH;
          pdf.text(`${charName} (CONT'D)`, contdLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
          currentY += LINE_HEIGHT_PT;

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
              if (currentY + LINE_HEIGHT_PT <= usableBottomPt) {
                setFontStyle(pdf, false, false);
                pdf.text('(MORE)', contdLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
              }
              newPage();
              setFontStyle(pdf, false, false);
              pdf.text(`${charName} (CONT'D)`, contdLeftPt, currentY + LINE_HEIGHT_PT, { charSpace });
              currentY += LINE_HEIGHT_PT;
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

  await saveFile(new Uint8Array(pdf.output('arraybuffer')), filename, [{ name: 'PDF', extensions: ['pdf'] }]);
}

// --- Render helpers ---

function renderPageNumber(pdf: jsPDF, pageNum: number, layout: PageLayout, charSpace: number): void {
  const headerY = layout.headerMargin + 12; // header margin from top + font baseline
  // Match editor: page-sep-number { right: ${pageWidth - 7.25}in }
  const rightEdgePt = 7.25 * PTS_PER_INCH;
  setFontStyle(pdf, false, false);
  pdf.setFontSize(12);
  const numText = `${pageNum}.`;
  const textWidth = numText.length * FD_CHAR_WIDTH_PT;
  pdf.text(numText, rightEdgePt - textWidth, headerY, { charSpace });
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
export async function downloadPDF(doc: JSONContent, title: string, layout: PageLayout): Promise<void> {
  await exportPDF(doc, title, layout);
}
