/**
 * PDF import, end to end: scripts laid out by this app's own PDF exporter (the
 * real jsPDF, not a stub) are read back by pdf.js and must come out as the
 * elements that went in. Plus the classifier on hand-made pages, for layouts
 * other applications print.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { JSONContent } from '@tiptap/react';

/** jsPDF binds atob/btoa off `window` at load; the suite's `window` is a stub. */
const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const { renderPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { parsePdfScreenplay, screenplayFromPdfPages, groupIntoLines } = await import('./pdfImport');
const { buildTitlePageBlocks } = await import('./titlePageBlocks');
const { parseFountain } = await import('./fountainParser');

const t = (text: string): JSONContent[] => [{ type: 'text', text }];
const el = (type: string, text: string, attrs?: Record<string, unknown>): JSONContent =>
  ({ type, content: t(text), ...(attrs ? { attrs } : {}) });

const bodyOf = (doc: JSONContent) => (doc.content ?? []).filter((n) => n.type !== 'titlePage');
const summary = (nodes: JSONContent[]) => nodes.map((n) => {
  if (n.type === 'dualDialogue') {
    return `dualDialogue[${(n.content ?? []).map((col) => (col.content ?? []).map((c) => `${c.type}:${c.content?.[0]?.text ?? ''}`).join('|')).join(' / ')}]`;
  }
  return `${n.type}:${n.content?.map((c) => c.text).join('') ?? ''}`;
});

async function roundTrip(doc: JSONContent, options: Parameters<typeof renderPDF>[3] = {}) {
  const { bytes } = await renderPDF(doc, 'Test', DEFAULT_PAGE_LAYOUT, options);
  return parsePdfScreenplay(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe('reading back a PDF this app wrote', () => {
  const script: JSONContent = {
    type: 'doc',
    content: [
      el('sceneHeading', 'INT. KITCHEN - NIGHT'),
      el('action', 'Rain hammers the window. MAYA, thirties, stirs a pot that has long since boiled dry, staring at nothing at all.'),
      el('character', 'MAYA'),
      el('parenthetical', '(not turning)'),
      el('dialogue', 'You came back.'),
      el('character', 'DEV (O.S.)'),
      el('dialogue', 'I never left. Not really. You know that better than anyone.'),
      el('transition', 'CUT TO:'),
      el('sceneHeading', 'EXT. ROOFTOP - CONTINUOUS'),
      el('action', 'Dev stands at the edge.'),
    ],
  };

  it('recovers every element type and its text', async () => {
    const { doc, warnings } = await roundTrip(script);
    expect(warnings).toEqual([]);
    expect(summary(bodyOf(doc))).toEqual(summary(script.content!));
  });

  it('takes scene numbers off the margins and keeps them on the heading', async () => {
    const numbered: JSONContent = {
      type: 'doc',
      content: [
        el('sceneHeading', 'INT. KITCHEN - NIGHT', { sceneNumber: '12' }),
        el('action', 'Rain.'),
        el('sceneHeading', 'EXT. ROOFTOP - DAY', { sceneNumber: '12A' }),
        el('action', 'Wind.'),
      ],
    };
    const { doc } = await roundTrip(numbered, { sceneNumbersVisible: true });
    const headings = bodyOf(doc).filter((n) => n.type === 'sceneHeading');
    expect(headings.map((h) => h.content?.[0]?.text)).toEqual(['INT. KITCHEN - NIGHT', 'EXT. ROOFTOP - DAY']);
    expect(headings.map((h) => h.attrs?.sceneNumber)).toEqual(['12', '12A']);
  });

  it('reads the title page into its fields', async () => {
    const withTitle: JSONContent = {
      type: 'doc',
      content: [
        ...(buildTitlePageBlocks({ tpTitle: 'THE LONG RAIN', tpWrittenBy: 'Asha Rao', tpContact: 'asha@example.com' }) as JSONContent[]),
        el('sceneHeading', 'INT. KITCHEN - NIGHT'),
        el('action', 'Rain.'),
      ],
    };
    const { doc, title } = await roundTrip(withTitle);
    expect(title).toBe('THE LONG RAIN');
    const titleNode = doc.content?.find((n) => n.type === 'titlePage' && n.attrs?.field === 'title');
    expect(titleNode?.attrs?.tpTitle).toBe('THE LONG RAIN');
    expect(titleNode?.attrs?.tpWrittenBy).toBe('Asha Rao');
    expect(String(titleNode?.attrs?.tpContact)).toContain('asha@example.com');
    expect(summary(bodyOf(doc))).toEqual(['sceneHeading:INT. KITCHEN - NIGHT', 'action:Rain.']);
  });

  it('joins a speech that (MORE) carried over a page, without the repeated cue', async () => {
    const filler = Array.from({ length: 52 }, (_, i) => el('action', `Beat ${i + 1}.`));
    const long = Array.from({ length: 6 }, (_, i) => el('dialogue', `Paragraph ${i + 1} of a speech that goes on and on across the turn of the page.`));
    const doc: JSONContent = { type: 'doc', content: [el('sceneHeading', 'INT. HALL - DAY'), ...filler, el('character', 'MAYA'), ...long] };
    const result = await roundTrip(doc);
    const body = summary(bodyOf(result.doc));
    expect(body.filter((s) => s.startsWith('character:'))).toEqual(['character:MAYA']);
    expect(body.filter((s) => s.startsWith('dialogue:'))).toHaveLength(6);
    expect(body.join('\n')).not.toMatch(/MORE|CONT/);
  });

  it('reads two speeches side by side as dual dialogue', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        el('sceneHeading', 'INT. KITCHEN - NIGHT'),
        {
          type: 'dualDialogue',
          content: [
            { type: 'dualDialogueColumn', content: [el('character', 'MAYA'), el('dialogue', 'Now.')] },
            { type: 'dualDialogueColumn', content: [el('character', 'DEV'), el('dialogue', 'Not yet.')] },
          ],
        },
        el('action', 'Silence.'),
      ],
    };
    const result = await roundTrip(doc);
    expect(summary(bodyOf(result.doc))).toEqual([
      'sceneHeading:INT. KITCHEN - NIGHT',
      'dualDialogue[character:MAYA|dialogue:Now. / character:DEV|dialogue:Not yet.]',
      'action:Silence.',
    ]);
  });

  it('ignores revision marks and a diagonal watermark', async () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        el('sceneHeading', 'INT. KITCHEN - NIGHT'),
        { type: 'action', content: [{ type: 'text', text: 'A revised line.', marks: [{ type: 'textStyle', attrs: { revision: 'Blue' } }] }] },
      ],
    };
    const result = await roundTrip(doc, { watermark: { text: 'CONFIDENTIAL' } });
    expect(summary(bodyOf(result.doc))).toEqual(['sceneHeading:INT. KITCHEN - NIGHT', 'action:A revised line.']);
  });

  it('opens a password-protected PDF only with a message', async () => {
    const { bytes } = await renderPDF(
      { type: 'doc', content: [el('action', 'Secret.')] }, 'Test', DEFAULT_PAGE_LAYOUT,
      { security: { userPassword: 'hunter2' } },
    );
    await expect(parsePdfScreenplay(bytes.slice().buffer as ArrayBuffer)).rejects.toThrow(/password/);
  });
});

