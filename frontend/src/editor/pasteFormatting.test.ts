/**
 * Pasting from another app used to bring that app's font with it — the report
 * was an iPad paste landing in a font that matched neither the source nor the
 * screenplay, because iOS tags every run with a system alias that resolves to
 * whatever the web view falls back to. These pin the rule that removes the
 * aliases and nothing else: a real family and every font size come through, so
 * a paste stops reformatting the writer's text behind their back.
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
import { General } from './extensions/General';
import { FontSize } from './extensions/FontSize';
import { stripPastedFonts, isInternalPaste, retypeBlocks } from './extensions/PasteFormatting';

const schema = getSchema([
  Document.extend({ content: 'block+' }),
  Text, Bold, TextStyle, FontFamily, FontSize, Color, Action, General,
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
  it('drops a system alias, which names no font a web view can resolve', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{
        type: 'text',
        text: 'Anna makes coffee.',
        marks: [textStyle({ fontFamily: '-apple-system' })],
      }],
    }));

    expect(runs(result)).toEqual([['Anna makes coffee.', []]]);
  });

  it('keeps a real family the writer chose', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{ type: 'text', text: 'Anna.', marks: [textStyle({ fontFamily: 'Georgia' })] }],
    }));

    expect(runs(result)).toEqual([
      ['Anna.', [{ type: 'textStyle', attrs: { color: null, fontFamily: 'Georgia', fontSize: null } }]],
    ]);
  });

  it('never touches a font size — a size always means what it says', () => {
    const original = slice({
      type: 'action',
      content: [{ type: 'text', text: 'Big.', marks: [textStyle({ fontSize: '24px' })] }],
    });

    expect(stripPastedFonts(original).eq(original)).toBe(true);
  });

  it('drops the size along with nothing else when an alias carries one', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{
        type: 'text',
        text: 'Anna.',
        marks: [textStyle({ fontFamily: '.SFUI-Regular', fontSize: '17px' })],
      }],
    }));

    // The alias goes; the size stays, because it was never the problem.
    expect(runs(result)).toEqual([
      ['Anna.', [{ type: 'textStyle', attrs: { color: null, fontFamily: null, fontSize: '17px' } }]],
    ]);
  });

  it('keeps the real families standing behind an alias', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{
        type: 'text',
        text: 'Anna.',
        marks: [textStyle({ fontFamily: '-apple-system, BlinkMacSystemFont, Georgia, serif' })],
      }],
    }));

    expect(runs(result)).toEqual([
      ['Anna.', [{ type: 'textStyle', attrs: { color: null, fontFamily: 'Georgia, serif', fontSize: null } }]],
    ]);
  });

  it('keeps the marks that carry meaning', () => {
    const result = stripPastedFonts(slice({
      type: 'action',
      content: [{
        type: 'text',
        text: 'Loud.',
        marks: [{ type: 'bold' }, textStyle({ fontFamily: 'system-ui', color: 'rgb(255, 0, 0)' })],
      }],
    }));

    // Marks come back in schema order, textStyle before bold.
    expect(runs(result)).toEqual([
      ['Loud.', [{ type: 'textStyle', attrs: { color: 'rgb(255, 0, 0)', fontFamily: null, fontSize: null } }, { type: 'bold' }]],
    ]);
  });

  it('reaches every run, at every depth', () => {
    const result = stripPastedFonts(slice(
      { type: 'action', content: [{ type: 'text', text: 'One', marks: [textStyle({ fontFamily: 'ui-serif' })] }] },
      { type: 'action', content: [
        { type: 'text', text: 'Two', marks: [textStyle({ fontFamily: '-apple-system' })] },
        { type: 'text', text: ' three' },
      ] },
    ));

    // 'Two' and ' three' come back as one run: losing the alias left them with
    // identical marks, and ProseMirror joins adjacent text nodes that match.
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
        content: [{ type: 'action', content: [{ type: 'text', text: 'Anna', marks: [textStyle({ fontFamily: '-apple-system' })] }] }],
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

/**
 * Choosing an element type and pasting used to produce text of some other type:
 * the paste carried the source's blocks, so a web page's paragraphs landed as
 * Action however the writer had set the dropdown. Assigning the type by hand
 * afterwards worked, which is what said the content was fine and only its type
 * was wrong.
 */
describe('retypeBlocks', () => {
  const general = schema.nodes.general;

  it('gives pasted blocks the type the writer is standing in', () => {
    const result = retypeBlocks(
      slice(
        { type: 'action', content: [{ type: 'text', text: 'One' }] },
        { type: 'action', content: [{ type: 'text', text: 'Two' }] },
      ),
      general,
    );

    expect(result.content.child(0).type.name).toBe('general');
    expect(result.content.child(1).type.name).toBe('general');
    expect(result.content.child(0).textContent).toBe('One');
  });

  it('keeps the marks a retyped block was carrying', () => {
    const result = retypeBlocks(
      slice({
        type: 'action',
        content: [{ type: 'text', text: 'Loud', marks: [{ type: 'bold' }] }],
      }),
      general,
    );

    expect(result.content.child(0).child(0).marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('leaves a slice alone when it is already the destination type', () => {
    const original = slice({ type: 'general', content: [{ type: 'text', text: 'One' }] });

    // Same object back, not a rebuilt copy: nothing to change.
    expect(retypeBlocks(original, general)).toBe(original);
  });

  it('keeps the open depths, so an inline paste still merges into its block', () => {
    const open = new Slice(
      schema.nodeFromJSON({
        type: 'doc',
        content: [{ type: 'action', content: [{ type: 'text', text: 'Anna' }] }],
      }).content,
      1,
      1,
    );
    const result = retypeBlocks(open, general);

    expect(result.openStart).toBe(1);
    expect(result.openEnd).toBe(1);
  });
});
