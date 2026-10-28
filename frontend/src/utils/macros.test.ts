import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { testSchema, block, doc, BR } from '../test/screenplaySchema';
import {
  createMacro, macroLabel, macroTransaction, mergeMacros, normalizeMacros, parseMacrosFile,
  serializeMacros, shortcutClashes,
} from './macros';

function state(blocks: Parameters<typeof doc>, caret: number) {
  const d = testSchema.nodeFromJSON(doc(...blocks));
  return EditorState.create({ schema: testSchema, doc: d, selection: TextSelection.create(d, caret) });
}

function apply(s: EditorState, macro = createMacro()) {
  const tr = macroTransaction(s, macro);
  return tr ? s.apply(tr) : null;
}

function summary(s: EditorState): string[] {
  const out: string[] = [];
  s.doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}`));
  return out;
}

describe('inserting a macro', () => {
  it('without an element type, types the text at the caret', () => {
    const s = state([block('sceneHeading', 'INT. KITCHEN - ')], 16);
    const next = apply(s, createMacro({ text: 'CONTINUOUS' }))!;
    expect(summary(next)).toEqual(['sceneHeading:INT. KITCHEN - CONTINUOUS']);
    expect(next.selection.from).toBe(26);
  });

  it('replaces a selection inside the line', () => {
    const d = testSchema.nodeFromJSON(doc(block('action', 'She waits LATER.')));
    const s = EditorState.create({ schema: testSchema, doc: d, selection: TextSelection.create(d, 11, 16) });
    expect(summary(apply(s, createMacro({ text: 'a beat' }))!)).toEqual(['action:She waits a beat.']);
  });

  it('turns an empty line into the macro element', () => {
    const s = state([block('action', 'Before.'), { type: 'action' }], 10);
    const next = apply(s, createMacro({ text: "SARAH (CONT'D)", elementType: 'character' }))!;
    expect(summary(next)).toEqual(['action:Before.', "character:SARAH (CONT'D)"]);
    expect(next.selection.$from.parent.type.name).toBe('character');
    expect(next.selection.$from.parentOffset).toBe("SARAH (CONT'D)".length);
  });

  it('adds the element after a line that has text', () => {
    const s = state([block('action', 'Before.'), block('action', 'After.')], 3);
    const next = apply(s, createMacro({ text: 'LATER', elementType: 'sceneHeading' }))!;
    expect(summary(next)).toEqual(['action:Before.', 'sceneHeading:LATER', 'action:After.']);
  });

  it('turns newlines into line breaks', () => {
    const s = state([{ type: 'action' }], 1);
    const next = apply(s, createMacro({ text: 'One\nTwo', elementType: 'action' }))!;
    expect(next.doc.child(0).toJSON().content).toEqual(
      doc(block('action', 'One', BR, 'Two')).content![0].content,
    );
  });

  it('does nothing for empty text or an element this script lacks', () => {
    const s = state([block('action', 'x')], 1);
    expect(apply(s, createMacro({ text: '' }))).toBeNull();
    expect(apply(s, createMacro({ text: 'x', elementType: 'noSuchElement' }))).toBeNull();
  });
});

describe('macro settings and files', () => {
  it('normalizes stored macros, dropping bad shortcuts and fixing ids', () => {
    const list = normalizeMacros([
      { id: 'a', name: '  Cont  ', text: 'A\r\nB', elementType: 'action', shortcut: 'Mod-Alt-1' },
      { id: 'a', text: 'dup id', shortcut: 'not a shortcut!!' },
      'junk',
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'a', name: 'Cont', text: 'A\nB', shortcut: 'Mod-Alt-1' });
    expect(list[1].id).not.toBe('a');
    expect(list[1].shortcut).toBe('');
    expect(normalizeMacros('nope')).toEqual([]);
  });

  it('round-trips through an exported file', () => {
    const macros = [createMacro({ name: 'Cont', text: 'CONTINUOUS', shortcut: 'Mod-Alt-c' })];
    const back = parseMacrosFile(serializeMacros(macros));
    expect(back.map(({ name, text, shortcut }) => ({ name, text, shortcut }))).toEqual([
      { name: 'Cont', text: 'CONTINUOUS', shortcut: 'Mod-Alt-c' },
    ]);
  });

  it('explains a file that is not macros', () => {
    expect(() => parseMacrosFile('{')).toThrow('not valid JSON');
    expect(() => parseMacrosFile('{"format":"other"}')).toThrow('does not contain OpenDraft macros');
  });

  it('merges an import without repeats or a second owner for a shortcut', () => {
    const mine = [createMacro({ name: 'A', text: 'a', shortcut: 'Mod-Alt-1' })];
    const { macros, added } = mergeMacros(mine, [
      createMacro({ name: 'A', text: 'a' }),
      createMacro({ name: 'B', text: 'b', shortcut: 'Mod-Alt-1' }),
    ]);
    expect(added).toBe(1);
    expect(macros.map((m) => [m.name, m.shortcut])).toEqual([['A', 'Mod-Alt-1'], ['B', '']]);
  });

  it('finds shortcut clashes with each other and with reserved keys', () => {
    const a = createMacro({ text: 'a', shortcut: 'Mod-Alt-1' });
    const b = createMacro({ text: 'b', shortcut: 'Mod-Alt-1' });
    const c = createMacro({ text: 'c', shortcut: 'Mod-Alt-2' });
    expect(shortcutClashes([a, b, c])).toEqual(new Set([a.id, b.id]));
    expect(shortcutClashes([c], ['Mod-Alt-2'])).toEqual(new Set([c.id]));
  });

  it('labels a macro by name, else by its text', () => {
    expect(macroLabel(createMacro({ name: 'Cont', text: 'x' }))).toBe('Cont');
    expect(macroLabel(createMacro({ text: 'CONTINUOUS' }))).toBe('CONTINUOUS');
  });
});
