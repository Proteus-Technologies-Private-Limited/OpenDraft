/**
 * Writes the two Word exports for the highlight fix (#226 follow-up) to disk,
 * so they can be opened in Microsoft Word and the highlighter tried on them.
 *
 * Copied into frontend/src/utils/ as __wordhl.test.ts and run there (vitest
 * only collects src/**). Writes $WORD_HL_OUT/highlights-word.docx (default:
 * Word's own highlights) and highlights-exact.docx (exact-colour shading).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { doc, block } from '../test/screenplaySchema';

const OUT = process.env.WORD_HL_OUT;
if (!OUT) throw new Error('set WORD_HL_OUT to the output folder');
mkdirSync(OUT, { recursive: true });

const saved: Uint8Array[] = [];
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const hl = (text: string, color: string) => ({ type: 'text', text, marks: [{ type: 'highlight', attrs: { color } }] });
const script = doc(block('action',
  hl('Pale yellow words.', '#ffe599'), ' ',
  hl('Sky blue words.', '#66ccff'), ' ',
  hl('Orange words.', '#ff6600'), ' Plain words.'));

describe('write Word highlight exports', () => {
  for (const [name, exactHighlights] of [['highlights-word', false], ['highlights-exact', true]] as const) {
    it(name, async () => {
      const { exportDocx } = await import('./docxExporter');
      const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
      saved.length = 0;
      await exportDocx(script, name, DEFAULT_PAGE_LAYOUT, { exactHighlights });
      expect(saved).toHaveLength(1);
      writeFileSync(join(OUT, `${name}.docx`), saved[0]);
    });
  }
});
