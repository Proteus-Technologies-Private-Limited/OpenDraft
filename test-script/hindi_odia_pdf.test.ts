/**
 * Hindi and Odia in one exported PDF.
 *
 * The case reported from the Android emulator: a script holding both. Checks
 * that each gets its own face, that every character survives into the file,
 * and that the exporter says nothing is missing.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const saved: Uint8Array[] = [];
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const FONT_ROOT = join(process.cwd(), 'frontend', 'public');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(FONT_ROOT, url));
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

const HINDI = 'जीवन से भरी तेरी आँखें';
const ODIA = 'ଜୀବନରେ ଭରି ତୁମର ଆଖି';

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('INT. STUDIO - DAY')] },
    { type: 'action', content: [text(HINDI)] },
    { type: 'action', content: [text(ODIA)] },
  ],
};

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');

function toUnicodeCodePoints(pdf: string): Set<number> {
  const points = new Set<number>();
  for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) {
      points.add(parseInt(pair[1], 16));
    }
  }
  return points;
}

const inBlock = (s: string, lo: number, hi: number) => new Set(
  [...s].map((c) => c.codePointAt(0)!).filter((cp) => cp >= lo && cp <= hi),
);

describe('a script holding Hindi and Odia', () => {
  it('embeds a face for each and keeps every character', async () => {
    saved.length = 0;
    const result = await exportPDF(doc, 'HindiOdia', DEFAULT_PAGE_LAYOUT);
    const pdf = Buffer.from(saved[0]).toString('latin1');
    mkdirSync(join(process.cwd(), 'test-script', 'output'), { recursive: true });
    writeFileSync(join(process.cwd(), 'test-script', 'output', 'hindi-odia.pdf'), Buffer.from(saved[0]));

    expect((result as { warning?: string })?.warning).toBeUndefined();
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansDevanagari/);
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*NotoSansOriya/);

    const mapped = toUnicodeCodePoints(pdf);
    for (const cp of inBlock(HINDI, 0x0900, 0x097f)) {
      expect(mapped.has(cp), `Devanagari ${String.fromCodePoint(cp)}`).toBe(true);
    }
    for (const cp of inBlock(ODIA, 0x0b00, 0x0b7f)) {
      expect(mapped.has(cp), `Odia ${String.fromCodePoint(cp)}`).toBe(true);
    }
  });
});
