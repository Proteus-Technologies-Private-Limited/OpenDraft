import { describe, it, expect } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { history, undo, redo, closeHistory } from '@tiptap/pm/history';
import { testExtensions, block, doc } from '../test/screenplaySchema';
import {
  hasSuggestions,
  discardOverriddenFormats,
  listSuggestions,
  resolveSuggestionsTransaction,
  resolveSuggestionTransaction,
  suggestTransaction,
  suggestionAt,
  SUGGESTIBLE_FORMATS,
  SUGGEST_FORMAT,
  withoutSuggestionsJSON,
} from './suggestions';
import { REVISION_SKIP_META } from './revisionMarks';
const schema = getSchema([...testExtensions, Subscript, Superscript]);
const stateOf = (content: JSONContent = doc(block('action', 'One two three.'))) =>
  EditorState.create({ schema, doc: schema.nodeFromJSON(content), plugins: [history()] });
const suggest = (s: EditorState, tr: Transaction, by = 'Ann', blocked?: (why: string) => void) =>
  s.apply(suggestTransaction(s, tr, { by, uid: by, now: 100, onBlocked: blocked }));
const resolve = (s: EditorState, accept: boolean) =>
  s.apply(resolveSuggestionsTransaction(s, () => true, accept)!);
const markNames = (s: EditorState) => s.doc.child(0).firstChild!.marks.map((m) => m.type.name);
describe('reversible character formatting', () => {
  for (const format of SUGGESTIBLE_FORMATS) {
    it(`suggests adding ${format}, retaining baseline export and resolving either way`, () => {
      const original = stateOf();
      const s = suggest(original, original.tr.addMark(1, 4, schema.marks[format].create()));
      expect(markNames(s)).toContain(format);
      expect(hasSuggestions(s.doc)).toBe(true);
      expect(listSuggestions(s.doc)).toMatchObject([
        {
          by: 'Ann',
          uid: 'Ann',
          kinds: ['format'],
          formatted: 'One',
          formats: [{ format, before: false, after: true }],
        },
      ]);
      expect(suggestionAt(s.doc, 2)?.by).toBe('Ann');
      const clean = schema.nodeFromJSON(withoutSuggestionsJSON(s.doc.toJSON()));
      expect(clean.textContent).toBe(original.doc.textContent);
      clean.descendants((n) => {
        if (n.isText) expect(n.marks).toHaveLength(0);
      });
      expect(resolve(s, false).doc.toJSON()).toEqual(original.doc.toJSON());
      expect(markNames(resolve(s, true))).toEqual([format]);
      expect(hasSuggestions(resolve(s, true).doc)).toBe(false);
      expect(original.doc.child(0).firstChild!.marks).toHaveLength(0);
    });
    it(`suggests removing ${format} without exporting the removal`, () => {
      const original = stateOf(
        doc({
          type: 'action',
          content: [{ type: 'text', text: 'One two.', marks: [{ type: format }] }],
        }),
      );
      const s = suggest(original, original.tr.removeMark(1, 4, schema.marks[format]));
      expect(markNames(s)).not.toContain(format);
      expect(
        withoutSuggestionsJSON(s.doc.toJSON()).content![0].content!.every((n) =>
          n.marks?.some((m) => m.type === format),
        ),
      ).toBe(true);
      expect(markNames(resolve(s, false))).toEqual([format]);
      expect(markNames(resolve(s, true))).toEqual([]);
    });
  }
  it('groups a multi-style command into one review change and restores unrelated marks', () => {
    const s = stateOf();
    const next = suggest(
      s,
      s.tr.addMark(1, 4, schema.marks.bold.create()).addMark(1, 4, schema.marks.italic.create()),
    );
    expect(listSuggestions(next.doc)).toHaveLength(1);
    expect(listSuggestions(next.doc)[0].formats).toHaveLength(2);
    expect(listSuggestions(next.doc)[0].formatted).toBe('One');
    expect(resolve(next, false).doc.toJSON()).toEqual(s.doc.toJSON());
    expect(markNames(resolve(next, true))).toEqual(['bold', 'italic']);
  });
  it('partially withdraws your own proposal by toggling back, retaining its baseline', () => {
    let s = stateOf();
    s = suggest(s, s.tr.addMark(1, 8, schema.marks.bold.create()));
    s = suggest(s, s.tr.removeMark(1, 4, schema.marks.bold));
    expect(s.doc.child(0).firstChild!.marks).toHaveLength(0);
    expect(listSuggestions(s.doc)[0].formatted).toBe(' two');
    s = suggest(s, s.tr.removeMark(4, 8, schema.marks.bold));
    expect(hasSuggestions(s.doc)).toBe(false);
  });
  it('blocks another author on the same style but allows an independent style', () => {
    let s = stateOf();
    s = suggest(s, s.tr.addMark(1, 8, schema.marks.bold.create()));
    const before = s.doc.toJSON();
    const blocked: string[] = [];
    s = suggest(s, s.tr.removeMark(1, 8, schema.marks.bold), 'Bob', (why) => blocked.push(why));
    expect(s.doc.toJSON()).toEqual(before);
    expect(blocked).toEqual(['formatConflict']);
    s = suggest(s, s.tr.addMark(1, 8, schema.marks.italic.create()), 'Bob');
    expect(listSuggestions(s.doc)).toHaveLength(2);
    const bob = listSuggestions(s.doc).find((x) => x.by === 'Bob')!;
    s = s.apply(resolveSuggestionTransaction(s, bob.id, false)!);
    expect(markNames(s)).toContain('bold');
    expect(markNames(s)).not.toContain('italic');
  });
  it('styles your own suggested insertion as part of that insertion', () => {
    let s = stateOf();
    s = suggest(s, s.tr.insertText('New ', 1));
    s = suggest(s, s.tr.addMark(1, 5, schema.marks.bold.create()));
    expect(listSuggestions(s.doc)).toHaveLength(1);
    expect(listSuggestions(s.doc)[0].kinds).toEqual(['insert']);
    expect(markNames(resolve(s, true))).toEqual(['bold']);
    expect(resolve(s, false).doc.textContent).toBe('One two three.');
  });
  it('keeps paragraph boundaries, hard breaks, notes and Unicode intact', () => {
    const original = stateOf(
      doc(
        {
          type: 'action',
          content: [
            {
              type: 'text',
              text: '你好🙂',
              marks: [{ type: 'scriptNote', attrs: { noteId: 'note' } }],
            },
            { type: 'hardBreak' },
            { type: 'text', text: 'next' },
          ],
        },
        block('dialogue', 'More.'),
      ),
    );
    const s = suggest(
      original,
      original.tr.addMark(1, original.doc.content.size - 1, schema.marks.underline.create()),
    );
    expect(s.doc.textContent).toBe(original.doc.textContent);
    expect(s.doc.childCount).toBe(2);
    expect(resolve(s, false).doc.toJSON()).toEqual(original.doc.toJSON());
  });
  it('preserves formatting proposals in native JSON and supports undo/redo after accepting', () => {
    const original = stateOf();
    let s = suggest(original, original.tr.addMark(1, 4, schema.marks.bold.create()));
    s = EditorState.create({
      schema,
      doc: schema.nodeFromJSON(s.doc.toJSON()),
      plugins: [history()],
    });
    s = resolve(s, true);
    expect(markNames(s)).toEqual(['bold']);
    expect(
      undo(s, (tr) => {
        s = s.apply(tr);
      }),
    ).toBe(true);
    expect(markNames(s)).toContain(SUGGEST_FORMAT);
    expect(
      redo(s, (tr) => {
        s = s.apply(tr);
      }),
    ).toBe(true);
    expect(markNames(s)).toEqual(['bold']);
  });
  it('does not call a proposal a revision, but accepting marks the affected text as revised', async () => {
    const { RevisionMark, RevisionTextStyle } = await import('./extensions/RevisionMark');
    const { revisionMarksPlugin, revisionOf } = await import('./revisionMarks');
    const revisionSchema = getSchema([...testExtensions, RevisionTextStyle, RevisionMark]);
    let s = EditorState.create({
      schema: revisionSchema,
      doc: revisionSchema.nodeFromJSON(doc(block('action', 'One two.'))),
      plugins: [revisionMarksPlugin(() => ({ enabled: true, color: 'Blue' }))],
    });
    const tr = suggestTransaction(s, s.tr.addMark(1, 4, revisionSchema.marks.bold.create()), {
      by: 'Ann',
    });
    expect(tr.getMeta(REVISION_SKIP_META)).toBe(true);
    s = s.apply(tr);
    expect(revisionOf(s.doc.child(0).firstChild!)).toBeNull();
    s = resolve(s, true);
    expect(revisionOf(s.doc.child(0).firstChild!)).toBe('Blue');
  });
});

