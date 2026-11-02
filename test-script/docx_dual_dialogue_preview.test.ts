/**
 * Writes a .docx with dual dialogue through the real exporter, for a visual
 * check in Word or LibreOffice. Run from frontend/:
 *   npx vitest run --config ../test-script/vitest.docx-preview.config.ts
 * Output: test-script/output/docx-dual/dual-dialogue.docx
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const saved = vi.hoisted(() => ({ bytes: null as Uint8Array | null }));
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: async (data: Uint8Array) => { saved.bytes = data; return true; },
}));
import { exportDocx } from '../frontend/src/utils/docxExporter';
import { parseDocx } from '../frontend/src/utils/docxImporter';

const p = (type: string, text: string, marks?: string[]) => ({
  type, content: [{ type: 'text', text, ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}) }],
});

it('writes a dual-dialogue docx', async () => {
  Object.assign(globalThis, { DOMParser: XmlDOMParser });
  const doc = {
    type: 'doc',
    content: [
      p('sceneHeading', 'INT. KITCHEN - NIGHT'),
      p('action', 'Two voices, one argument.'),
      {
        type: 'dualDialogue',
        content: [
          { type: 'dualDialogueColumn', content: [p('character', 'SARAH'), p('parenthetical', '(furious)'), p('dialogue', 'You read my letter. You had no right to read it.')] },
          { type: 'dualDialogueColumn', content: [p('character', 'TOM'), p('dialogue', 'It was addressed to both of us!', ['bold'])] },
        ],
      },
      p('action', 'Silence. The kettle screams.'),
    ],
  };
  await exportDocx(doc as any, 'Dual', DEFAULT_PAGE_LAYOUT);
  const out = join(__dirname, 'output/docx-dual/dual-dialogue.docx');
  writeFileSync(out, saved.bytes!);
  const back = await parseDocx(saved.bytes!.buffer.slice(0) as ArrayBuffer);
  writeFileSync(join(__dirname, 'output/docx-dual/reimported.json'), JSON.stringify(back.doc, null, 2));
  console.log('[docx-preview] wrote', out);
});
