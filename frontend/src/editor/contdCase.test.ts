import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MORES_CONTDS, DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { block, doc, pmDoc, testSchema } from '../test/screenplaySchema';
import { createContdCasePlugin } from './contdCase';

describe('continued cue decorations', () => {
  it('maps cue positions through typing and Backspace without walking the script', () => {
    const plugin = createContdCasePlugin(() => DEFAULT_PAGE_LAYOUT);
    const decorations = (state: EditorState) =>
      plugin.props.decorations!.call(plugin, state) as DecorationSet;
    let state = EditorState.create({
      doc: pmDoc(doc(block('dialogue', 'Look.'), block('character', "ADA (cont'd)"))),
      plugins: [plugin],
    });
    const initial = decorations(state);
    const [{ from, to }] = initial.find();

    const typing = state.tr.insertText('!', 5);
    const typedScan = vi.spyOn(typing.doc, 'descendants');
    state = state.apply(typing);
    const afterTyping = decorations(state);
    expect(afterTyping.find()).toMatchObject([{ from: from + 1, to: to + 1 }]);
    expect(typedScan).not.toHaveBeenCalled();

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)));
    expect(decorations(state)).toBe(afterTyping);

    const backspace = state.tr.delete(5, 6);
    const deletedScan = vi.spyOn(backspace.doc, 'descendants');
    state = state.apply(backspace);
    expect(decorations(state).find()).toMatchObject([{ from, to }]);
    expect(deletedScan).not.toHaveBeenCalled();
  });

  it('refreshes for character edits, structural changes, and the live marker setting', () => {
    let layout = DEFAULT_PAGE_LAYOUT;
    const plugin = createContdCasePlugin(() => layout);
    const decoratedText = (state: EditorState) =>
      (plugin.props.decorations!.call(plugin, state) as DecorationSet).find()
        .map(({ from, to }) => state.doc.textBetween(from, to));
    let state = EditorState.create({
      doc: pmDoc(doc(block('character', "ADA (cont'd)"))),
      plugins: [plugin],
    });
    expect(decoratedText(state)).toEqual(["(cont'd)"]);

    state = state.apply(state.tr.insertText('(again)', 5, state.doc.content.size - 1));
    expect(decoratedText(state)).toEqual([]);

    layout = { ...layout, moresContds: { ...DEFAULT_MORES_CONTDS, contdText: '(AGAIN)' } };
    expect(decoratedText(state)).toEqual(['(again)']);

    const cue = testSchema.nodes.character.create(null, testSchema.text('BEA (again)'));
    state = state.apply(state.tr.insert(state.doc.content.size, cue));
    expect(decoratedText(state)).toEqual(['(again)', '(again)']);

    state = state.apply(state.tr.delete(0, state.doc.child(0).nodeSize));
    expect(decoratedText(state)).toEqual(['(again)']);
  });
});
