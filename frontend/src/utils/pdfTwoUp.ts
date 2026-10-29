/**
 * Sides two to a sheet: each pair of script pages side by side on one
 * landscape sheet of the script's own paper, scaled to fit — how sides are
 * handed out on set.
 *
 * Done after everything else, on the finished pages, rather than by laying
 * the script out a second time at a smaller size. Each page's content stream
 * is drawn onto the sheet through a scale-and-shift (`cm`), so what lands on
 * it is exactly the page the exporter already drew: its own page number, its
 * scene numbers, its cross-outs and watermark, merely smaller. jsPDF keeps one
 * resource dictionary — fonts, images, transparency — for every page, so a
 * page's stream reads the same wherever it is drawn. Encryption is applied at
 * output, after this, so a password covers the sheets like any other page.
 */
import type jsPDF from 'jspdf';

/** Where one script page sits on a sheet, in PDF space (origin bottom-left). */
export interface TwoUpSlot {
  /** The page's number in the file before composing, from 1. */
  page: number;
  x: number;
  y: number;
}

export interface TwoUpLayout {
  sheetWidth: number;
  sheetHeight: number;
  /** One factor for every page, so the two halves of a sheet match. */
  scale: number;
  /** The pages on each sheet, left then right. An odd last page sits alone, on the left. */
  sheets: TwoUpSlot[][];
}

/**
 * Pair `pageCount` pages of `pageWidth` × `pageHeight` onto landscape sheets
 * of the same paper. Each page fills half a sheet as far as it can without
 * distortion and is centred in that half — the page's own margins are the
 * white space round it, so nothing is lost to a printer that cannot print to
 * the edge.
 */
export function twoUpLayout(pageCount: number, pageWidth: number, pageHeight: number): TwoUpLayout {
  if (!(pageWidth > 0) || !(pageHeight > 0)) {
    throw new Error('The page size is not valid, so the pages cannot be put two to a sheet.');
  }
  const sheetWidth = Math.max(pageWidth, pageHeight);
  const sheetHeight = Math.min(pageWidth, pageHeight);
  const half = sheetWidth / 2;
  const scale = Math.min(half / pageWidth, sheetHeight / pageHeight);
  const drawnWidth = pageWidth * scale;
  const drawnHeight = pageHeight * scale;
  const y = (sheetHeight - drawnHeight) / 2;

  const sheets: TwoUpSlot[][] = [];
  for (let page = 1; page <= pageCount; page += 2) {
    const sheet: TwoUpSlot[] = [{ page, x: (half - drawnWidth) / 2, y }];
    if (page + 1 <= pageCount) sheet.push({ page: page + 1, x: half + (half - drawnWidth) / 2, y });
    sheets.push(sheet);
  }
  return { sheetWidth, sheetHeight, scale, sheets };
}

/** A number for a content stream: short, and never in exponent form. */
const num = (n: number) => String(Math.round(n * 10000) / 10000);

/**
 * Replace every page of `pdf` with landscape sheets holding two pages each.
 * `pageWidth` and `pageHeight` are the pages' size in points, as the file was
 * created with them.
 */
export function composeTwoUp(pdf: jsPDF, pageWidth: number, pageHeight: number): void {
  const pages = (pdf as unknown as { internal: { pages?: unknown[] } }).internal.pages;
  const count = pdf.getNumberOfPages();
  if (!Array.isArray(pages) || count < 1) {
    throw new Error('Could not put the pages two to a sheet: the PDF had an unexpected structure.');
  }
  const streams: string[][] = [];
  for (let n = 1; n <= count; n++) {
    const stream = pages[n];
    if (!Array.isArray(stream)) {
      throw new Error(`Could not put the pages two to a sheet: page ${n} had an unexpected structure.`);
    }
    streams.push([...(stream as string[])]);
  }

  const layout = twoUpLayout(count, pageWidth, pageHeight);
  for (const sheet of layout.sheets) {
    pdf.addPage([layout.sheetWidth, layout.sheetHeight], 'landscape');
    const target = pages[pdf.getNumberOfPages()] as string[];
    for (const slot of sheet) {
      // q … Q keeps whatever state the page leaves behind from reaching the
      // other half of the sheet.
      target.push('q', `${num(layout.scale)} 0 0 ${num(layout.scale)} ${num(slot.x)} ${num(slot.y)} cm`);
      target.push(...streams[slot.page - 1]);
      target.push('Q');
    }
    // A light rule down the middle, where the sheet is folded or cut.
    const mid = num(layout.sheetWidth / 2);
    const inset = layout.sheetHeight * 0.08;
    target.push(`q 0.75 G 0.5 w ${mid} ${num(inset)} m ${mid} ${num(layout.sheetHeight - inset)} l S Q`);
  }

  // Back to front, so deleting a page does not renumber the ones still to go.
  for (let n = count; n >= 1; n--) pdf.deletePage(n);
}
