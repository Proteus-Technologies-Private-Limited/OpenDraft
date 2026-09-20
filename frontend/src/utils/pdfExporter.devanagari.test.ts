/**
 * A Hindi screenplay, exported.
 *
 * Issue #128: Devanagari did not come out of the PDF mangled, it came out
 * missing. The only embedded face was DejaVu Sans Mono, which has no
 * Devanagari at all, so every character of it reached a font with nothing to
 * draw it with and the page came back blank where the dialogue had been.
 *
 * These tests run the real jsPDF, read the produced bytes, and check three
 * things the writer would otherwise have to check by eye: that a Devanagari
 * face is embedded, that the characters they typed can be copied back out of
 * the file, and that what is actually painted is in drawing order rather than
 * storage order — which is the difference between हिन्दी and हनि्दी.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { reorderDevanagari } from './devanagari';

/** saveFile reaches for Tauri or the DOM; capture the bytes instead. */
const saved: Uint8Array[] = [];
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

/** jsPDF binds atob/btoa off `window` at module load — see exportFonts.integration.test.ts. */
const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

/**
 * The bundled fonts, served off disk — see pdfExporter.unicode.test.ts.
 *
 * Re-installed before every test, because one of them below replaces it with a
 * fetch that fails and the rest must not inherit that.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(process.cwd(), 'public', url));
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    } catch {
      return { ok: false };
    }
  }));
});

const text = (s: string): JSONContent => ({ type: 'text', text: s });

const HINDI_LINE = 'हिन्दी फ़िल्म';

const hindi: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('अंदर। पुस्तकालय — दिन')] },
    { type: 'action', content: [text('एक लेखक टाइप कर रहा है।')] },
    { type: 'character', content: [text('लेखक')] },
    { type: 'dialogue', content: [text('मैं जो भी लिखूँ, कुछ भी नहीं होता।')] },
  ],
};

const { exportPDF } = await import('./pdfExporter');

async function exportBytes(doc: JSONContent, title = 'Test', options?: Record<string, unknown>): Promise<string> {
  saved.length = 0;
  await exportPDF(doc, title, DEFAULT_PAGE_LAYOUT, options);
  return Buffer.from(saved[0]).toString('latin1');
}

/** The code points a PDF says it can be copied back out as — see the Cyrillic suite. */
function toUnicodeCodePoints(pdf: string): Set<number> {
  const points = new Set<number>();
  for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) {
      points.add(parseInt(pair[1], 16));
    }
  }
  return points;
}

/**
 * What the page actually paints, piece by piece, in the order it paints it.
 *
 * jsPDF writes text in a Standard 14 face as a literal `(string) Tj` and text
 * in an embedded font as `<glyph codes> Tj`, so the embedded pieces are read
 * back through the document's own ToUnicode map. Only usable on a document
 * with a single embedded font — two of them have glyph codes that collide.
 */
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
    for (let i = 0; i < hex.length; i += 4) out += glyphs.get(parseInt(hex.slice(i, i + 4), 16)) ?? '�';
    pieces.push(out);
  }
  return pieces;
}

/**
 * The Devanagari a string is made of.
 *
 * Derived from the script's own text rather than listed by hand, so the
 * assertion cannot drift from what the document actually says — and so it
 * covers every character, not the ones someone remembered to type twice.
 */
const devanagariIn = (...texts: string[]) => new Set(
  [...texts.join('')].map((c) => c.codePointAt(0)!).filter((cp) => cp >= 0x0900 && cp <= 0x097f),
);

