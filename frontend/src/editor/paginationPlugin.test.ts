import { describe, it, expect, vi } from 'vitest';
import { DecorationSet } from '@tiptap/pm/view';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createPaginationPlugin, buildTemplateHints, type PaginationState, paginationPluginKey, TITLE_REGION_CLASS } from './pagination';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { buildFootnotePlan } from '../utils/footnotes';
import { testSchema, block, doc, marked, pmDoc } from '../test/screenplaySchema';

const hints = () => buildTemplateHints({ forceBreakBefore: ['newAct'] });

function makeState(json: ReturnType<typeof doc>) {
  const plugin = createPaginationPlugin(() => {}, () => DEFAULT_PAGE_LAYOUT, hints);
  return {
    plugin,
    state: EditorState.create({ doc: pmDoc(json), plugins: [plugin] }),
  };
}

/** The margin-top each break decoration puts on its element, in document order. */
function decorationMargins(plugin: ReturnType<typeof createPaginationPlugin>, state: EditorState): number[] {
  const set = plugin.props.decorations!.call(plugin, state) as unknown as {
    find: () => { from: number; to: number; type: { attrs?: { style?: string } } }[];
  };
  return set
    .find()
    .sort((a, b) => a.from - b.from)
    .map((d) => {
      const style = (d.type as { attrs?: { style?: string } }).attrs?.style || '';
      return Number(/margin-top:\s*(-?\d+)px/.exec(style)?.[1] ?? NaN);
    });
}

const breaksOf = (state: EditorState) =>
  (paginationPluginKey.getState(state) as PaginationState).breaks;

describe('pagination plugin — inserting an act before an existing one', () => {
  it('keeps a break before the following act after the insert transaction', () => {
    // Start with content, then a single act at the end.
    const { plugin, state } = makeState(doc(
      block('action', 'Opening action.'),
      block('newAct', 'ACT TWO'),
    ));

    expect(breaksOf(state).map((b) => b.nodeIndex)).toEqual([1]);

    // Insert an empty act immediately before the existing one — the exact
    // gesture that made the following act jump back onto the current page.
    const insertPos = state.doc.child(0).nodeSize; // start of the existing act
    const tr = state.tr.insert(insertPos, testSchema.nodes.newAct.create());
    const next = state.apply(tr);

    const breaks = breaksOf(next);
    expect(breaks.map((b) => b.nodeIndex)).toEqual([1, 2]);

    // Both breaks must reach the DOM as decorations, or the second act renders
    // on the same page as the one just inserted.
    const margins = decorationMargins(plugin, next);
    expect(margins).toHaveLength(2);
    expect(margins.every((m) => Number.isFinite(m) && m > 0)).toBe(true);
  });

  it('places the following act exactly one page pitch below the inserted act', () => {
    const { plugin, state } = makeState(doc(
      block('action', 'Opening action.'),
      block('newAct', 'ACT TWO'),
    ));
    const insertPos = state.doc.child(0).nodeSize;
    const next = state.apply(state.tr.insert(insertPos, testSchema.nodes.newAct.create()));

    const [, secondMargin] = decorationMargins(plugin, next);
    // The inserted act occupies one line at the top of its page; the next act
    // must clear the rest of that page plus the separator.
    const LINE = 16;
    const contentHeight = DEFAULT_PAGE_LAYOUT.pageHeight * 72
      - DEFAULT_PAGE_LAYOUT.topMargin - DEFAULT_PAGE_LAYOUT.bottomMargin;
    const linesPerPage = Math.floor(contentHeight / 12);
    const sep = Math.round(
      (DEFAULT_PAGE_LAYOUT.bottomMargin / 72) * 96 + 40 + (DEFAULT_PAGE_LAYOUT.topMargin / 72) * 96,
    );
    expect(secondMargin).toBe((linesPerPage - 1) * LINE + sep);
  });

  it('survives a following selection-only transaction', () => {
    // apply() short-circuits when !tr.docChanged; the cached state must still
    // describe both breaks.
    const { plugin, state } = makeState(doc(
      block('action', 'Opening action.'),
      block('newAct', 'ACT TWO'),
    ));
    const insertPos = state.doc.child(0).nodeSize;
    const afterInsert = state.apply(state.tr.insert(insertPos, testSchema.nodes.newAct.create()));
    const afterSelection = afterInsert.apply(afterInsert.tr.scrollIntoView());

    expect(breaksOf(afterSelection).map((b) => b.nodeIndex)).toEqual([1, 2]);
    expect(decorationMargins(plugin, afterSelection)).toHaveLength(2);
  });

  it('gives the same result as typing text into the inserted act', () => {
    const { plugin, state } = makeState(doc(
      block('action', 'Opening action.'),
      block('newAct', 'ACT TWO'),
    ));
    const insertPos = state.doc.child(0).nodeSize;
    const empty = state.apply(state.tr.insert(insertPos, testSchema.nodes.newAct.create()));
    const typed = empty.apply(empty.tr.insertText('ACT THREE', insertPos + 1));

    expect(decorationMargins(plugin, typed)).toEqual(decorationMargins(plugin, empty));
  });
});

