import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/core';
import { testSchema, block, doc } from '../test/screenplaySchema';
import {
  SUGGEST_DELETE, SUGGEST_INSERT, SUGGESTED_JOIN, SUGGESTED_SPLIT, SUGGESTED_TYPE,
  hasSuggestions, isHousekeeping, isLocalEdit, listSuggestions, resolveSuggestionTransaction, resolveSuggestionsTransaction,
  suggestTransaction, suggestionAt, withoutSuggestionsJSON,
} from './suggestions';
import { buildSuggestionDecorations } from './extensions/Suggestions';

function stateOf(...blocks: JSONContent[]) {
  return EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)) });
}

/** Position `offset` characters into the text of the top-level block at `index`. */
function at(s: EditorState, index: number, offset = 0): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1 + offset;
}

/** Apply an edit as Ann suggesting it. */
function suggest(s: EditorState, edit: (tr: Transaction) => Transaction, by = 'Ann', onBlocked?: () => void): EditorState {
  const tr = edit(s.tr);
  return s.apply(suggestTransaction(s, tr, { by, now: 1000, onBlocked }));
}

/** The script as text, suggestions shown: {+inserted+} [-deleted-], a new line as ¶, a join as ⤒, a type change as (was X). */
function show(s: EditorState): string {
  const lines: string[] = [];
  s.doc.forEach((node) => {
    let line = '';
    if (node.attrs[SUGGESTED_SPLIT]) line += '¶';
    if (node.attrs[SUGGESTED_JOIN]) line += '⤒';
    if (node.attrs[SUGGESTED_TYPE]) line += `(was ${node.attrs[SUGGESTED_TYPE].from})`;
    line += `${node.type.name}:`;
    node.forEach((child) => {
      const text = child.isText ? child.text : '⏎';
      const ins = child.marks.some((m) => m.type.name === SUGGEST_INSERT);
      const del = child.marks.some((m) => m.type.name === SUGGEST_DELETE);
      line += ins && del ? `{+[-${text}-]+}` : ins ? `{+${text}+}` : del ? `[-${text}-]` : text;
    });
    lines.push(line);
  });
  return lines.join(' | ');
}

const resolveAll = (s: EditorState, accept: boolean) => {
  const tr = resolveSuggestionsTransaction(s, () => true, accept);
  return tr ? s.apply(tr) : s;
};

describe('typing while suggesting', () => {
  it('marks what is typed as a suggestion by its author', () => {
    let s = stateOf(block('action', 'She waits.'));
    s = suggest(s, (tr) => tr.insertText(' Alone', at(s, 0, 9)));
    expect(show(s)).toBe('action:She waits{+ Alone+}.');
    const [only] = listSuggestions(s.doc);
    expect(only).toMatchObject({ by: 'Ann', kinds: ['insert'], inserted: ' Alone' });
  });

  it('keeps typing next to your own suggestion as one suggestion', () => {
    let s = stateOf(block('action', 'Go.'));
    s = suggest(s, (tr) => tr.insertText('N', at(s, 0, 2)));
    s = suggest(s, (tr) => tr.insertText('o', at(s, 0, 3)));
    s = suggest(s, (tr) => tr.insertText('w', at(s, 0, 4)));
    expect(show(s)).toBe('action:Go{+Now+}.');
    expect(listSuggestions(s.doc)).toHaveLength(1);
  });

  it('a word typed a letter at a time is one run, timed from its first letter', () => {
    // What the editor does: a keystroke each, each a moment later.
    const typeAt = (st: EditorState, edit: (tr: Transaction) => Transaction, now: number) =>
      st.apply(suggestTransaction(st, edit(st.tr), { by: 'Ann', now }));
    let s = stateOf(block('action', 'Go. Stay here.'));
    'Now'.split('').forEach((ch, i) => { s = typeAt(s, (tr) => tr.insertText(ch, at(s, 0, 2 + i)), 1000 + i * 40); });
    // Backspacing "here" from its end, a letter at a time.
    for (let i = 0; i < 4; i++) s = typeAt(s, (tr) => tr.delete(at(s, 0, 15 - i), at(s, 0, 16 - i)), 2000 + i * 40);
    expect(show(s)).toBe('action:Go{+Now+}. Stay [-here-].');
    const runs: Array<{ text: string; at: unknown }> = [];
    s.doc.child(0).forEach((n) => {
      const m = n.marks.find((x) => x.type.name === SUGGEST_INSERT || x.type.name === SUGGEST_DELETE);
      if (m) runs.push({ text: n.text ?? '', at: m.attrs.at });
    });
    expect(runs).toEqual([{ text: 'Now', at: 1000 }, { text: 'here', at: 2000 }]);
    expect(listSuggestions(s.doc).map((x) => x.at)).toEqual([1000, 2000]);
  });

  it('a word typed in a session keeps its author’s id on every letter, as one run', () => {
    let s = stateOf(block('action', 'Go.'));
    'Now'.split('').forEach((ch, i) => {
      s = s.apply(suggestTransaction(s, s.tr.insertText(ch, at(s, 0, 2 + i)), { by: 'Sam', uid: 'sam-1', now: 1000 + i * 40 }));
    });
    const runs: Array<Record<string, unknown>> = [];
    s.doc.child(0).forEach((n) => {
      const m = n.marks.find((x) => x.type.name === SUGGEST_INSERT);
      if (m) runs.push({ text: n.text, ...m.attrs });
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: 'Now', by: 'Sam', uid: 'sam-1', at: 1000 });
  });

  it('two people typing side by side make two suggestions', () => {
    let s = stateOf(block('action', 'Go.'));
    s = suggest(s, (tr) => tr.insertText('A', at(s, 0, 2)), 'Ann');
    s = suggest(s, (tr) => tr.insertText('B', at(s, 0, 3)), 'Ben');
    expect(listSuggestions(s.doc).map((x) => [x.by, x.inserted])).toEqual([['Ann', 'A'], ['Ben', 'B']]);
  });

  it('puts the caret after what was typed', () => {
    let s = stateOf(block('action', 'ab'));
    s = suggest(s, (tr) => tr.insertText('X', at(s, 0, 1)).setSelection(TextSelection.create(tr.doc, at(s, 0, 2))));
    expect(s.selection.from).toBe(at(s, 0, 2));
  });
});

