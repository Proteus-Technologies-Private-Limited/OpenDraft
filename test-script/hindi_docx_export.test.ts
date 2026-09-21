/**
 * Does the DOCX export carry Hindi?
 *
 * Word picks a run's font per script: `w:ascii` for Latin, `w:cs` for complex
 * scripts such as Devanagari.  A run that names only a Latin face leaves Word
 * to guess, and `w:cs` pointing at a face with no Devanagari draws nothing.
 * This dumps the rPr the exporter actually writes.
 *
 * @vitest-environment node
 */
import { describe, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const saved: Uint8Array[] = [];
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const text = (s: string): JSONContent => ({ type: 'text', text: s });
const HINDI = 'जीवन से भरी तेरी आँखें';

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'action', content: [text('test')] },
    { type: 'action', content: [text(HINDI)] },
  ],
};

const { exportDocx } = await import('../frontend/src/utils/docxExporter');

describe('the Hindi DOCX', () => {
  for (const font of [undefined, 'Roboto']) {
    it(`writes its runs with documentFont=${font ?? '(none)'}`, async () => {
      saved.length = 0;
      await exportDocx(doc, 'HindiDocx', DEFAULT_PAGE_LAYOUT, font ? { documentFont: font } : undefined);
      const bytes = Buffer.from(saved[0]);
      mkdirSync(join(process.cwd(), 'test-script', 'output'), { recursive: true });
      writeFileSync(join(process.cwd(), 'test-script', 'output', `hindi-${font ?? 'default'}.docx`), bytes);

      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file('word/document.xml')!.async('string');
      const hit = xml.indexOf(HINDI.slice(0, 6));
      console.log(`\n[repro] documentFont=${font ?? '(none)'}`);
      console.log('[repro] Hindi present in document.xml:', hit >= 0);
      console.log('[repro] run xml around it:\n', xml.slice(Math.max(0, hit - 400), hit + 120));
      const fonts = [...xml.matchAll(/<w:rFonts[^>]*\/>/g)].map((m) => m[0]);
      console.log('[repro] distinct rFonts:', [...new Set(fonts)].join('\n  '));
    });
  }
});
