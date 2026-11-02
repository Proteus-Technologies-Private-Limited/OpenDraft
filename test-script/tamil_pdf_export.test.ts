/**
 * Tamil in an exported PDF — the Play Store report: "OpenDraft works well while
 * typing Tamil, but when exporting as PDF, the Tamil text becomes corrupted".
 *
 * Writes test-script/output/tamil.pdf for rendering and eyeballing.
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

const FONT_ROOT = join(__dirname, '..', 'frontend', 'public');
const OUT = join(__dirname, 'output');

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

const text = (s: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: s, ...(marks ? { marks } : {}) });

export const TAMIL_LINES = [
  'எப்போது வருவாய்? நான் உன்னை எதிர்பார்த்துக் கொண்டிருக்கிறேன்.',
  'அவள் கொடுத்த புத்தகத்தை மேசையில் வைத்தாள்.',
  'கு கூ டு டூ ரு ரூ ணு ணூ ஞு ஞூ டி டீ ஸ்ரீ க்ஷ',
  'பெண் பேச்சு பைத்தியம் கொ கோ கௌ செல்லும் வேண்டும்',
];

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('உள். வீடு - பகல்')] },
    ...TAMIL_LINES.map((line) => ({ type: 'action', content: [text(line)] })),
    { type: 'character', content: [text('முருகன்')] },
    { type: 'dialogue', content: [text(TAMIL_LINES[0])] },
    { type: 'action', content: [text(TAMIL_LINES[1], [{ type: 'bold' }])] },
  ],
};

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');

describe('a Tamil script', () => {
  it('exports with nothing missing', async () => {
    saved.length = 0;
    const result = await exportPDF(doc, 'Tamil', DEFAULT_PAGE_LAYOUT);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'tamil.pdf'), Buffer.from(saved[0]));
    console.log('export result', JSON.stringify(result));
    expect(saved.length).toBe(1);
  });
});