describe('deleting while suggesting', () => {
  it('strikes text through instead of removing it', () => {
    let s = stateOf(block('action', 'She waits alone.'));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 9), at(s, 0, 15)));
    expect(show(s)).toBe('action:She waits[- alone-].');
    expect(listSuggestions(s.doc)[0]).toMatchObject({ kinds: ['delete'], deleted: ' alone' });
  });

  it('Backspace leaves the caret before the struck letter, so the next one strikes the letter before', () => {
    let s = stateOf(block('action', 'abc'));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at(s, 0, 3))));
    for (let i = 0; i < 2; i++) {
      const head = s.selection.head;
      s = suggest(s, (tr) => tr.delete(head - 1, head));
    }
    expect(show(s)).toBe('action:a[-bc-]');
    expect(s.selection.head).toBe(at(s, 0, 1));
    expect(listSuggestions(s.doc)).toHaveLength(1);
  });

  it('Delete leaves the caret after the struck letter', () => {
    let s = stateOf(block('action', 'abc'));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at(s, 0, 0))));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 0), at(s, 0, 1)));
    expect(show(s)).toBe('action:[-a-]bc');
    expect(s.selection.head).toBe(at(s, 0, 1));
  });

  it('deleting your own suggestion takes it away', () => {
    let s = stateOf(block('action', 'Go.'));
    s = suggest(s, (tr) => tr.insertText('Now', at(s, 0, 2)));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 2), at(s, 0, 5)));
    expect(show(s)).toBe('action:Go.');
    expect(hasSuggestions(s.doc)).toBe(false);
  });

  it('deleting someone else’s suggestion is a suggestion of its own', () => {
    let s = stateOf(block('action', 'Go.'));
    s = suggest(s, (tr) => tr.insertText('Now', at(s, 0, 2)), 'Ann');
    s = suggest(s, (tr) => tr.delete(at(s, 0, 2), at(s, 0, 5)), 'Ben');
    expect(show(s)).toBe('action:Go{+[-Now-]+}.');
  });

  it('typing over a selection strikes the old words and adds the new after them', () => {
    let s = stateOf(block('dialogue', 'I hate you.'));
    s = suggest(s, (tr) => tr.insertText('love', at(s, 0, 2), at(s, 0, 6)));
    expect(show(s)).toBe('dialogue:I [-hate-]{+love+} you.');
  });

  it('typing over a selection the way a browser reports it — first letter kept — is one replacement', () => {
    let s = stateOf(block('dialogue', 'I hate you.'));
    // "hate" selected; typing "h" arrives as deleting "ate" with the caret after the "h".
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at(s, 0, 2), at(s, 0, 6))));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 3), at(s, 0, 6)).setSelection(TextSelection.create(tr.doc, at(s, 0, 3))));
    s = suggest(s, (tr) => tr.insertText('ug', s.selection.from));
    expect(show(s)).toBe('dialogue:I h[-ate-]{+ug+} you.');
    expect(listSuggestions(s.doc)).toHaveLength(1);
  });

  it('Backspace over words and then typing is one replacement', () => {
    let s = stateOf(block('dialogue', 'Pick up.'));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at(s, 0, 8))));
    for (let i = 0; i < 3; i++) {
      const head = s.selection.head;
      s = suggest(s, (tr) => tr.delete(head - 1, head));
    }
    s = suggest(s, (tr) => tr.insertText('it', s.selection.from));
    expect(show(s)).toBe('dialogue:Pick {+it+}[-up.-]');
    expect(listSuggestions(s.doc)).toHaveLength(1);
  });

  it('a new line after struck words is a suggestion of its own', () => {
    let s = stateOf(block('dialogue', 'Pick up.'));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 4), at(s, 0, 8)));
    s = suggest(s, (tr) => tr.split(at(s, 0, 8)));
    expect(show(s)).toBe('dialogue:Pick[- up.-] | ¶dialogue:');
    expect(listSuggestions(s.doc)).toHaveLength(2);
  });

  it('deleting across two lines strikes both and suggests joining them', () => {
    let s = stateOf(block('action', 'One two.'), block('action', 'Three four.'));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 4), at(s, 1, 6)));
    expect(show(s)).toBe('action:One [-two.-] | ⤒action:[-Three -]four.');
    s = resolveAll(s, true);
    expect(show(s)).toBe('action:One four.');
  });
});

