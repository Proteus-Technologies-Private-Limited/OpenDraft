/**
 * A Hebrew and an Arabic screenplay, exported.
 *
 * These two scripts had no face at all until the bidirectional algorithm was
 * written, because a font on its own would have made things worse: text is
 * stored in the order it is read and jsPDF paints it in the order it is
 * handed, so שלום would have gone out as םולש. A blank page announces itself;
 * a reversed one looks like text and gets sent to a producer.
 *
 * So the test that matters here is not that a font was embedded but that what
 * is *painted* is in the opposite order to what was typed — and, for Arabic,
 * that each letter is painted in the joined shape its neighbours call for
 * rather than standing on its own.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

/** saveFile reaches for Tauri or the DOM; capture the bytes instead. */
const saved: Uint8Array[] = [];
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

/** jsPDF binds atob/btoa off `window` at module load — see the Devanagari suite. */
const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

/** The bundled fonts, served off disk. */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(process.cwd(), 'public', url));
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
        ),
      };
    } catch {
      return { ok: false };
    }
  }));
});

const text = (s: string): JSONContent => ({ type: 'text', text: s });

const { exportPDF } = await import('./pdfExporter');

async function exportBytes(doc: JSONContent): Promise<string> {
  saved.length = 0;
  await exportPDF(doc, 'Test', DEFAULT_PAGE_LAYOUT);
  return Buffer.from(saved[0]).toString('latin1');
}

/** What the page paints, in the order it paints it — see the Devanagari suite. */
function paintedPieces(pdf: string): string[] {
  const glyphs = new Map<number, string>();
  for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      glyphs.set(parseInt(pair[1], 16), String.fromCodePoint(parseInt(pair[2], 16)));
    }
  }
  const pieces: string[] = [];
  for (const shown of pdf.matchAll(/(?:\(((?:\\.|[^()\\])*)\)|<([0-9a-fA-F]+)>)\s*Tj/g)) {
    if (shown[1] !== undefined) {
      pieces.push(shown[1].replace(/\\([()\\])/g, '$1'));
      continue;
    }
    const hex = shown[2];
    let out = '';
    for (let i = 0; i < hex.length; i += 4) {
      out += glyphs.get(parseInt(hex.slice(i, i + 4), 16)) ?? '�';
    }
    pieces.push(out);
  }
  return pieces;
}

const HEBREW_LINE = 'שלום עולם'; // שלום עולם

const hebrew: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('פנים')] },
    { type: 'action', content: [text(HEBREW_LINE)] },
  ],
};

const arabic: JSONContent = {
  type: 'doc',
  content: [
    { type: 'action', content: [text('ببب')] }, // ببب
  ],
};

describe('a Hebrew screenplay', () => {
  it('embeds a Hebrew face rather than one with no Hebrew in it', async () => {
    const pdf = await exportBytes(hebrew);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansHebrew/);
  });

  it('paints the line in the opposite order to the one it was typed in', async () => {
    const pdf = await exportBytes(hebrew);
    const painted = paintedPieces(pdf).join('');

    // The whole point: each word reversed, and the words themselves swapped,
    // which together is the line read from the right.
    expect(painted).toContain('םלוע םולש');
    // And emphatically not what was typed.
    expect(painted).not.toContain(HEBREW_LINE);
  });

  it('can still be copied out of the PDF as the text that was written', async () => {
    const pdf = await exportBytes(hebrew);
    const points = new Set<number>();
    for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of section[1].matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) {
        points.add(parseInt(pair[1], 16));
      }
    }
    for (const char of HEBREW_LINE.replace(' ', '')) {
      expect(points.has(char.codePointAt(0)!)).toBe(true);
    }
  });

  it('says nothing about an unsupported script, because Hebrew is not one', async () => {
    saved.length = 0;
    const { renderPDF } = await import('./pdfExporter');
    const rendered = await renderPDF(hebrew, 'Test', DEFAULT_PAGE_LAYOUT);
    expect(rendered.warning).toBeUndefined();
  });
});

describe('an Arabic screenplay', () => {
  it('paints joined letter shapes, not the isolated forms that were typed', async () => {
    const pdf = await exportBytes(arabic);
    const painted = paintedPieces(pdf).join('');
    const codes = [...painted].map((c) => c.codePointAt(0)!)
      .filter((cp) => cp >= 0x0600);

    // ببب drawn right to left: final, medial, initial. Nothing here is U+0628,
    // the character actually typed — every one is a presentation form.
    expect(codes).toEqual([0xfe90, 0xfe92, 0xfe91]);
  });

  it('embeds the Arabic face', async () => {
    const pdf = await exportBytes(arabic);
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansArabic/);
  });
});