describe('the export golden scripts survive PDF and back', () => {
  /** What a reader sees of each element: its type, its words and its scene number. */
  const visible = (nodes: JSONContent[]): string[] => nodes.flatMap((n): string[] => {
    if (['titlePage', 'section', 'note'].includes(n.type ?? '')) return [];
    if (n.type === 'dualDialogue') {
      return [`dual:${(n.content ?? []).map((col) => (col.content ?? []).map((c) => `${c.type}:${c.content?.map((x) => x.text).join('') ?? ''}`).join('|')).join(' / ')}`];
    }
    const text = (n.content ?? []).map((c) => c.text ?? '').join('').replace(/\s+/g, ' ').trim();
    // Blank paragraphs print as nothing, so nothing comes back for them.
    if (!text && n.type !== 'sceneHeading') return [];
    const number = n.type === 'sceneHeading' && n.attrs?.sceneNumber ? ` #${n.attrs.sceneNumber}` : '';
    return [`${n.type}:${text}${number}`];
  });

  for (const name of ['feature', 'split-speech', 'dual-dialogue', 'revisions', 'locked-omitted-scenes', 'multicam-sitcom']) {
    it(name, async () => {
      const source = parseFountain(readFileSync(new URL(`./__snapshots__/exportGolden/${name}.fountain`, import.meta.url), 'utf8'));
      const { doc } = await roundTrip(source, { sceneNumbersVisible: true });
      expect(visible(doc.content ?? [])).toEqual(visible(source.content ?? []));
    });
  }
});