describe('new lines and element types', () => {
  it('Enter suggests a new line; rejecting joins it back', () => {
    let s = stateOf(block('action', 'Before after.'));
    s = suggest(s, (tr) => tr.split(at(s, 0, 7)));
    expect(show(s)).toBe('action:Before  | ¶action:after.');
    const back = resolveAll(s, false);
    expect(show(back)).toBe('action:Before after.');
    const kept = resolveAll(s, true);
    expect(show(kept)).toBe('action:Before  | action:after.');
  });

  it('Enter and then Backspace leaves nothing behind', () => {
    let s = stateOf(block('action', 'Before after.'));
    s = suggest(s, (tr) => tr.split(at(s, 0, 7)));
    const boundary = s.doc.child(0).nodeSize;
    s = suggest(s, (tr) => tr.delete(boundary - 1, boundary + 1));
    expect(show(s)).toBe('action:Before after.');
    expect(hasSuggestions(s.doc)).toBe(false);
  });

  it('a new line with words typed into it is one suggestion', () => {
    let s = stateOf(block('character', 'MAYA'), block('dialogue', 'Hi.'));
    s = suggest(s, (tr) => tr.split(at(s, 1, 3)));
    s = suggest(s, (tr) => tr.insertText('Bye.', at(s, 2, 0)));
    expect(show(s)).toBe('character:MAYA | dialogue:Hi. | ¶dialogue:{+Bye.+}');
    expect(listSuggestions(s.doc)).toHaveLength(1);
    expect(show(resolveAll(s, false))).toBe('character:MAYA | dialogue:Hi.');
  });

  it('changing an element’s type is recorded, and rejecting sets it back', () => {
    let s = stateOf(block('action', 'MAYA'), block('dialogue', 'Hi.'));
    s = suggest(s, (tr) => tr.setBlockType(at(s, 0), at(s, 0) + 4, testSchema.nodes.character));
    expect(show(s)).toBe('(was action)character:MAYA | dialogue:Hi.');
    expect(listSuggestions(s.doc)[0]).toMatchObject({ kinds: ['type'], fromType: 'action', toType: 'character' });
    expect(show(resolveAll(s, false))).toBe('action:MAYA | dialogue:Hi.');
    expect(show(resolveAll(s, true))).toBe('character:MAYA | dialogue:Hi.');
  });

  it('changing the type back clears the suggestion', () => {
    let s = stateOf(block('action', 'MAYA'));
    s = suggest(s, (tr) => tr.setBlockType(1, 5, testSchema.nodes.character));
    s = suggest(s, (tr) => tr.setBlockType(1, 5, testSchema.nodes.action));
    expect(show(s)).toBe('action:MAYA');
    expect(hasSuggestions(s.doc)).toBe(false);
  });

  it('Enter that also changes the new line’s type is one new line, with no type to reject', () => {
    let s = stateOf(block('character', 'MAYA'));
    s = suggest(s, (tr) => {
      tr.split(at(s, 0, 4));
      const pos = tr.doc.child(0).nodeSize;
      return tr.setBlockType(pos + 1, pos + 1, testSchema.nodes.dialogue);
    });
    expect(show(s)).toBe('character:MAYA | ¶dialogue:');
  });

  it('pasting several lines suggests each one', () => {
    let s = stateOf(block('action', 'Start end.'));
    const slice = testSchema.nodeFromJSON(doc(block('action', 'A.'), block('action', 'B.'))).slice(1, 7, true);
    s = suggest(s, (tr) => tr.replace(at(s, 0, 6), at(s, 0, 6), slice));
    expect(listSuggestions(s.doc)).toHaveLength(1);
    expect(show(resolveAll(s, false))).toBe('action:Start end.');
  });
});

