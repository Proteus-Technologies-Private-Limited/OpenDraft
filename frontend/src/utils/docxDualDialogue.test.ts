import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
const saved = vi.hoisted(() => ({ bytes: null as Uint8Array | null }));
vi.mock('./fileOps', () => ({
  saveFile: async (data: Uint8Array) => {
    saved.bytes = data;
    return true;
  },
}));
import { exportDocx } from './docxExporter';
import { parseDocx } from './docxImporter';
beforeAll(() => {
  Object.assign(globalThis, { DOMParser: XmlDOMParser });
});
const block = (
  type: string,
  text: string,
  attrs?: Record<string, unknown>,
): JSONContent => ({
  type,
  attrs,
  content: text ? [{ type: 'text', text }] : [],
});
const speech = (name: string, words: string): JSONContent[] => [
  block('character', name),
  block('parenthetical', '(overlapping)'),
  block('dialogue', words),
];
const dual = (
  left: JSONContent[],
  right: JSONContent[],
  attrs?: Record<string, unknown>,
): JSONContent => ({
  type: 'dualDialogue',
  attrs,
  content: [
    { type: 'dualDialogueColumn', content: left },
    { type: 'dualDialogueColumn', content: right },
  ],
});
const doc = (...nodes: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: [block('sceneHeading', 'INT. STUDIO - DAY'), ...nodes],
});
async function output(source: JSONContent) {
  await exportDocx(source, 'Dialogue', DEFAULT_PAGE_LAYOUT);
  const bytes = saved.bytes!;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  return {
    bytes,
    xml,
    dom: new XmlDOMParser().parseFromString(xml, 'application/xml'),
  };
}
const tags = (el: Document | Element, name: string) =>
  Array.from(
    el.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      name,
    ),
  );
describe('DOCX dual dialogue', () => {
  it('writes both speeches in two side-by-side cells and reads them back as dual dialogue', async () => {
    const { bytes, dom } = await output(
      doc(
        dual(
          speech('MARA', 'We should leave now.'),
          speech('JONAH', 'Not until the others return.'),
        ),
      ),
    );
    const tables = tags(dom as unknown as Document, 'tbl');
    expect(tables).toHaveLength(1);
    const cells = tags(tables[0] as unknown as Element, 'tc');
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toContain('MARA');
    expect(cells[0].textContent).toContain('We should leave now.');
    expect(cells[1].textContent).toContain('JONAH');
    expect(cells[1].textContent).toContain('Not until the others return.');
    const imported = await parseDocx(bytes.slice().buffer as ArrayBuffer);
    const restored = imported.doc.content?.find(
      (node) => node.type === 'dualDialogue',
    );
    expect(restored).toBeDefined();
    expect(restored!.content).toHaveLength(2);
    expect(JSON.stringify(restored!.content![0])).toContain(
      'We should leave now.',
    );
    expect(JSON.stringify(restored!.content![1])).toContain(
      'Not until the others return.',
    );
  });
  it('keeps inline emphasis, font, hard breaks, parentheticals and revision marks', async () => {
    const dialogue: JSONContent = {
      type: 'dialogue',
      attrs: { revised: 'Blue' },
      content: [
        {
          type: 'text',
          text: 'Quietly',
          marks: [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'strike' },
            { type: 'textStyle', attrs: { fontFamily: 'Georgia' } },
          ],
        },
        { type: 'hardBreak' },
        { type: 'text', text: 'then louder.' },
      ],
    };
    const { xml, dom } = await output(
      doc(
        dual(
          [
            block('character', 'SARAH'),
            block('parenthetical', '(quietly)'),
            dialogue,
          ],
          speech('JONAH', 'Wait.'),
        ),
      ),
    );
    for (const marker of ['w:b', 'w:i', 'w:u', 'w:strike', 'w:br'])
      expect(xml).toContain(`<${marker}`);
    expect(xml).toContain('Georgia');
    expect(xml).toContain('(quietly)');
    expect(xml).toContain('then louder.');
    const left = tags(
      tags(dom as unknown as Document, 'tbl')[0] as unknown as Element,
      'tc',
    )[0];
    const tabs = tags(left as unknown as Element, 'tab').filter((el) =>
      el.hasAttribute('w:pos'),
    );
    expect(tabs.length).toBeGreaterThan(0);
    expect(left.textContent).toContain('*');
    expect(tabs.every((el) => Number(el.getAttribute('w:pos')) <= 5000)).toBe(
      true,
    );
  });
  it('uses equal columns inside current page margins and allows long rows to paginate', async () => {
    const source = doc(
      dual(
        speech('MARA', 'Long speech. '.repeat(1000)),
        speech('JONAH', 'Short reply.'),
      ),
    );
    const layout = {
      ...DEFAULT_PAGE_LAYOUT,
      pageWidth: 8.5,
      leftMargin: 1.25,
      rightMargin: 1.25,
    };
    await exportDocx(source, 'Long', layout);
    const xml = await (await JSZip.loadAsync(saved.bytes!))
      .file('word/document.xml')!
      .async('string');
    const tree = new XmlDOMParser().parseFromString(xml, 'application/xml');
    const widths = tags(tree as unknown as Document, 'gridCol').map((el) =>
      Number(el.getAttribute('w:w')),
    );
    expect(widths).toEqual([4320, 4320]);
    expect(xml).not.toContain('<w:cantSplit/>');
    expect(xml).toContain('Long speech.');
    expect(xml).toContain('Short reply.');
  });
  it('does not accumulate layout separator paragraphs on repeated round trips', async () => {
    let source = doc(
      dual(speech('MARA', 'First.'), speech('JONAH', 'Second.')),
      block('action', 'The conversation ends.'),
    );
    const count = source.content!.length;
    for (let pass = 0; pass < 3; pass++) {
      const { bytes } = await output(source);
      source = (await parseDocx(bytes.slice().buffer as ArrayBuffer)).doc;
      expect(source.content).toHaveLength(count);
      expect(JSON.stringify(source)).toContain('The conversation ends.');
    }
  });
  it('keeps a forced page break before the entire exchange', async () => {
    const { dom } = await output(
      doc(
        dual(speech('MARA', 'First.'), speech('JONAH', 'Second.'), {
          startsNewPage: true,
        }),
      ),
    );
    const table = tags(dom as unknown as Document, 'tbl')[0];
    const preceding = table.previousSibling as Element;
    expect(tags(preceding, 'pageBreakBefore')).toHaveLength(1);
  });
  it('separates consecutive exchanges and exports an empty column without dropping the other', async () => {
    const { dom, bytes } = await output(
      doc(
        dual([], speech('JONAH', 'Only the right side.')),
        dual(speech('SARAH', 'Another exchange.'), []),
      ),
    );
    const imported = await parseDocx(bytes.slice().buffer as ArrayBuffer);
    const exchanges =
      imported.doc.content?.filter((node) => node.type === 'dualDialogue') ??
      [];
    expect(exchanges).toHaveLength(2);
    for (const exchange of exchanges)
      for (const column of exchange.content ?? [])
        expect(
          column.content?.every((node) =>
            ['character', 'dialogue', 'parenthetical'].includes(node.type!),
          ),
        ).toBe(true);
    expect(tags(dom as unknown as Document, 'tbl')).toHaveLength(2);
    expect(dom.documentElement!.textContent).toContain('Only the right side.');
    expect(dom.documentElement!.textContent).toContain('Another exchange.');
    for (const cell of tags(dom as unknown as Document, 'tc'))
      expect(tags(cell as unknown as Element, 'p').length).toBeGreaterThan(0);
  });
});
