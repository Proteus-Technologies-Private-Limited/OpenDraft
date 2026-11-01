import { describe, it, expect } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import { InkAwareColor } from './extensions/InkAwareColor';
import { FontSize } from './extensions/FontSize';
import { ParagraphLayout } from './extensions/ParagraphLayout';
import { testExtensions, block, doc } from '../test/screenplaySchema';
import {
  suggestTransaction,
  listSuggestions,
  resolveSuggestionsTransaction,
  SUGGESTED_BREAK,
} from './suggestions';
import { reviewProjection } from './reviewProjection';
const schema = getSchema([
  ...testExtensions,
  TextStyle,
  FontFamily,
  FontSize,
  InkAwareColor,
  TextAlign.configure({ types: ['action'] }),
  ParagraphLayout,
]);
const stateOf = (json: JSONContent = doc(block('action', 'One two.'))) =>
  EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
const resolve = (s: EditorState, accept: boolean) =>
  s.apply(resolveSuggestionsTransaction(s, () => true, accept)!);
describe('complete review projections', () => {
  it('projects original and proposed text/styles without changing the source', () => {
    let s = stateOf();
    s = s.apply(suggestTransaction(s, s.tr.insertText('New ', 1), { by: 'Ann' }));
    s = s.apply(
      suggestTransaction(s, s.tr.addMark(5, 8, schema.marks.bold.create()), { by: 'Bob' }),
    );
    const before = s.doc.toJSON();
    expect(reviewProjection(s.doc, 'original').textContent).toBe('One two.');
    expect(reviewProjection(s.doc, 'proposed').textContent).toBe('New One two.');
    expect(listSuggestions(reviewProjection(s.doc, 'original'))).toHaveLength(0);
    expect(listSuggestions(reviewProjection(s.doc, 'proposed'))).toHaveLength(0);
    expect(s.doc.toJSON()).toEqual(before);
  });
  for (const [field, value] of [
    ['fontFamily', 'Arial'],
    ['fontSize', '18pt'],
    ['color', '#ff0000'],
  ] as const)
    it(`retains baseline and resolves proposed ${field}`, () => {
      let s = stateOf();
      const baseline = s.doc.toJSON();
      s = s.apply(
        suggestTransaction(
          s,
          s.tr.addMark(1, 4, schema.marks.textStyle.create({ [field]: value })),
          { by: 'Ann' },
        ),
      );
      expect(listSuggestions(s.doc)[0].formats).toMatchObject([
        { format: field, before: null, after: value },
      ]);
      expect(reviewProjection(s.doc, 'original').firstChild!.firstChild!.marks).toHaveLength(0);
      expect(resolve(s, false).doc.toJSON()).toEqual(baseline);
      expect(resolve(s, true).doc.firstChild!.firstChild!.marks[0].attrs[field]).toBe(value);
    });
  for (const [key, value] of [
    ['textAlign', 'center'],
    [
      'paragraphLayout',
      { leftIndentPt: 24, rightIndentPt: 12, spaceBeforePt: 6, spaceAfterPt: 12, lineSpacing: 1.5 },
    ],
  ] as const)
    it(`tracks ${key} with a reversible block baseline`, () => {
      let s = stateOf();
      const before = s.doc.toJSON();
      s = s.apply(suggestTransaction(s, s.tr.setNodeAttribute(0, key, value), { by: 'Ann' }));
      expect(listSuggestions(s.doc)[0].kinds).toContain('paragraphFormat');
      expect(reviewProjection(s.doc, 'original').firstChild!.attrs[key]).toEqual(
        schema.nodeFromJSON(before).firstChild!.attrs[key],
      );
      expect(resolve(s, false).doc.toJSON()).toEqual(before);
      expect(resolve(s, true).doc.firstChild!.attrs[key]).toEqual(value);
    });
  it('adds, withdraws, accepts and projects an inline break as a node attribute', () => {
    const original = stateOf();
    const s = original.apply(
      suggestTransaction(original, original.tr.insert(4, schema.nodes.hardBreak.create()), {
        by: 'Ann',
        uid: 'ann',
      }),
    );
    expect(s.doc.textContent).toBe('One\n two.');
    expect(listSuggestions(s.doc)[0].kinds).toContain('break');
    expect(s.doc.nodeAt(4)?.attrs[SUGGESTED_BREAK]).toMatchObject({ by: 'Ann', op: 'insert' });
    expect(reviewProjection(s.doc, 'original').textContent).toBe('One two.');
    expect(reviewProjection(s.doc, 'proposed').textContent).toBe('One\n two.');
    expect(resolve(s, false).doc.toJSON()).toEqual(original.doc.toJSON());
    expect(resolve(s, true).doc.nodeAt(4)?.attrs[SUGGESTED_BREAK]).toBeNull();
  });
  it('suggests deleting an existing break, retaining it in Original until accepted', () => {
    const original = stateOf(
      doc({
        type: 'action',
        content: [
          { type: 'text', text: 'One' },
          { type: 'hardBreak' },
          { type: 'text', text: 'two' },
        ],
      }),
    );
    const s = original.apply(suggestTransaction(original, original.tr.delete(4, 5), { by: 'Ann' }));
    expect(s.doc.textContent).toBe('One\ntwo');
    expect(reviewProjection(s.doc, 'original').textContent).toBe('One\ntwo');
    expect(resolve(s, true).doc.textContent).toBe('Onetwo');
    expect(resolve(s, false).doc.toJSON()).toEqual(original.doc.toJSON());
  });
});