describe('pagination plugin — oversized paragraph line grid', () => {
  // Long enough that one action paragraph is taller than a page.
  const sentence = 'The rain keeps falling on the empty street while nobody moves. ';
  const oversized = sentence.repeat(120).trim();

  function lineWidgets(plugin: ReturnType<typeof createPaginationPlugin>, state: EditorState) {
    const set = plugin.props.decorations!.call(plugin, state) as unknown as {
      find: () => { from: number; type: { spec?: { key?: string }; toDOM?: unknown } }[];
    };
    return set.find().filter((d) => d.type.spec?.key?.startsWith('sp-paragraph-line-'));
  }

  it('marks the grid line breaks so phone view can drop them, with stable keys', () => {
    const { plugin, state } = makeState(doc(block('action', oversized)));
    expect(breaksOf(state).some((b) => b.contentOffset !== undefined)).toBe(true);

    const widgets = lineWidgets(plugin, state);
    expect(widgets.length).toBeGreaterThan(50);
    const keys = widgets.map((w) => w.type.spec!.key);
    expect(new Set(keys).size).toBe(keys.length);

    // A selection-only update rebuilds the decorations with the same keys, so
    // ProseMirror keeps the existing <br> elements instead of recreating them.
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));
    expect(lineWidgets(plugin, moved).map((w) => w.type.spec!.key)).toEqual(keys);

  });
});