it('merges simultaneous agreeing proposals without losing either reviewer, and resolves them safely', async () => {
  const Y = await import('yjs');
  const { updateYFragment, yDocToProsemirrorJSON } = await import('y-prosemirror');
  const { checkSuggesterUpdate } = await import(
    '../../../collab-server/src/services/suggestionGuard'
  );
  const base = stateOf(),
    seed = new Y.Doc();
  const write = (ydoc: InstanceType<typeof Y.Doc>, s: EditorState) =>
    updateYFragment(ydoc, ydoc.getXmlFragment('default'), s.doc, {
      mapping: new Map(),
      isOMark: new Map(),
    });
  write(seed, base);
  const initial = Y.encodeStateAsUpdate(seed),
    vector = Y.encodeStateVector(seed);
  const [a, b, server] = Array.from({ length: 3 }, () => {
    const d = new Y.Doc();
    Y.applyUpdate(d, initial);
    return d;
  });
  write(a, suggest(base, base.tr.addMark(1, 4, schema.marks.bold.create()), 'Ann'));
  write(b, suggest(base, base.tr.addMark(1, 4, schema.marks.bold.create()), 'Bob'));
  Y.applyUpdate(server, Y.encodeStateAsUpdate(a, vector));
  const updateB = Y.encodeStateAsUpdate(b, vector);
  expect(
    checkSuggesterUpdate(
      Y as unknown as import('../../../collab-server/src/services/suggestionGuard').YjsLike,
      server,
      updateB,
      { name: 'Bob', uid: 'Bob' },
    ),
  ).toBeNull();
  Y.applyUpdate(server, updateB);
  const merged = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(yDocToProsemirrorJSON(server, 'default')),
  });
  expect(listSuggestions(merged.doc)).toHaveLength(2);
  const ann = listSuggestions(merged.doc).find((s) => s.by === 'Ann')!;
  const withdrawn = merged.apply(resolveSuggestionTransaction(merged, ann.id, false)!);
  expect(markNames(withdrawn)).toContain('bold');
  expect(listSuggestions(withdrawn.doc)).toHaveLength(1);
  expect(schema.nodeFromJSON(withoutSuggestionsJSON(withdrawn.doc.toJSON())).textContent).toBe(
    base.doc.textContent,
  );
  expect(
    withoutSuggestionsJSON(withdrawn.doc.toJSON()).content![0].content!.every(
      (n) => !n.marks?.length,
    ),
  ).toBe(true);
  expect(hasSuggestions(resolve(merged, true).doc)).toBe(false);
  expect(markNames(resolve(merged, true))).toEqual(['bold']);
  expect(resolve(withdrawn, false).doc.toJSON()).toEqual(base.doc.toJSON());
  for (const d of [seed, a, b, server]) d.destroy();
});

