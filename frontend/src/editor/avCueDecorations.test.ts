/**
 * Derived cue values must stay current when a SIBLING row changes.
 *
 * A node view only re-renders when its own node changes. Shot numbers and start
 * times depend on the rows above, so computing them inside the row's view left
 * every row below an insertion stale — two rows both reading "2. 0:05" until
 * something else forced a redraw. The plugin recomputes them for the whole body
 * on each doc change and publishes them as node decorations, which Tiptap does
 * re-render a node view for.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Plugin } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { testSchema } from '../test/screenplaySchema';
import { AvCueDecorations, cueFromDecorations, avCuePluginKey } from './extensions/AvBlock';

const cell = (side: 'video' | 'audio') => ({
  type: 'avCell', attrs: { side }, content: [{ type: 'avPara' }],
});
const row = (duration: string | null) => ({
  type: 'avRow', attrs: { duration, shot: null, start: null },
  content: [cell('video'), cell('audio')],
});
const docOf = (...durations: (string | null)[]) =>
  testSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'avBlock', content: durations.map(row) }] });

/** Run the extension's plugin and read back the decorations it produced. */
function cueValues(doc: ReturnType<typeof docOf>) {
  const plugins = (AvCueDecorations.config.addProseMirrorPlugins as () => Plugin[]).call(
    { name: 'avCueDecorations', options: {}, storage: {}, editor: null } as never,
  );
  const state = EditorState.create({ doc, schema: testSchema, plugins });
  const plugin = avCuePluginKey.get(state);
  if (!plugin) throw new Error('cue plugin not registered');
  // `decorations` is typed as returning a DecorationSource; this plugin always
  // returns a DecorationSet, which is what exposes find().
  const set = plugin.props.decorations?.call(plugin, state) as unknown as DecorationSet;
  return set.find().map(deco => {
    const d = deco as unknown as { from: number; type: { attrs: Record<string, string> } };
    return { from: d.from, shot: d.type.attrs['data-av-shot'], start: d.type.attrs['data-av-start'] };
  });
}

/** The plugin's own state, so a test can compare instances across a
 *  transaction rather than only the values it publishes. */
function pluginState(state: EditorState): DecorationSet {
  return avCuePluginKey.getState(state) as unknown as DecorationSet;
}

function stateOf(doc: ReturnType<typeof docOf>): EditorState {
  const plugins = (AvCueDecorations.config.addProseMirrorPlugins as () => Plugin[]).call(
    { name: 'avCueDecorations', options: {}, storage: {}, editor: null } as never,
  );
  return EditorState.create({ doc, schema: testSchema, plugins });
}

describe('AvCueDecorations', () => {
  it('numbers rows and accumulates start times across the body', () => {
    expect(cueValues(docOf('0:05', '0:10', '1:00')).map(d => [d.shot, d.start]))
      .toEqual([['1.', '0:00'], ['2.', '0:05'], ['3.', '0:15']]);
  });

  it('renumbers and re-times everything below an inserted row', () => {
    // The bug: rows below an insertion kept their old values.
    const before = cueValues(docOf('0:05', '0:10'));
    const after = cueValues(docOf('0:05', '0:20', '0:10'));
    expect(before.map(d => [d.shot, d.start])).toEqual([['1.', '0:00'], ['2.', '0:05']]);
    expect(after.map(d => [d.shot, d.start]))
      .toEqual([['1.', '0:00'], ['2.', '0:05'], ['3.', '0:25']]);
  });

  it('renumbers after a row is deleted', () => {
    expect(cueValues(docOf('0:20', '0:10', '1:30')).map(d => [d.shot, d.start]))
      .toEqual([['1.', '0:00'], ['2.', '0:20'], ['3.', '0:30']]);
  });

  it('emits one decoration per row, anchored at the row', () => {
    const decos = cueValues(docOf('0:05', '0:10'));
    expect(decos).toHaveLength(2);
    expect(decos[0].from).toBeLessThan(decos[1].from);
  });

  it('keeps numbering rows that have no duration yet', () => {
    expect(cueValues(docOf(null, '0:10', null)).map(d => d.shot)).toEqual(['1.', '2.', '3.']);
  });
});

describe('cueFromDecorations', () => {
  it('reads the values a node view was handed', () => {
    expect(cueFromDecorations([{ type: { attrs: { 'data-av-shot': '4.', 'data-av-start': '1:20' } } }]))
      .toEqual({ shot: '4.', start: '1:20' });
  });

  it('returns null when there is nothing to read, so the view can fall back', () => {
    expect(cueFromDecorations([])).toBeNull();
    expect(cueFromDecorations(undefined)).toBeNull();
    expect(cueFromDecorations([{ type: { attrs: { class: 'unrelated' } } }])).toBeNull();
  });
});

describe('AvCueDecorations recomputation', () => {
  it('rebuilds when the document changes', () => {
    const state = stateOf(docOf('0:05', '0:10'));
    // Retype the first row's duration; every start below it has to follow.
    let rowPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'avRow' && rowPos < 0) rowPos = pos;
      return rowPos < 0;
    });
    const tr = state.tr.setNodeMarkup(rowPos, undefined, { duration: '1:00', shot: null, start: null });
    const next = state.apply(tr);
    const values = pluginState(next).find().map(d => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-av-start']);
    expect(values).toEqual(['0:00', '1:00']);
  });

  it('reuses the same set when a transaction only moves the caret', () => {
    // The reason it is plugin state at all: `decorations(state)` is consulted
    // on every state change, so rebuilding there walked the whole document
    // each time the cursor moved.
    const state = stateOf(docOf('0:05', '0:10'));
    const before = pluginState(state);
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    expect(pluginState(moved)).toBe(before);
  });
});