describe('a Hindi screenplay', () => {
  it('embeds a Devanagari font, instead of one with no Devanagari in it', async () => {
    const pdf = await exportBytes(hindi);
    expect(pdf).toContain('/FontFile2'); // an embedded TrueType, not a Standard 14 reference
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansDevanagari/);
    // DejaVu has no Devanagari; fetching it for this script would embed a face
    // that could only draw blanks.
    expect(pdf).not.toContain('DejaVuSansMono');
  });

  it('keeps every character the writer typed', async () => {
    const mapped = toUnicodeCodePoints(await exportBytes(hindi));
    for (const cp of devanagariIn(...hindi.content!.map((n) => n.content![0].text!))) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });

  it('paints the vowel signs where they are read, not where they are stored', async () => {
    const pdf = await exportBytes({
      type: 'doc',
      content: [{ type: 'action', content: [text(HINDI_LINE)] }],
    });
    // Stored as ह ि …; painted as ि ह …, because nothing downstream of jsPDF
    // will move it. See utils/devanagari.
    expect(paintedPieces(pdf)).toContain(reorderDevanagari(HINDI_LINE));
    expect(reorderDevanagari(HINDI_LINE)).not.toBe(HINDI_LINE);
  });

  it('leaves a Latin word inside a Hindi line on the script face', async () => {
    const pdf = await exportBytes({
      type: 'doc',
      content: [{ type: 'action', content: [text('मैं CUT TO: लिख')] }],
    });
    // Three pieces, not one: the Latin keeps Courier's fixed cell instead of
    // being dragged into a proportional face with the Hindi.
    expect(paintedPieces(pdf)).toEqual(
      expect.arrayContaining([reorderDevanagari('मैं '), 'CUT TO: ', reorderDevanagari('लिख')]),
    );
  });

  it('embeds the bold weight for a bold scene heading, not just the regular one', async () => {
    const pdf = await exportBytes(hindi);
    // Two font programs: the scene heading is bold, the rest of the script is
    // not, and jsPDF embeds a subset per style it was asked to draw.
    expect(pdf.match(/\/FontFile2/g)?.length).toBe(2);
  });

  it('carries a Hindi title page and header through as text', async () => {
    const titled: JSONContent = {
      type: 'doc',
      content: [
        { type: 'titlePage', attrs: { field: 'title', tpTitle: true }, content: [text('आवारा')] },
        { type: 'titlePage', attrs: { field: 'author' }, content: [text('ख्वाजा अहमद अब्बास')] },
        ...hindi.content!,
      ],
    };
    const mapped = toUnicodeCodePoints(await exportBytes(titled, 'आवारा', { documentTitle: 'आवारा' }));
    for (const cp of devanagariIn('आवारा', 'ख्वाजा अहमद अब्बास')) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });

  it('is unaffected by the document font — a face that cannot write it does not get to', async () => {
    const mapped = toUnicodeCodePoints(await exportBytes(hindi, 'Test', { documentFont: 'Times New Roman' }));
    for (const cp of devanagariIn('लेखक')) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });
});

describe('a font that will not load', () => {
  it('says so, instead of handing over a script with holes in it', async () => {
    // However the font came to be unreachable — a platform whose web view
    // serves assets differently, a stripped bundle, a corrupted file — the
    // writer must not find out from whoever they sent the PDF to. This is the
    // shape issue #128 was reported in, so it is the one failure that is never
    // allowed to be silent.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    vi.resetModules(); // the font bytes are cached for the session
    const fresh = await import('./pdfExporter');

    saved.length = 0;
    const warning = await fresh.exportPDF(hindi, 'Test', DEFAULT_PAGE_LAYOUT);

    expect(warning).toMatch(/Devanagari font could not be loaded/);
    expect(saved).toHaveLength(1); // still written — a script is not lost over a font
  });

  it('says nothing when the font is there', async () => {
    saved.length = 0;
    expect(await exportPDF(hindi, 'Test', DEFAULT_PAGE_LAYOUT)).toBeUndefined();
  });
});

describe('the blocks that lay themselves out', () => {
  const cell = (s: string): JSONContent => ({
    type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'paragraph', content: [text(s)] }],
  });

  it('embeds a face for an AV body, which declares no runs of its own', async () => {
    const pdf = await exportBytes({
      type: 'doc',
      content: [{
        type: 'avBlock',
        content: [{
          type: 'avRow',
          content: [
            cell('कैमरा धीरे-धीरे पीछे जाता है।'),
            { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'paragraph', content: [text('पृष्ठभूमि में संगीत।')] }] },
          ],
        }],
      }],
    });
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansDevanagari/);
    const mapped = toUnicodeCodePoints(pdf);
    for (const cp of devanagariIn('कैमरा धीरे-धीरे पीछे जाता है।', 'पृष्ठभूमि में संगीत।')) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });

  it('embeds a face for dual dialogue, which declares none either', async () => {
    const column = (name: string, line: string): JSONContent => ({
      type: 'dualColumn',
      content: [
        { type: 'character', content: [text(name)] },
        { type: 'dialogue', content: [text(line)] },
      ],
    });
    const pdf = await exportBytes({
      type: 'doc',
      content: [{ type: 'dualDialogue', content: [column('लेखक', 'मैं लिखता हूँ।'), column('संपादक', 'मैं काटता हूँ।')] }],
    });
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansDevanagari/);
    const mapped = toUnicodeCodePoints(pdf);
    for (const cp of devanagariIn('लेखक', 'मैं लिखता हूँ।', 'संपादक', 'मैं काटता हूँ।')) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });
});

describe('a screenplay in two non-Latin scripts', () => {
  it('embeds a face for each, and sends each script to its own', async () => {
    const pdf = await exportBytes({
      type: 'doc',
      content: [
        { type: 'action', content: [text('Привет')] },
        { type: 'action', content: [text('नमस्ते')] },
      ],
    });
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansDevanagari/);
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*DejaVuSansMono/);

    const mapped = toUnicodeCodePoints(pdf);
    for (const cp of [...'Привет', ...'नमस्ते'].map((c) => c.codePointAt(0)!)) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });
});