it('keeps a null original font value when parsing review HTML', async () => {
  const { SuggestionFormat } = await import('./extensions/Suggestions');
  const attrs = SuggestionFormat.config.addAttributes!.call({} as never) as Record<
    string,
    { parseHTML: (el: HTMLElement) => unknown }
  >;
  const element = {
    getAttribute: () =>
      JSON.stringify({
        id: 'review',
        by: 'Ann',
        at: 1,
        format: 'fontSize',
        before: null,
        after: '18pt',
      }),
  } as unknown as HTMLElement;
  expect(attrs.before.parseHTML(element)).toBeNull();
  expect(attrs.after.parseHTML(element)).toBe('18pt');
});

it('blocks local edits in a projection while allowing remote synchronization', async () => {
  const { Suggestions } = await import('./extensions/Suggestions');
  const { useSuggestModeStore } = await import('../stores/suggestModeStore');
  const plugins = Suggestions.config.addProseMirrorPlugins!.call({
    options: {},
  } as never) as import('@tiptap/pm/state').Plugin[];
  let s = EditorState.create({ schema, doc: stateOf().doc, plugins });
  try {
    useSuggestModeStore.getState().setDisplay('original');
    expect(s.applyTransaction(s.tr.insertText('LOCAL', 1)).transactions).toHaveLength(0);
    const remote = s.applyTransaction(s.tr.insertText('REMOTE', 1).setMeta('y-sync$', {}));
    expect(remote.transactions).toHaveLength(1);
    s = remote.state;
    expect(s.doc.textContent.startsWith('REMOTE')).toBe(true);
  } finally {
    useSuggestModeStore.getState().setDisplay('markup');
  }
});

it('marks accepted paragraph geometry and inserted inline breaks as revisions', async () => {
  const { RevisionMark, RevisionTextStyle } = await import('./extensions/RevisionMark');
  const { revisionMarksPlugin } = await import('./revisionMarks');
  const revisionSchema = getSchema([
    ...testExtensions,
    ParagraphLayout,
    RevisionTextStyle,
    RevisionMark,
  ]);
  for (const change of ['paragraph', 'break']) {
    let s = EditorState.create({
      schema: revisionSchema,
      doc: revisionSchema.nodeFromJSON(doc(block('action', 'One two.'))),
      plugins: [revisionMarksPlugin(() => ({ enabled: true, color: 'Blue' }))],
    });
    const tr =
      change === 'paragraph'
        ? s.tr.setNodeAttribute(0, 'paragraphLayout', { leftIndentPt: 24 })
        : s.tr.insert(4, revisionSchema.nodes.hardBreak.create());
    s = s.apply(suggestTransaction(s, tr, { by: 'Ann' }));
    expect(s.doc.firstChild!.attrs.revised).toBeNull();
    s = s.apply(resolveSuggestionsTransaction(s, () => true, true)!);
    expect(s.doc.firstChild!.attrs.revised).toBe('Blue');
  }
});
