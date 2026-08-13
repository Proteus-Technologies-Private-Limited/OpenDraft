import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { exportOSF, exportFadeIn } from './osfExporter';
import { parseOSF, parseFadeIn } from './osfParser';
import type { JSONContent } from '@tiptap/react';

/**
 * The exporter's job is to be read back correctly — by OpenDraft first of all,
 * since a .fadein opened in place is saved through this writer. So the tests
 * are round-trips: write it, parse it, and check the script survived.
 */

const text = (value: string) => ({ type: 'text', text: value });

function docOf(...nodes: JSONContent[]): JSONContent {
  return { type: 'doc', content: nodes };
}

/** Element types in order, ignoring the title page. */
function typesOf(doc: JSONContent): string[] {
  return (doc.content ?? []).filter((n) => n.type !== 'titlePage').map((n) => n.type as string);
}

function flatText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(flatText).join('');
}

// The suite runs without a DOM; the parser needs a DOMParser that produces
// element nodes with children and attributes, which @xmldom/xmldom provides.
beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
  }
});

describe('osfExporter', () => {
  it('round-trips the screenplay elements', () => {
    const doc = docOf(
      { type: 'sceneHeading', content: [text('INT. OFFICE - DAY')] },
      { type: 'action', content: [text('A desk, a lamp, a deadline.')] },
      { type: 'character', content: [text('WRITER')] },
      { type: 'parenthetical', content: [text('(muttering)')] },
      { type: 'dialogue', content: [text('One more page.')] },
      { type: 'transition', content: [text('CUT TO:')] },
      { type: 'shot', content: [text('ANGLE ON THE CLOCK')] },
    );

    const parsed = parseOSF(exportOSF(doc));

    expect(typesOf(parsed.doc)).toEqual([
      'sceneHeading',
      'action',
      'character',
      'parenthetical',
      'dialogue',
      'transition',
      'shot',
    ]);
    expect(parsed.doc.content!.map(flatText)).toContain('One more page.');
  });

  // OSF stores a parenthetical bare and the parser adds the brackets back.
  // Writing them as well would compound on every save: ((muttering)).
  it('does not double-bracket a parenthetical across a save cycle', () => {
    const doc = docOf({ type: 'parenthetical', content: [text('(beat)')] });

    let current = doc;
    for (let i = 0; i < 3; i++) {
      current = parseOSF(exportOSF(current)).doc as JSONContent;
    }

    const para = (current.content ?? []).find((n) => n.type === 'parenthetical');
    expect(flatText(para!)).toBe('(beat)');
  });

  it('round-trips inline formatting', () => {
    const doc = docOf({
      type: 'action',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' plain ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'under', marks: [{ type: 'underline' }] },
      ],
    });

    const back = parseOSF(exportOSF(doc)).doc.content!.find((n) => n.type === 'action')!;
    const marksOn = (value: string) =>
      (back.content ?? [])
        .filter((r) => r.text === value)
        .flatMap((r) => (r.marks ?? []).map((m) => m.type));

    expect(marksOn('bold')).toContain('bold');
    expect(marksOn('italic')).toContain('italic');
    expect(marksOn('under')).toContain('underline');
    expect(flatText(back)).toBe('bold plain italic and under');
  });

  it('round-trips a hard line break inside a paragraph', () => {
    const doc = docOf({
      type: 'action',
      content: [text('first line'), { type: 'hardBreak' }, text('second line')],
    });

    const back = parseOSF(exportOSF(doc)).doc.content!.find((n) => n.type === 'action')!;
    expect((back.content ?? []).some((n) => n.type === 'hardBreak')).toBe(true);
    expect(flatText(back)).toBe('first line\nsecond line');
  });

  it('round-trips scene numbers, synopses, alignment and forced page breaks', () => {
    const doc = docOf(
      {
        type: 'sceneHeading',
        attrs: { sceneNumber: '12A', synopsis: 'The turn', startsNewPage: true },
        content: [text('EXT. ROOFTOP - NIGHT')],
      },
      { type: 'action', attrs: { textAlign: 'center' }, content: [text('centred')] },
    );

    const back = parseOSF(exportOSF(doc)).doc.content!;
    const heading = back.find((n) => n.type === 'sceneHeading')!;
    expect(heading.attrs?.sceneNumber).toBe('12A');
    expect(heading.attrs?.synopsis).toBe('The turn');
    expect(heading.attrs?.startsNewPage).toBe(true);
    expect(back.find((n) => n.type === 'action')!.attrs?.textAlign).toBe('center');
  });

  it('round-trips dual dialogue', () => {
    const speech = (name: string, line: string) => [
      { type: 'character', content: [text(name)] },
      { type: 'dialogue', content: [text(line)] },
    ];
    const doc = docOf({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: speech('ANNA', 'Left.') },
        { type: 'dualDialogueColumn', content: speech('BEN', 'Right.') },
      ],
    });

    const back = parseOSF(exportOSF(doc)).doc.content!.find((n) => n.type === 'dualDialogue');
    expect(back).toBeTruthy();
    expect(flatText(back!)).toContain('Left.');
    expect(flatText(back!)).toContain('Right.');
  });

  it('round-trips the title page', () => {
    const doc = docOf(
      {
        type: 'titlePage',
        attrs: {
          tpTitle: 'THE LAST DRAFT',
          tpWrittenBy: 'A. Writer',
          tpContact: 'a@example.com',
        },
        content: [text('THE LAST DRAFT')],
      },
      { type: 'action', content: [text('FADE IN:')] },
    );

    const parsed = parseOSF(exportOSF(doc));
    const tp = parsed.doc.content!.find((n) => n.type === 'titlePage');
    expect(tp?.attrs?.tpTitle).toBe('THE LAST DRAFT');
    expect(tp?.attrs?.tpWrittenBy).toBe('A. Writer');
    expect(tp?.attrs?.tpContact).toBe('a@example.com');
    expect(parsed.scriptTitle).toBe('THE LAST DRAFT');
  });

  it('escapes markup in the text rather than emitting it', () => {
    const doc = docOf({ type: 'action', content: [text('a < b & c > d "quoted"')] });
    const xml = exportOSF(doc);

    expect(xml).not.toContain('<text>a < b');
    expect(flatText(parseOSF(xml).doc.content![0])).toBe('a < b & c > d "quoted"');
  });

  it('writes a .fadein archive the parser can read', async () => {
    const doc = docOf(
      { type: 'sceneHeading', content: [text('INT. ARCHIVE - NIGHT')] },
      { type: 'action', content: [text('Zipped and delivered.')] },
    );

    const bytes = await exportFadeIn(doc);
    // A zip, by its local file header.
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const parsed = await parseFadeIn(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    expect(typesOf(parsed.doc)).toEqual(['sceneHeading', 'action']);
    expect(flatText(parsed.doc.content![1])).toBe('Zipped and delivered.');
  });

  // The document is the same shape after each save, or a file edited over
  // several sessions drifts a little further from itself every time.
  it('is stable across repeated save cycles', () => {
    const doc = docOf(
      { type: 'sceneHeading', content: [text('INT. LOOP - DAY')] },
      { type: 'character', content: [text('ECHO')] },
      { type: 'parenthetical', content: [text('(again)')] },
      { type: 'dialogue', content: [text('Again.')] },
    );

    const once = exportOSF(parseOSF(exportOSF(doc)).doc as JSONContent);
    const twice = exportOSF(parseOSF(once).doc as JSONContent);
    expect(twice).toBe(once);
  });
});