describe('what a suggestion cannot carry', () => {
  it('drops formatting, and says so', () => {
    let s = stateOf(block('action', 'Bold me.'));
    let blocked = 0;
    s = suggest(s, (tr) => tr.addMark(1, 5, testSchema.marks.bold.create()), 'Ann', () => { blocked++; });
    expect(s.doc.child(0).firstChild?.marks).toEqual([]);
    expect(blocked).toBe(1);
  });

  it('turns a line break inside an element into a space, and says so', () => {
    let s = stateOf(block('action', 'One two.'));
    let blocked = 0;
    s = suggest(s, (tr) => tr.insert(at(s, 0, 4), testSchema.nodes.hardBreak.create()), 'Ann', () => { blocked++; });
    expect(show(s)).toBe('action:One {+ +}two.');
    expect(blocked).toBe(1);
  });

  it('still lets a reviewer add a script note', () => {
    let s = stateOf(block('action', 'Note me.'));
    s = suggest(s, (tr) => tr.addMark(1, 5, testSchema.marks.scriptNote.create({ noteId: 'n1' })));
    expect(s.doc.child(0).firstChild?.marks.map((m) => m.type.name)).toEqual(['scriptNote']);
  });

  it('leaves remote changes, undo and its own transactions alone', () => {
    const s = stateOf(block('action', 'x'));
    expect(isLocalEdit(s.tr.insertText('y', 1).setMeta('y-sync$', { isChangeOrigin: true }))).toBe(false);
    expect(isLocalEdit(s.tr.insertText('y', 1).setMeta('history$', { redo: false }))).toBe(false);
    expect(isLocalEdit(s.tr.setSelection(TextSelection.create(s.doc, 1)))).toBe(false);
    expect(isLocalEdit(s.tr.insertText('y', 1))).toBe(true);
  });

  it('tells the app’s own housekeeping from an edit', () => {
    const s = stateOf({ ...block('sceneHeading', 'INT. A - DAY'), attrs: { sceneNumber: '1' } });
    expect(isHousekeeping(s.tr.setNodeAttribute(0, 'sceneNumber', '2').setMeta('addToHistory', false))).toBe(true);
    expect(isHousekeeping(s.tr.setNodeAttribute(0, 'sceneNumber', '2'))).toBe(false);
    expect(isHousekeeping(s.tr.setMeta('addToHistory', false))).toBe(false);
  });

  it('leaves a script being opened alone, but not select-all and type', () => {
    const s = stateOf(block('action', 'Old script.'));
    const replacement = testSchema.nodeFromJSON(doc(block('action', 'New script.'))).content;
    expect(isLocalEdit(s.tr.replaceWith(0, s.doc.content.size, replacement).setMeta('preventUpdate', false))).toBe(false);
    expect(isLocalEdit(s.tr.replaceWith(0, s.doc.content.size, replacement))).toBe(true);
    expect(isLocalEdit(s.tr.insertText('y', 1).setMeta('addToHistory', false))).toBe(false);
  });
});