it('writes only accepted formatting into a Final Draft export', async () => {
  const { exportFDX } = await import('../utils/fdxExporter');
  const original = stateOf();
  const pending = suggest(original, original.tr.addMark(1, 4, schema.marks.bold.create()));
  const pattern = /<Text\b[^>]*Style="Bold"[^>]*>One<\/Text>/;
  expect(exportFDX(withoutSuggestionsJSON(pending.doc.toJSON()))).not.toMatch(pattern);
  expect(exportFDX(withoutSuggestionsJSON(resolve(pending, true).doc.toJSON()))).toMatch(pattern);
  expect(exportFDX(withoutSuggestionsJSON(resolve(pending, false).doc.toJSON()))).not.toMatch(
    pattern,
  );
});

describe('review follow-ups', () => {
  it('direct editor styling settles only that style in the edited range, in one undo step', () => {
    const original = stateOf();
    const pending = suggest(original, original.tr.addMark(1, 4, schema.marks.bold.create()).addMark(1, 4, schema.marks.italic.create()));
    const direct = pending.apply(discardOverriddenFormats(pending.tr.removeMark(1, 2, schema.marks.bold)));
    expect(direct.doc.nodeAt(1)?.marks.some(mark => mark.type.name === 'bold')).toBe(false);
    expect(direct.doc.nodeAt(1)?.marks.filter(mark => mark.type.name === SUGGEST_FORMAT).map(mark => mark.attrs.format)).toEqual(['italic']);
    const accepted = resolve(direct, true);
    expect(accepted.doc.nodeAt(1)?.marks.map(mark => mark.type.name)).toEqual(['italic']);
    expect(accepted.doc.nodeAt(2)?.marks.map(mark => mark.type.name)).toEqual(['bold', 'italic']);
  });
  it('does not restore an overridden style when accepting or rejecting a stale legacy proposal', () => {
    const original = stateOf();
    const pending = suggest(original, original.tr.addMark(1, 4, schema.marks.bold.create()));
    const legacyEdit = pending.apply(pending.tr.removeMark(1, 4, schema.marks.bold));
    expect(markNames(resolve(legacyEdit, true))).not.toContain('bold');
    expect(markNames(resolve(legacyEdit, false))).not.toContain('bold');
  });
  it('direct styling creates one undoable edit including settlement of the proposal', () => {
    const original = stateOf();
    const pending = suggest(original, original.tr.addMark(1, 4, schema.marks.bold.create()));
    let state = pending.apply(closeHistory(discardOverriddenFormats(pending.tr.removeMark(1, 4, schema.marks.bold))));
    expect(listSuggestions(state.doc)).toHaveLength(0);
    expect(undo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.toJSON()).toEqual(pending.doc.toJSON());
  });
  it('Clear Formatting on only a pending remove proposal stays pending without a blocked edit', () => {
    const original = stateOf(doc({ type: 'action', content: [{ type: 'text', text: 'One', marks: [{ type: 'bold' }] }] }));
    const pending = suggest(original, original.tr.removeMark(1, 4, schema.marks.bold));
    const blocked: string[] = [];
    const cleared = suggest(pending, pending.tr.removeMark(1, 4), 'Ann', why => blocked.push(why));
    expect(cleared.doc.toJSON()).toEqual(pending.doc.toJSON());
    expect(blocked).toEqual([]);
    expect(listSuggestions(cleared.doc)[0].formats).toEqual([{ format: 'bold', before: true, after: false }]);
  });
  it('Clear Formatting withdraws your own pending addition but cannot withdraw another reviewer’s', () => {
    const original = stateOf();
    const pending = suggest(original, original.tr.addMark(1, 4, schema.marks.bold.create()));
    expect(suggest(pending, pending.tr.removeMark(1, 4)).doc.toJSON()).toEqual(original.doc.toJSON());
    const blocked: string[] = [];
    const other = suggest(pending, pending.tr.removeMark(1, 4), 'Bob', why => blocked.push(why));
    expect(other.doc.toJSON()).toEqual(pending.doc.toJSON());
    expect(blocked).toEqual(['formatConflict']);
  });
});
