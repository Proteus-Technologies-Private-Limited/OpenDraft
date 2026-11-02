/**
 * A Tamil screenplay, exported.
 *
 * Reported from the Play Store: Tamil typed fine in the editor and came out
 * of the PDF as gibberish. Two things were wrong. The vowel sign of எப்போது
 * was moved in front of ப்ப as if it were a Hindi conjunct, so it read
 * எபேபாது; and every consonant with ு or ூ — கு, டு, ரு, the commonest
 * syllables in the language — is a glyph of its own that only the font's
 * OpenType rules reach, so they were drawn as the bare letter with a loose
 * hook beside it.
 *
 * These run the real jsPDF and HarfBuzz and read the bytes back: what glyphs
 * are painted, in what order, and what a reader copies out.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { reorderIndic, TAMIL } from './indic';

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

/** The bundled fonts, served off disk. HarfBuzz finds its own binary under Node. */
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

/** No punctuation, so the whole line is one piece in the Tamil face. */
const LINE = 'எப்போது வருவாய் நான் உன்னை எதிர்பார்த்துக் கொண்டிருக்கிறேன்';

const tamil: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('உள். வீடு - பகல்')] },
    { type: 'action', content: [text(LINE)] },
    { type: 'character', content: [text('முருகன்')] },
    { type: 'dialogue', content: [text('அவள் கொடுத்த புத்தகத்தை மேசையில் வைத்தாள்')] },
  ],
};

/** A run of UTF-16BE hex, as a ToUnicode entry or an ActualText string holds it. */
function utf16FromHex(hex: string): string {
  const units: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
  return String.fromCharCode(...units).replace(/^\uFEFF/, '');
}

/** Glyph id → the text the ToUnicode map says it copies out as. */
function toUnicode(pdf: string): Map<number, string> {
  const glyphs = new Map<number, string>();
  for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      glyphs.set(parseInt(pair[1], 16), utf16FromHex(pair[2]));
    }
  }
  return glyphs;
}

const actualTexts = (pdf: string) => [...pdf.matchAll(/\/ActualText\s*<([0-9a-fA-F]+)>/g)]
  .map((match) => utf16FromHex(match[1]));

/**
 * Each text object's painted text, glyph by glyph through the ToUnicode map —
 * drawing order, not reading order. Only usable with one embedded font.
 */
function paintedPieces(pdf: string): string[] {
  const glyphs = toUnicode(pdf);
  const fromGlyphs = (hex: string) => {
    let out = '';
    for (let i = 0; i < hex.length; i += 4) out += glyphs.get(parseInt(hex.slice(i, i + 4), 16)) ?? '\uFFFD';
    return out;
  };
  const pieces: string[] = [];
  for (const object of pdf.matchAll(/\nBT\n([\s\S]*?)\nET/g)) {
    let piece = '';
    const shown = /\(((?:\\.|[^()\\])*)\)\s*Tj|<([0-9a-fA-F]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g;
    for (const op of object[1].matchAll(shown)) {
      if (op[1] !== undefined) piece += op[1].replace(/\\([()\\])/g, '$1');
      else if (op[2] !== undefined) piece += fromGlyphs(op[2]);
      else for (const hex of op[3].matchAll(/<([0-9a-fA-F]+)>/g)) piece += fromGlyphs(hex[1]);
    }
    if (piece) pieces.push(piece);
  }
  return pieces;
}

const tamilIn = (...texts: string[]) => new Set(
  [...texts.join('')].map((c) => c.codePointAt(0)!).filter((cp) => cp >= 0x0b80 && cp <= 0x0bff),
);

const actionOnly = (line: string): JSONContent => ({
  type: 'doc', content: [{ type: 'action', content: [text(line)] }],
});

describe('a Tamil screenplay', async () => {
  const { exportPDF } = await import('./pdfExporter');
  const exportBytes = async (doc: JSONContent): Promise<string> => {
    saved.length = 0;
    expect(await exportPDF(doc, 'Test', DEFAULT_PAGE_LAYOUT)).toBeUndefined();
    return Buffer.from(saved[0]).toString('latin1');
  };

  it('embeds the Tamil face, regular and bold', async () => {
    const pdf = await exportBytes(tamil);
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansTamil/);
    expect(pdf.match(/\/FontFile2/g)?.length).toBe(2); // the heading is bold
  });

  it('draws கு, டு and ரு as the single letters they are, not a consonant and a hook', async () => {
    const glyphs = [...toUnicode(await exportBytes(actionOnly('கு டு ரு'))).values()];
    // One glyph standing for both characters is the ligature; without shaping
    // there were only single-character glyphs to draw with.
    for (const syllable of ['கு', 'டு', 'ரு']) expect(glyphs).toContain(syllable);
  });

  it('puts the vowel sign of எப்போது before the second ப, not before both', async () => {
    const painted = paintedPieces(await exportBytes(actionOnly(LINE)));
    // Drawing order is what the reordering fallback produces, now that it
    // knows a Tamil pulli ends its syllable.
    expect(painted).toContain(reorderIndic(LINE, TAMIL));
    expect(painted.join('')).toContain('ப்ேபா');
    expect(painted.join('')).not.toContain('ேப்பா');
  });

  it('copies back out as typed, through ActualText where the drawing order differs', async () => {
    const pdf = await exportBytes(actionOnly(LINE));
    // போ is drawn ே-ப-ா; its cluster carries what was typed.
    expect(actualTexts(pdf)).toContain('போ');
    // A cluster whose glyphs already spell it needs nothing extra.
    expect(actualTexts(pdf)).not.toContain('கு');
  });

  it('keeps every character the writer typed', async () => {
    const pdf = await exportBytes(tamil);
    const copied = new Set(
      [...[...toUnicode(pdf).values()].join(''), ...actualTexts(pdf).join('')].map((c) => c.codePointAt(0)!),
    );
    for (const cp of tamilIn(...tamil.content!.map((n) => n.content![0].text!))) {
      expect(copied.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });
});

describe('a Tamil screenplay when HarfBuzz cannot be loaded', () => {
  it('still exports, reordered correctly if not shaped', async () => {
    vi.resetModules();
    vi.doMock('./textShaping', () => ({
      shapingFont: vi.fn(async () => null),
      loadHarfBuzz: vi.fn(async () => null),
    }));
    try {
      const { exportPDF } = await import('./pdfExporter');
      saved.length = 0;
      expect(await exportPDF(actionOnly(LINE), 'Test', DEFAULT_PAGE_LAYOUT)).toBeUndefined();
      const pdf = Buffer.from(saved[0]).toString('latin1');
      expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansTamil/);
      expect(paintedPieces(pdf)).toContain(reorderIndic(LINE, TAMIL));
      expect(actualTexts(pdf)).toEqual([]);
    } finally {
      vi.doUnmock('./textShaping');
      vi.resetModules();
    }
  });
});