describe('pagination plugin — decorations are reused while nothing they show has changed', () => {
  const longScript = () => doc(...Array.from({ length: 120 }, (_, i) => block('action', `Line ${i} of the script.`)));
  const decorationsOf = (plugin: ReturnType<typeof createPaginationPlugin>, state: EditorState) =>
    plugin.props.decorations!.call(plugin, state);

  it('hands back the same set for a caret move, and a new one for an edit', () => {
    const { plugin, state } = makeState(longScript());
    expect(breaksOf(state).length).toBeGreaterThan(0);
    const first = decorationsOf(plugin, state);
    expect(decorationsOf(plugin, state)).toBe(first);

    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));
    expect(decorationsOf(plugin, moved)).toBe(first);

    const edited = moved.apply(moved.tr.insertText('x', 5));
    const after = decorationsOf(plugin, edited);
    expect(after).not.toBe(first);
    expect(decorationMargins(plugin, edited)).toEqual(decorationMargins(plugin, state));
  });

  function expectFreshDecorations(plugin: ReturnType<typeof createPaginationPlugin>, state: EditorState) {
    const fresh = makeState(state.doc.toJSON());
    const actual = (decorationsOf(plugin, state) as DecorationSet).find();
    const expected = (decorationsOf(fresh.plugin, fresh.state) as DecorationSet).find();
    expect(actual).toEqual(expected);
    expect(paginationPluginKey.getState(state)).toEqual(paginationPluginKey.getState(fresh.state));
  }

  it('maps typing and Backspace without rebuilding decorations for the whole document', () => {
    const { plugin, state: initial } = makeState(longScript());
    let state = initial;
    decorationsOf(plugin, state);
    // Exercise an undecorated block and a block carrying a page-start margin.
    for (const pos of [5, breaksOf(state)[0].offset + 1]) {
      const create = vi.spyOn(DecorationSet, 'create');
      try {
        state = state.apply(state.tr.insertText('x', pos));
        decorationsOf(plugin, state);
        state = state.apply(state.tr.delete(pos, pos + 1));
        decorationsOf(plugin, state);
        expect(create).not.toHaveBeenCalled();
      } finally {
        create.mockRestore();
      }
      expectFreshDecorations(plugin, state);
    }
    expect(state.doc.eq(initial.doc)).toBe(true);
  });

  it('keeps mapped positions correct across edits and title-page decorations', () => {
    const { plugin, state: initial } = makeState(doc(block('titlePage', 'THE SCRIPT'), ...longScript().content!));
    let state = initial;
    decorationsOf(plugin, state);
    for (const pos of [1, 3, breaksOf(state)[0].offset + 1, state.doc.content.size - 1]) {
      state = state.apply(state.tr.insertText('abc', pos));
      expectFreshDecorations(plugin, state);
      state = state.apply(state.tr.delete(pos, pos + 3));
      expectFreshDecorations(plugin, state);
    }
    expect(state.doc.eq(initial.doc)).toBe(true);
  });

  it('rebuilds when wrapping moves a break, a block splits, or repagination is forced', () => {
    const { plugin, state } = makeState(longScript());
    for (const transaction of [
      state.tr.insertText('More words on this line. '.repeat(8), 5),
      state.tr.split(5),
      state.tr.insertText('x', 5).setMeta('forceRepaginate', true),
    ]) {
      decorationsOf(plugin, state);
      const create = vi.spyOn(DecorationSet, 'create');
      let edited: EditorState;
      try {
        edited = state.apply(transaction);
        decorationsOf(plugin, edited);
        expect(create).toHaveBeenCalled();
      } finally {
        create.mockRestore();
      }
      expectFreshDecorations(plugin, edited!);
    }
  });

  it('rebuilds when printing notes reserve page space', () => {
    const json = doc(marked('action', 'Referenced action.', {
      type: 'scriptNote', attrs: { noteId: 'n1', color: '#f4d35e' },
    }), ...longScript().content!);
    const layout = {
      ...DEFAULT_PAGE_LAYOUT,
      footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true },
    };
    const plan = buildFootnotePlan(json, layout, [{
      id: 'n1', content: 'A printing note.', anchorText: '', elementType: 'action',
      contextLabel: '', color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z',
      sceneId: null, printInScript: true,
    }], { assets: [], assetUrl: () => null });
    expect(plan).not.toBeNull();
    const plugin = createPaginationPlugin(() => {}, () => layout, hints, () => plan);
    const state = EditorState.create({ doc: pmDoc(json), plugins: [plugin] });
    decorationsOf(plugin, state);
    const create = vi.spyOn(DecorationSet, 'create');
    try {
      const edited = state.apply(state.tr.insertText('x', 5));
      decorationsOf(plugin, edited);
      expect(create).toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it('rebuilds oversized-paragraph line widgets even if the page count stays unchanged', () => {
    const { plugin, state } = makeState(doc(block('action', 'The rain keeps falling on the empty street. '.repeat(120))));
    decorationsOf(plugin, state);
    const create = vi.spyOn(DecorationSet, 'create');
    let edited: EditorState;
    try {
      edited = state.apply(state.tr.insertText('x', 5));
      decorationsOf(plugin, edited);
      expect(create).toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
    // Widget DOM callbacks differ in a fresh build; compare keys and positions.
    const fresh = makeState(edited!.doc.toJSON());
    const snapshot = (p: typeof plugin, s: EditorState) => (decorationsOf(p, s) as DecorationSet)
      .find().map(d => ({ from: d.from, to: d.to, spec: d.spec }));
    expect(snapshot(plugin, edited!)).toEqual(snapshot(fresh.plugin, fresh.state));
  });

  it('rebuilds them for a new page layout', () => {
    let layout = DEFAULT_PAGE_LAYOUT;
    const plugin = createPaginationPlugin(() => {}, () => layout, hints);
    const state = EditorState.create({ doc: pmDoc(longScript()), plugins: [plugin] });
    const first = decorationsOf(plugin, state);
    layout = { ...DEFAULT_PAGE_LAYOUT };
    expect(decorationsOf(plugin, state)).not.toBe(first);
  });
});

describe('pagination plugin — title-page region (#98)', () => {
  /** The top-level node indexes carrying `.sp-title-region`, in order. */
  function titleRegionIndexes(plugin: ReturnType<typeof createPaginationPlugin>, state: EditorState): number[] {
    const set = plugin.props.decorations!.call(plugin, state) as unknown as {
      find: () => { from: number; type: { attrs?: { class?: string } } }[];
    };
    const starts: number[] = [];
    state.doc.forEach((_node, offset) => starts.push(offset));
    return set
      .find()
      .filter((d) => (d.type.attrs?.class ?? '').split(/\s+/).includes(TITLE_REGION_CLASS))
      .map((d) => starts.indexOf(d.from))
      .sort((a, b) => a - b);
  }

  const withTitlePage = () => doc(
    block('titlePage'),
    block('titlePage', 'THE SCRIPT'),
    block('titlePage', 'Written by A. Writer'),
    block('sceneHeading', 'INT. ROOM - DAY'),
    block('action', 'Something happens.'),
  );

  it('marks every block above the body, spacers included, and nothing after', () => {
    const { plugin, state } = makeState(withTitlePage());
    expect(breaksOf(state).find((b) => b.isTitlePage)?.nodeIndex).toBe(3);
    expect(titleRegionIndexes(plugin, state)).toEqual([0, 1, 2]);
  });

  it('follows the region as it grows, and marks nothing in a script without one', () => {
    const { plugin, state } = makeState(withTitlePage());
    const grown = state.apply(state.tr.insert(0, testSchema.nodes.titlePage.create()));
    expect(titleRegionIndexes(plugin, grown)).toEqual([0, 1, 2, 3]);

    const plain = makeState(doc(block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'Something happens.')));
    expect(titleRegionIndexes(plain.plugin, plain.state)).toEqual([]);
  });
});
