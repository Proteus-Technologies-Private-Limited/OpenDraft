/**
 * Pasting from another app used to bring that app's font with it — the report
 * was an iPad paste landing in a font that matched neither the source nor the
 * screenplay. These pin the transform that drops it.
 *
 * The schema here is deliberately local and minimal: the font attributes live
 * on `textStyle`, so a document node, some text and the three mark extensions
 * that write those attributes are the whole surface under test.
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import { Slice } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';

import { Action } from './extensions/Action';
import { FontSize } from './extensions/FontSize';
import { stripPastedFonts, isInternalPaste } from './extensions/PasteFormatting';

const schema = getSchema([
  Document.extend({ content: 'block+' }),
  Text, Bold, TextStyle, FontFamily, FontSize, Color, Action,
]);

/** A one-block slice, as a paste of whole blocks arrives. */
function slice(...content: JSONContent[]): Slice {
  return new Slice(schema.nodeFromJSON({ type: 'doc', content }).content, 0, 0);
}

/** [text, marks-as-JSON] for every text run in the slice. */
function runs(result: Slice): [string, unknown[]][] {
  const out: [string, unknown[]][] = [];
  result.content.descendants((node) => {
    if (node.isText) out.push([node.text ?? '', node.marks.map((m) => m.toJSON())]);
  });
  return out;
}

const textStyle = (attrs: Record<string, string>) => ({ type: 'textStyle', attrs });

describe('stripPastedFonts', () => {
  it('drops the font a source app tagged its text with', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{
        type: 'text',
        text: 'Anna makes coffee.',
        marks: [textStyle({ fontFamily: '-apple-system', fontSize: '17px' })],
      }],
    }));

    expect(runs(result)).toEqual([['Anna makes coffee.', []]]);
  });

  it('keeps the marks that carry meaning', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{
        type: 'text',
        text: 'Loud.',
        marks: [{ type: 'bold' }, textStyle({ fontFamily: 'Helvetica', color: 'rgb(255, 0, 0)' })],
      }],
    }));

    // Marks come back in schema order, textStyle before bold.
    expect(runs(result)).toEqual([
      ['Loud.', [{ type: 'textStyle', attrs: { color: 'rgb(255, 0, 0)', fontFamily: null, fontSize: null } }, { type: 'bold' }]],
    ]);
  });

  it('strips every run, at every depth', () => {
    const result = stripPastedFonts(slice(
      { type: 'action', content: [{ type: 'text', text: 'One', marks: [textStyle({ fontSize: '17px' })] }] },
      { type: 'action', content: [
        { type: 'text', text: 'Two', marks: [textStyle({ fontFamily: 'Georgia' })] },
        { type: 'text', text: ' three' },
      ] },
    ));

    // 'Two' and ' three' come back as one run: stripping the font left them
    // with identical marks, and ProseMirror joins adjacent text nodes that
    // carry the same marks. That is the point — the paste stops being a patch-
    // work of runs and becomes ordinary screenplay text.
    expect(runs(result)).toEqual([['One', []], ['Two three', []]]);
  });

  it('leaves text with no font of its own untouched', () => {
    const original = slice({ type: 'action', content: [{ type: 'text', text: 'Plain' }] });

    expect(stripPastedFonts(original).eq(original)).toBe(true);
  });

  it('keeps the slice open depths, so a paste still merges into its block', () => {
    const open = new Slice(
      schema.nodeFromJSON({
        type: 'doc',
        content: [{ type: 'action', content: [{ type: 'text', text: 'Anna', marks: [textStyle({ fontSize: '17px' })] }] }],
      }).content,
      1,
      1,
    );
    const result = stripPastedFonts(open);

    expect(result.openStart).toBe(1);
    expect(result.openEnd).toBe(1);
    expect(runs(result)).toEqual([['Anna', []]]);
  });
});

describe('isInternalPaste', () => {
  it('recognises ProseMirror’s own clipboard HTML', () => {
    expect(isInternalPaste('<div data-pm-slice="1 1 []"><p>Anna</p></div>')).toBe(true);
  });

  it('does not take prose that mentions the attribute for markup', () => {
    expect(isInternalPaste('<p>ProseMirror writes data-pm-slice="1 1 []" on a copy.</p>')).toBe(false);
  });

  it('treats HTML from another app as external', () => {
    expect(isInternalPaste('<span style="font-family: -apple-system">Anna</span>')).toBe(false);
  });
});