describe('accepting and rejecting', () => {
  function reviewed() {
    let s = stateOf(block('dialogue', 'I hate you.'), block('action', 'She leaves.'));
    s = suggest(s, (tr) => tr.insertText('love', at(s, 0, 2), at(s, 0, 6)), 'Ann');
    s = suggest(s, (tr) => tr.insertText(' slowly', at(s, 1, 10)), 'Ben');
    return s;
  }

  it('accepts one suggestion and leaves the rest', () => {
    const s = reviewed();
    const ann = listSuggestions(s.doc).find((x) => x.by === 'Ann')!;
    const next = s.apply(resolveSuggestionTransaction(s, ann.id, true)!);
    expect(show(next)).toBe('dialogue:I love you. | action:She leaves{+ slowly+}.');
  });

  it('rejects one suggestion and leaves the rest', () => {
    const s = reviewed();
    const ben = listSuggestions(s.doc).find((x) => x.by === 'Ben')!;
    const next = s.apply(resolveSuggestionTransaction(s, ben.id, false)!);
    expect(show(next)).toBe('dialogue:I [-hate-]{+love+} you. | action:She leaves.');
  });

  it('accept all and reject all', () => {
    expect(show(resolveAll(reviewed(), true))).toBe('dialogue:I love you. | action:She leaves slowly.');
    expect(show(resolveAll(reviewed(), false))).toBe('dialogue:I hate you. | action:She leaves.');
  });

  it('finds the suggestion under the caret', () => {
    const s = reviewed();
    expect(suggestionAt(s.doc, at(s, 0, 3))?.by).toBe('Ann');
    expect(suggestionAt(s.doc, at(s, 1, 2))).toBeNull();
  });

  it('nothing to resolve is no transaction', () => {
    const s = stateOf(block('action', 'x'));
    expect(resolveSuggestionsTransaction(s, () => true, true)).toBeNull();
  });
});

describe('suggestions in the document', () => {
  it('survive a save and load as JSON', () => {
    let s = stateOf(block('action', 'Go.'));
    s = suggest(s, (tr) => tr.insertText('Now', at(s, 0, 2)));
    s = suggest(s, (tr) => tr.split(at(s, 0, 6)));
    const again = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(s.doc.toJSON()) });
    expect(show(again)).toBe(show(s));
  });

  it('exports see the script as it was before any suggestion', () => {
    let s = stateOf(block('dialogue', 'I hate you.'), block('action', 'MAYA'), block('action', 'Before after.'));
    s = suggest(s, (tr) => tr.insertText('love', at(s, 0, 2), at(s, 0, 6)));
    s = suggest(s, (tr) => tr.setBlockType(at(s, 1), at(s, 1), testSchema.nodes.character));
    s = suggest(s, (tr) => tr.split(at(s, 2, 7)));
    const clean = withoutSuggestionsJSON(s.doc.toJSON() as JSONContent);
    const reparsed = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(clean) });
    expect(show(reparsed)).toBe('dialogue:I hate you. | action:MAYA | action:Before after.');
  });

  it('labels a suggested join and a type change', () => {
    let s = stateOf(block('action', 'A.'), block('action', 'B.'));
    s = suggest(s, (tr) => tr.delete(at(s, 0, 2), at(s, 1, 0)));
    s = suggest(s, (tr) => tr.setBlockType(at(s, 1), at(s, 1), testSchema.nodes.shot));
    expect(buildSuggestionDecorations(s.doc).find()).toHaveLength(2);
  });
});

describe('suggestions and Revision Mode', () => {
  it('a suggestion is not a revision; accepting it makes one', async () => {
    const { getSchema } = await import('@tiptap/core');
    const { testExtensions } = await import('../test/screenplaySchema');
    const { RevisionMark, RevisionTextStyle } = await import('./extensions/RevisionMark');
    const { InkAwareColor } = await import('./extensions/InkAwareColor');
    const { revisionMarksPlugin } = await import('./revisionMarks');
    const schema = getSchema([...testExtensions, RevisionTextStyle, InkAwareColor, RevisionMark]);
    let s = EditorState.create({
      schema,
      doc: schema.nodeFromJSON(doc(block('action', 'She waits.'))),
      plugins: [revisionMarksPlugin(() => ({ enabled: true, color: 'Blue' }))],
    });
    const revisedText = (st: EditorState) => {
      let out = '';
      st.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'textStyle' && m.attrs.revision)) out += n.text; });
      return out;
    };
    s = s.apply(suggestTransaction(s, s.tr.insertText(' Alone', 10), { by: 'Ann', now: 1 }));
    expect(revisedText(s)).toBe('');
    s = s.apply(resolveSuggestionsTransaction(s, () => true, true)!);
    expect(s.doc.textContent).toBe('She waits Alone.');
    expect(revisedText(s)).toBe(' Alone');
  });
});
