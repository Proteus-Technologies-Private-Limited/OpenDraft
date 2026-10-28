import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';
import { testSchema, block, doc } from '../test/screenplaySchema';
import { parseOdraft, serializeOdraft } from './odraftFormat';
import type { ScriptMeta } from '../services/api';
import { bookmarkPluginKey, createBookmarkPlugin, duplicateBookmarks } from '../editor/extensions/Bookmark';
import {
  bookmarkTargetAt, cleanBookmarkName, listBookmarks, setBookmark, suggestBookmarkName, uniqueBookmarkName,
} from './bookmarks';

const marked = (type: string, text: string, bookmark: string) => ({ ...block(type, text), attrs: { bookmark } });

function state(...blocks: Parameters<typeof doc>) {
  return EditorState.create({
    schema: testSchema,
    doc: testSchema.nodeFromJSON(doc(...blocks)),
    plugins: [createBookmarkPlugin()],
  });
}

describe('bookmarks', () => {
  it('lists bookmarks in script order, including inside dual dialogue', () => {
    const s = state(
      marked('sceneHeading', 'INT. KITCHEN - DAY', 'Opening'),
      block('action', 'Nothing here.'),
      {
        type: 'dualDialogue',
        content: [
          { type: 'dualDialogueColumn', content: [block('character', 'A'), marked('dialogue', 'Left line.', 'Overlap')] },
          { type: 'dualDialogueColumn', content: [block('character', 'B'), block('dialogue', 'Right.')] },
        ],
      },
    );
    expect(listBookmarks(s.doc).map((b) => [b.name, b.blockType, b.text])).toEqual([
      ['Opening', 'sceneHeading', 'INT. KITCHEN - DAY'],
      ['Overlap', 'dialogue', 'Left line.'],
    ]);
  });

  it('round-trips through the document JSON a script is saved as', () => {
    const s = state(marked('action', 'She runs.', 'Chase'));
    const back = testSchema.nodeFromJSON(s.doc.toJSON());
    expect(listBookmarks(back).map((b) => b.name)).toEqual(['Chase']);
  });

  it('survives an .odraft save and open', () => {
    const s = state(marked('action', 'She runs.', 'Chase'));
    const meta = { id: 's1', title: 'T', author: '', color: '', page_count: 1 } as ScriptMeta;
    const parsed = parseOdraft(serializeOdraft(meta, s.doc.toJSON()));
    const back = testSchema.nodeFromJSON(parsed.content);
    expect(listBookmarks(back).map((b) => b.name)).toEqual(['Chase']);
  });

  it('ignores a bookmark attribute it does not know from an older or newer file', () => {
    const json = doc({ ...block('action', 'x'), attrs: { bookmark: 'Kept', somethingNew: 1 } });
    expect(listBookmarks(testSchema.nodeFromJSON(json)).map((b) => b.name)).toEqual(['Kept']);
  });

  it('targets the innermost text element at a position', () => {
    const s = state(block('action', 'First.'), block('dialogue', 'Second.'));
    const target = bookmarkTargetAt(s.doc, 10)!;
    expect(target.node.type.name).toBe('dialogue');
    expect(target.pos).toBe(s.doc.child(0).nodeSize);
  });

  it('sets, renames and clears a bookmark as an undoable step', () => {
    let s = state(block('action', 'First.'), block('action', 'Second.'));
    const pos = s.doc.child(0).nodeSize;
    let tr = s.tr;
    expect(setBookmark(tr, pos, '  Big   reveal ')).toBe(true);
    s = s.apply(tr);
    expect(listBookmarks(s.doc).map((b) => [b.name, b.pos])).toEqual([['Big reveal', pos]]);
    tr = s.tr;
    setBookmark(tr, pos, '');
    s = s.apply(tr);
    expect(listBookmarks(s.doc)).toEqual([]);
  });

  it('will not bookmark something that is not a text element', () => {
    const s = state(block('action', 'x'));
    expect(setBookmark(s.tr, 0 + s.doc.content.size, 'x')).toBe(false);
  });

  it('moves with its element when text is inserted above', () => {
    let s = state(block('action', 'Top.'), marked('action', 'Marked.', 'Here'));
    s = s.apply(s.tr.insert(0, testSchema.nodeFromJSON(block('action', 'New line above.'))));
    expect(listBookmarks(s.doc).map((b) => b.text)).toEqual(['Marked.']);
  });

  it('keeps a bookmark on the original half when its line is split', () => {
    const text = 'Marked line.';
    for (const at of [5, 0]) {
      let s = state(marked('action', text, 'Here'), block('action', 'After.'));
      // A plain split copies attributes to both halves, as a mid-line Enter does.
      s = s.applyTransaction(s.tr.split(1 + at)).state;
      const flagged = listBookmarks(s.doc);
      expect(flagged).toHaveLength(1);
      expect(text.startsWith(flagged[0].text)).toBe(true);
      expect(flagged[0].text).not.toBe('');
    }
  });

  it('finds every copy of a name but the first one with text', () => {
    const s = state({ type: 'action', attrs: { bookmark: 'A' } }, marked('action', 'x', 'a'), marked('action', 'y', 'A'), marked('action', 'z', 'B'));
    const positions: number[] = [];
    s.doc.forEach((_, offset) => positions.push(offset));
    expect(duplicateBookmarks(s.doc)).toEqual([positions[0], positions[2]]);
  });

  it('names: cleans, suggests from the text, and keeps names unique', () => {
    expect(cleanBookmarkName('  a\nb  ')).toBe('a b');
    const s = state(marked('action', 'x', 'Reveal'), block('sceneHeading', 'INT. A VERY LONG LOCATION NAME THAT GOES ON - NIGHT'));
    expect(uniqueBookmarkName(s.doc, 'reveal')).toBe('reveal 2');
    expect(uniqueBookmarkName(s.doc, 'Reveal', 0)).toBe('Reveal');
    expect(suggestBookmarkName(s.doc, s.doc.child(1))).toBe('INT. A VERY LONG LOCATION NAME THAT GOES…');
  });

  it('draws a flag for each bookmark', () => {
    const s = state(marked('action', 'a', 'One'), block('action', 'b'), marked('action', 'c', 'Two'));
    expect(bookmarkPluginKey.getState(s)!.find().length).toBe(2);
  });

  it('drops a pasted bookmark whose name is already used, keeps a free one', () => {
    const s = state(marked('action', 'a', 'One'));
    const pasted = testSchema.nodeFromJSON(doc(marked('action', 'copy', 'One'), marked('action', 'moved', 'Two'))).content;
    const plugin = s.plugins.find((p) => p.spec.key === bookmarkPluginKey)!;
    const view = { state: s } as unknown as Parameters<NonNullable<typeof plugin.props.transformPasted>>[1];
    const out = plugin.props.transformPasted!.call(plugin, new Slice(pasted, 0, 0), view, false);
    const names: Array<string | null> = [];
    out.content.forEach((n) => names.push(n.attrs.bookmark));
    expect(names).toEqual([null, 'Two']);
  });
});
