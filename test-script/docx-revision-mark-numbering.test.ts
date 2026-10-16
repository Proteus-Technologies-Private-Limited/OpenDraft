/**
 * Writes the same revised dialogue line to Word twice — once plain, once with
 * an element number — so the two can be opened side by side in Word and the
 * revision asterisk's position compared.
 *
 * Run from `frontend/`:
 *   npx vitest run --config ../test-script/vitest.config.ts docx-revision-mark-numbering
 * Output: test-script/output/element-numbering/rev-{plain,numbered}.docx
 *
 * @vitest-environment node
 */
import { describe, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';

const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: (data: Uint8Array) => { saved.buf = data; return Promise.resolve(true); },
}));

const { exportDocx } = await import('../frontend/src/utils/docxExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../frontend/src/stores/editorStore');
const { withElementNumbers } = await import('../frontend/src/utils/elementNumbers');

const OUT = join(__dirname, 'output', 'element-numbering');
const rev = (text: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { revision: 'Blue' } }] });
const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'character', content: [{ type: 'text', text: 'KEEPER' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Who goes there? ' }, rev('Show yourself.')] },
    { type: 'character', content: [{ type: 'text', text: 'HOST' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'A long line that wraps onto a second line of dialogue, ' }, rev('revised at the end.')] },
  ],
};

describe('revision mark beside a numbered paragraph', () => {
  it('writes both files', async () => {
    mkdirSync(OUT, { recursive: true });
    for (const [name, d] of [
      ['rev-plain', doc],
      ['rev-numbered', withElementNumbers(doc, { visible: true, sceneNumbersVisible: false, rules: { dialogue: { enabled: true, resetOn: [] } } })],
    ] as const) {
      saved.buf = null;
      await exportDocx(d, name, DEFAULT_PAGE_LAYOUT);
      if (!saved.buf) throw new Error(`${name}: nothing written`);
      writeFileSync(join(OUT, `${name}.docx`), saved.buf);
    }
  });
});
