import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { getSchema } from '@tiptap/core';
import { testSchema, testExtensions, block, doc, pmDoc } from '../../test/screenplaySchema';
import { RevisionTextStyle } from './RevisionMark';
import { FontSize } from './FontSize';
import {
  TamilTransliteration,
  createTamilTransliterationPlugin,
  tamilTransliterationPluginKey,
} from './TamilTransliteration';
import { useEditorStore } from '../../stores/editorStore';
import type { EditorView } from '@tiptap/pm/view';

describe('TamilTransliteration Extension', () => {
  beforeEach(() => {
    useEditorStore.setState({ tamilTypingEnabled: true });
  });

  it('provides a ProseMirror plugin in extension', () => {
    expect(TamilTransliteration.name).toBe('tamilTransliteration');
    const plugin = createTamilTransliterationPlugin();
    expect(plugin.spec.key).toBe(tamilTransliterationPluginKey);
  });

  it('handleTextInput transliterates Latin word on space delimiter', () => {
    const plugin = createTamilTransliterationPlugin();
    const initialDoc = pmDoc(doc(block('action', 'vanakkam')));
    let state = EditorState.create({
      doc: initialDoc,
      schema: testSchema,
      plugins: [plugin],
    });

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)));

    let dispatchedTr: any = null;
    const mockView = {
      state,
      dispatch: (tr: any) => {
        dispatchedTr = tr;
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    const handleTextInput = plugin.props.handleTextInput;
    expect(handleTextInput).toBeDefined();

    // Call with plugin as 'this' context and all arguments
    const handled = (handleTextInput as any).call(plugin, mockView, 9, 9, ' ');
    expect(handled).toBe(true);
    expect(dispatchedTr).not.toBeNull();
    expect(state.doc.textContent).toBe('வணக்கம் ');
  });

  it('does nothing when tamilTypingEnabled is false', () => {
    useEditorStore.setState({ tamilTypingEnabled: false });

    const plugin = createTamilTransliterationPlugin();
    const initialDoc = pmDoc(doc(block('action', 'vanakkam')));
    const state = EditorState.create({
      doc: initialDoc,
      schema: testSchema,
      plugins: [plugin],
    });

    const mockView = {
      state,
      dispatch: () => {},
    } as unknown as EditorView;

    const handleTextInput = plugin.props.handleTextInput;
    const handled = (handleTextInput as any).call(plugin, mockView, 9, 9, ' ');
    expect(handled).toBe(false);
  });

  it('handleKeyDown space replaces word when at word boundary', () => {
    useEditorStore.setState({ tamilTypingEnabled: true });

    const plugin = createTamilTransliterationPlugin();
    const initialDoc = pmDoc(doc(block('action', 'ammaa')));
    let state = EditorState.create({
      doc: initialDoc,
      schema: testSchema,
      plugins: [plugin],
    });

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)));

    let dispatchedTr: any = null;
    const mockView = {
      state,
      dispatch: (tr: any) => {
        dispatchedTr = tr;
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    const handleKeyDown = plugin.props.handleKeyDown;
    const spaceEvent = {
      key: ' ',
      preventDefault: () => {},
    } as unknown as KeyboardEvent;

    const handled = (handleKeyDown as any).call(plugin, mockView, spaceEvent);
    expect(handled).toBe(true);
    expect(dispatchedTr).not.toBeNull();
    expect(state.doc.textContent).toBe('அம்மா ');
  });

  it('toggles tamil typing mode via Ctrl+M', () => {
    useEditorStore.setState({ tamilTypingEnabled: false });

    const plugin = createTamilTransliterationPlugin();
    const initialDoc = pmDoc(doc(block('action', 'test')));
    const state = EditorState.create({
      doc: initialDoc,
      schema: testSchema,
      plugins: [plugin],
    });

    const mockView = {
      state,
      dispatch: () => {},
    } as unknown as EditorView;

    const handleKeyDown = plugin.props.handleKeyDown;
    const toggleEvent = {
      key: 'm',
      ctrlKey: true,
      preventDefault: () => {},
    } as unknown as KeyboardEvent;

    const handled = (handleKeyDown as any).call(plugin, mockView, toggleEvent);
    expect(handled).toBe(true);
    expect(useEditorStore.getState().tamilTypingEnabled).toBe(true);
  });

  it('attaches 11pt fontSize textStyle mark to transliterated Tamil word', () => {
    useEditorStore.setState({ tamilTypingEnabled: true });

    // Schema with textStyle to verify mark application
    const schemaWithTextStyle = getSchema([
      ...testExtensions,
      RevisionTextStyle,
      FontSize,
    ]);

    const plugin = createTamilTransliterationPlugin();
    const initialDoc = schemaWithTextStyle.nodeFromJSON(doc(block('action', 'vanakkam')));
    let state = EditorState.create({
      doc: initialDoc,
      schema: schemaWithTextStyle,
      plugins: [plugin],
    });

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)));

    const mockView = {
      state,
      dispatch: (tr: any) => {
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    const handleTextInput = plugin.props.handleTextInput;
    (handleTextInput as any).call(plugin, mockView, 9, 9, ' ');

    // Find the text nodes in the action block
    const actionNode = state.doc.firstChild!;
    expect(actionNode.childCount).toBe(2);
    const tamilNode = actionNode.child(0);
    const delimiterNode = actionNode.child(1);
    expect(tamilNode.text).toBe('வணக்கம்');
    expect(delimiterNode.text).toBe(' ');
    const mark = tamilNode.marks.find((m) => m.type.name === 'textStyle');
    expect(mark).toBeDefined();
    expect(mark?.attrs.fontSize).toBe('11pt');
  });
});
