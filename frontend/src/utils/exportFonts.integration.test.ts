/**
 * What typefaces the exported files actually declare.
 *
 * `pdfExporter.fonts.test.ts` drives a recording stub to prove the Final Draft
 * geometry is untouched; this one runs the real jsPDF and docx packages and
 * reads the fonts back out of the produced bytes — a PDF's /BaseFont entries
 * and a .docx's w:rFonts — so nothing is taken on trust from the exporter.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import JSZip from 'jszip';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

/** saveFile reaches for Tauri or the DOM; capture the bytes instead. */
const saved: Uint8Array[] = [];
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => {
    saved.push(data);
    return true;
  }),
}));

/**
 * jsPDF binds atob/btoa off `window` at module load, and the suite's `window`
 * (see test/setup.ts) is a stub with only what the stores need.  Node has both
 * as globals; hand them over before jsPDF is imported.
 */
const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const { exportPDF } = await import('./pdfExporter');
const { exportDocx } = await import('./docxExporter');

const text = (s: string, font?: string): JSONContent => ({
  type: 'text',
  text: s,
  ...(font ? { marks: [{ type: 'textStyle', attrs: { fontFamily: font } }] } : {}),
});

/** A short script, optionally with one section in a face of its own. */
const script = (styledFont?: string): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('INT. LIBRARY - DAY')] },
    { type: 'action', content: [text('A PROGRAMMER types at an old laptop.')] },
    { type: 'character', content: [text('PROGRAMMER')] },
    { type: 'dialogue', content: [text('Eureka.')] },
    ...(styledFont ? [{ type: 'action', content: [text('A note in another face.', styledFont)] }] : []),
    { type: 'transition', content: [text('FADE TO BLACK.')] },
  ],
});

/**
 * The faces a PDF actually *selects*, not the ones it lists.
 *
 * jsPDF writes the whole Standard 14 into every file's font table, so
 * /BaseFont entries prove nothing.  What matters is which resource names the
 * content stream switches to with `Tf`, resolved back through the page's
 * /Font dictionary to their BaseFont.
 */
function fontsUsedIn(pdf: Uint8Array): string[] {
  const raw = Buffer.from(pdf).toString('latin1');

  // object number → BaseFont name
  const baseFontOf = new Map<string, string>();
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    const base = /\/BaseFont\s*\/([A-Za-z-]+)/.exec(m[2]);
    if (base) baseFontOf.set(m[1], base[1]);
  }

  // resource name (/F1) → object number
  const objectOf = new Map<string, string>();
  for (const dict of raw.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
    for (const entry of dict[1].matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      objectOf.set(entry[1], entry[2]);
    }
  }

  const used = new Set<string>();
  for (const sel of raw.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf/g)) {
    const base = baseFontOf.get(objectOf.get(sel[1]) ?? '');
    if (base) used.add(base);
  }
  return [...used].sort();
}

async function pdfFonts(doc: JSONContent, documentFont?: string): Promise<string[]> {
  saved.length = 0;
  await exportPDF(doc, 'Test', DEFAULT_PAGE_LAYOUT, documentFont ? { documentFont } : undefined);
  return fontsUsedIn(saved[0]);
}

async function docxFonts(doc: JSONContent, documentFont?: string): Promise<string[]> {
  saved.length = 0;
  await exportDocx(doc, 'Test', DEFAULT_PAGE_LAYOUT, documentFont ? { documentFont } : undefined);
  const zip = await JSZip.loadAsync(saved[0]);
  const xml = await zip.file('word/document.xml')!.async('string');
  return [...new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]))].sort();
}

describe('PDF', () => {
  it('embeds nothing but Courier for an unaltered script', async () => {
    const fonts = await pdfFonts(script());
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font).toMatch(/Courier/);
  });

  it('embeds Times for a script set in Times New Roman', async () => {
    const fonts = await pdfFonts(script(), 'Times New Roman');
    expect(fonts.some((f) => /Times/.test(f))).toBe(true);
    expect(fonts.some((f) => /Courier/.test(f))).toBe(false);
  });

  it('embeds both when one section carries its own face', async () => {
    const fonts = await pdfFonts(script('Arial'));
    expect(fonts.some((f) => /Courier/.test(f))).toBe(true);
    expect(fonts.some((f) => /Helvetica|Arial/.test(f))).toBe(true);
  });
});

describe('DOCX', () => {
  it('names only the screenplay Courier for an unaltered script', async () => {
    expect(await docxFonts(script())).toEqual(['Courier Prime']);
  });

  it('names the document font throughout when one is set', async () => {
    expect(await docxFonts(script(), 'Times New Roman')).toEqual(['Times New Roman']);
  });

  it('names the section font alongside the document font', async () => {
    expect(await docxFonts(script('Arial'), 'Times New Roman')).toEqual(['Arial', 'Times New Roman']);
  });

  it('keeps a real family name, not a PDF substitute', async () => {
    // Word has the actual font; unlike the PDF it need not fall back to one of
    // the Standard 14, so Georgia must survive as Georgia.
    expect(await docxFonts(script('Georgia'))).toContain('Georgia');
  });
});