describe('classifying layouts other applications print', () => {
  const inch = 72;
  /** One line of a page, at a left indent in inches and a line number from the top. */
  const line = (lineNo: number, xIn: number, text: string) => ({
    x: xIn * inch, y: inch + lineNo * 12, width: text.length * 7.2, fontSize: 12, str: text,
  });

  it('reads Final Draft indents (cue at 3.7in, parenthetical at 3.1in)', () => {
    const lines = groupIntoLines([
      line(0, 1.5, 'INT. OFFICE - DAY'),
      line(2, 1.5, 'Papers everywhere.'),
      line(4, 3.7, 'BOSS'),
      line(5, 3.1, '(quietly)'),
      line(6, 2.5, 'Sit down.'),
      line(8, 6.4, 'CUT TO:'),
      line(10, 1.5, 'EXT. STREET - NIGHT'),
      line(12, 1.5, 'Empty.'),
      line(14, 4.0, 'THE END'),
    ]);
    const { doc } = screenplayFromPdfPages([{ width: 8.5 * inch, height: 11 * inch, lines }]);
    expect(summary(doc.content!)).toEqual([
      'sceneHeading:INT. OFFICE - DAY',
      'action:Papers everywhere.',
      'character:BOSS',
      'parenthetical:(quietly)',
      'dialogue:Sit down.',
      'transition:CUT TO:',
      'sceneHeading:EXT. STREET - NIGHT',
      'action:Empty.',
      'action:THE END',
    ]);
    expect(doc.content![8].attrs?.textAlign).toBe('center');
  });

  it('reports where each paragraph sat, in step with the document', () => {
    const lines = groupIntoLines([
      line(0, 1.5, 'INT. OFFICE - DAY'),
      line(2, 1.5, 'Papers everywhere.'),
      line(4, 3.7, 'BOSS'),
      line(5, 2.5, 'Sit down.'),
    ]);
    const { doc, layout } = screenplayFromPdfPages([{ width: 8.5 * inch, height: 11 * inch, lines }]);
    expect(layout).toHaveLength(doc.content!.length);
    expect(layout).toEqual([
      { page: 1, indent: 0 },
      { page: 1, indent: 0 },
      { page: 1, indent: 2.2 },
      { page: 1, indent: 1 },
    ]);
  });

  it('joins wrapped lines of one paragraph and keeps blank-line paragraphs apart', () => {
    const lines = groupIntoLines([
      line(0, 1.5, 'First line of action that'),
      line(1, 1.5, 'wraps onto a second.'),
      line(3, 1.5, 'A new paragraph.'),
      line(5, 3.7, 'ANA'),
      line(6, 2.5, 'One speech that'),
      line(7, 2.5, 'wraps too.'),
    ]);
    const { doc } = screenplayFromPdfPages([{ width: 8.5 * inch, height: 11 * inch, lines }]);
    expect(summary(doc.content!)).toEqual([
      'action:First line of action that wraps onto a second.',
      'action:A new paragraph.',
      'character:ANA',
      'dialogue:One speech that wraps too.',
    ]);
  });

  it('drops a CONT\'D a cue was printed with', () => {
    const lines = groupIntoLines([
      line(0, 3.7, "ANA (CONT'D)"),
      line(1, 2.5, 'Again.'),
    ]);
    const { doc } = screenplayFromPdfPages([{ width: 8.5 * inch, height: 11 * inch, lines }]);
    expect(summary(doc.content!)).toEqual(['character:ANA', 'dialogue:Again.']);
  });

  it('refuses a PDF with no text', () => {
    expect(() => screenplayFromPdfPages([{ width: 612, height: 792, lines: [] }])).toThrow(/no text/);
  });
});
