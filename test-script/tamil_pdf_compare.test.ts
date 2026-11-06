/**
 * Before/after check for issue #226: does the colour/highlight change disturb
 * Tamil PDF export?
 *
 * Copied into <tree>/frontend/src/utils/ as __tamilcmp.test.ts and run there
 * (vitest only collects src/**), once against the committed code and once
 * against the working tree. Writes each PDF to $TAMIL_OUT/<name>.pdf, which
 * test-script/tamil_pdf_compare.py then diffs.
 *
 * Uses the real jsPDF and HarfBuzz with the bundled fonts, as
 * pdfExporter.tamil.test.ts does.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

const OUT = process.env.TAMIL_OUT;
if (!OUT) throw new Error('set TAMIL_OUT to the output folder');
mkdirSync(OUT, { recursive: true });

const saved: Uint8Array[] = [];
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(process.cwd(), 'public', url));
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    } catch {
      return { ok: false };
    }
  }));
});

type Mark = { type: string; attrs?: Record<string, unknown> };
const t = (text: string, ...marks: Mark[]): JSONContent => (marks.length ? { type: 'text', text, marks } : { type: 'text', text });
const red: Mark = { type: 'textStyle', attrs: { color: '#ff0000' } };
const blue: Mark = { type: 'textStyle', attrs: { color: '#0066ff' } };
const yellow: Mark = { type: 'highlight', attrs: { color: '#ffff66' } };
const orange: Mark = { type: 'highlight', attrs: { color: '#ffcc66' } };

/** The script pdfExporter.tamil.test.ts uses, unformatted. */
const plain: JSONContent = { type: 'doc', content: [
  { type: 'sceneHeading', content: [t('உள். வீடு - பகல்')] },
  { type: 'action', content: [t('எப்போது வருவாய் நான் உன்னை எதிர்பார்த்துக் கொண்டிருக்கிறேன்')] },
  { type: 'character', content: [t('முருகன்')] },
  { type: 'dialogue', content: [t('அவள் கொடுத்த புத்தகத்தை மேசையில் வைத்தாள்')] },
]};

/** Whole Tamil words formatted, the way a writer selects them. */
const formatted: JSONContent = { type: 'doc', content: [
  { type: 'sceneHeading', content: [t('உள். வீடு - பகல்')] },
  { type: 'action', content: [
    t('எப்போது '), t('வருவாய்', red), t(' நான் '), t('உன்னை', yellow), t(' '),
    t('எதிர்பார்த்துக்', { type: 'bold' }), t(' '), t('கொண்டிருக்கிறேன்', blue, { type: 'underline' }),
  ]},
  { type: 'action', content: [t('அவன் '), t('போனான்', { type: 'strike' }), t(' '), t('குருவி பறந்தது', red, orange)] },
  { type: 'character', content: [t('முருகன்')] },
  { type: 'dialogue', content: [t('அவள் '), t('கொடுத்த புத்தகத்தை', orange), t(' மேசையில் '), t('வைத்தாள்', { type: 'italic' })] },
]};

/** A colour that starts inside a word, splitting a syllable cluster. */
const midWord: JSONContent = { type: 'doc', content: [
  { type: 'action', content: [t('கொண்டி'), t('ருக்கிறேன்', red), t(' எப்போ'), t('து', yellow)] },
]};

/** Mixed Tamil and Latin on one line, both coloured. */
const mixed: JSONContent = { type: 'doc', content: [
  { type: 'action', content: [t('MURUGAN ', red), t('வருவாய்', red), t(' and '), t('OK', yellow), t(' நான்', yellow)] },
]};

const cases: Record<string, { doc: JSONContent; textColors?: boolean }> = {
  'plain': { doc: plain },
  'formatted': { doc: formatted },
  'formatted-colours-off': { doc: formatted, textColors: false },
  'midword': { doc: midWord },
  'mixed': { doc: mixed },
};

describe('Tamil PDF before/after', async () => {
  const { exportPDF } = await import('./pdfExporter');
  for (const [name, c] of Object.entries(cases)) {
    it(name, async () => {
      saved.length = 0;
      const options = c.textColors === undefined ? undefined : { textColors: c.textColors };
      expect(await exportPDF(c.doc, 'Test', DEFAULT_PAGE_LAYOUT, options)).toBeUndefined();
      writeFileSync(join(OUT, `${name}.pdf`), saved[0]);
    });
  }
});

describe('Tamil Word before/after', async () => {
  const { exportDocx } = await import('./docxExporter');
  for (const name of ['plain', 'formatted', 'midword', 'mixed']) {
    it(`${name}.docx`, async () => {
      saved.length = 0;
      await exportDocx(cases[name].doc, 'Test', DEFAULT_PAGE_LAYOUT);
      writeFileSync(join(OUT, `${name}.docx`), saved[0]);
    });
  }
});
