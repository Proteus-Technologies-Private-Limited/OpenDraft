/**
 * AV column model — cue metadata, the storyboard column, and column widths.
 *
 * Shaped after Celtx's Multi-Column AV editor rather than the fully
 * user-configurable columns originally proposed: a fixed set of typed columns
 * (Cue/Timing · Video · Audio · Image) is what the category converged on, and
 * it is what lets the exporters emit real columns instead of guessing at
 * arbitrary ones.
 *
 * The load-bearing case here is backward compatibility. Every AV document
 * written before this existed is a row of exactly two cells with no attributes,
 * and those must keep parsing and editing untouched.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { testSchema } from '../test/screenplaySchema';
import {
  AvBlock,
  readColumnConfig,
  gridTemplateFor,
  clampColumnWidth,
  aspectRatioCss,
  AV_DEFAULT_COLUMNS,
  AV_CUE_MIN_PX,
  avColumnDataCount,
  avBlockAtSelection,
  isInAvCell,
  isInAvRow,
  AV_BLANK_FRAME,
} from './extensions/AvBlock';

/** A legacy two-cell row: no attrs, no image — exactly what is on disk today. */
const legacyRow = (video = 'V', audio = 'A') => ({
  type: 'avRow',
  content: [
    { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: [{ type: 'text', text: video }] }] },
    { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: [{ type: 'text', text: audio }] }] },
  ],
});

const docWith = (rows: unknown[], blockAttrs: Record<string, unknown> | null = null) =>
  testSchema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'avBlock', ...(blockAttrs ? { attrs: blockAttrs } : {}), content: rows }],
  });

const avCommands = (AvBlock.config.addCommands as () => Record<string, (...a: never[]) => (p: unknown) => boolean>).call(
  { name: 'avBlock', options: {}, storage: {}, editor: null, type: testSchema.nodes.avBlock } as never,
);

function stateInFirstCell(doc: PmNode): EditorState {
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'avPara') pos = p + 1;
    return pos < 0;
  });
  const state = EditorState.create({ doc, schema: testSchema });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}

function run(state: EditorState, name: string, ...args: unknown[]): EditorState | null {
  let next: Transaction | null = null;
  const ok = avCommands[name](...(args as never[]))({
    tr: state.tr, state, dispatch: (tr: Transaction) => { next = tr; },
  } as never);
  if (!ok || !next) return null;
  return state.apply(next!);
}

function firstRow(state: EditorState): PmNode {
  let row: PmNode | null = null;
  state.doc.descendants(n => { if (!row && n.type.name === 'avRow') row = n; return !row; });
  return row!;
}

function firstBlock(state: EditorState): PmNode {
  let block: PmNode | null = null;
  state.doc.descendants(n => { if (!block && n.type.name === 'avBlock') block = n; return !block; });
  return block!;
}

describe('backward compatibility with two-cell AV documents', () => {
  it('parses a legacy row that has no cue attributes and no image cell', () => {
    const doc = docWith([legacyRow()]);
    const row = firstRow(EditorState.create({ doc, schema: testSchema }));
    expect(row.childCount).toBe(2);
    expect(row.attrs.shot).toBeNull();
    expect(row.attrs.start).toBeNull();
    expect(row.attrs.duration).toBeNull();
  });

  it('gives a legacy block the default column config rather than nothing', () => {
    const doc = docWith([legacyRow()]);
    const block = firstBlock(EditorState.create({ doc, schema: testSchema }));
    expect(block.attrs.columns).toBeNull();
    // Readers never see the raw null — they go through readColumnConfig.
    expect(readColumnConfig(block.attrs)).toEqual(AV_DEFAULT_COLUMNS);
  });

  it('still round-trips a legacy row through JSON unchanged in shape', () => {
    const doc = docWith([legacyRow('WIDE', 'V.O.')]);
    const json = doc.toJSON() as { content: [{ content: [{ content: unknown[] }] }] };
    expect(json.content[0].content[0].content).toHaveLength(2);
  });
});

describe('readColumnConfig', () => {
  it('falls back to the Celtx-style default: cue on, storyboard off', () => {
    expect(readColumnConfig(null).cue).toBe(true);
    expect(readColumnConfig(null).image).toBe(false);
  });

  it('repairs a partial or malformed stored config instead of trusting it', () => {
    const cfg = readColumnConfig({ columns: { cue: false, widths: { video: 0, audio: 'x' } } });
    expect(cfg.cue).toBe(false);
    expect(cfg.image).toBe(false);
    // A zero or non-numeric width would make a column unclickable.
    expect(cfg.widths.video).toBe(1);
    expect(cfg.widths.audio).toBe(1);
  });

  it('survives junk', () => {
    expect(() => readColumnConfig(undefined)).not.toThrow();
    expect(() => readColumnConfig({ columns: 'nope' } as never)).not.toThrow();
  });
});

describe('clampColumnWidth', () => {
  it('keeps a column wide enough to click into', () => {
    expect(clampColumnWidth(0)).toBe(1);
    expect(clampColumnWidth(-3)).toBe(1);
    expect(clampColumnWidth('x')).toBe(1);
    expect(clampColumnWidth(0.05)).toBe(0.2);
    expect(clampColumnWidth(999)).toBe(10);
    expect(clampColumnWidth(2.5)).toBe(2.5);
  });
});

describe('gridTemplateFor', () => {
  it('emits only the columns that are switched on', () => {
    expect(gridTemplateFor({ cue: false, image: false, widths: { cue: 1, video: 2, audio: 2, image: 1 } }))
      .toBe('2fr 2fr');
    expect(gridTemplateFor({ cue: true, image: true, widths: { cue: 0.5, video: 2, audio: 2, image: 1.5 } }))
      .toBe(`minmax(${AV_CUE_MIN_PX}px, 0.5fr) 2fr 2fr 1.5fr`);
  });

  it('gives the cue column a floor so the duration field is never clipped', () => {
    // A plain `fr` track shrank to 45px once the storyboard column was added,
    // which rendered "1:30" as "1:3".
    const withImage = gridTemplateFor({ cue: true, image: true, widths: { cue: 0.5, video: 2, audio: 2, image: 1.5 } });
    expect(withImage).toContain(`minmax(${AV_CUE_MIN_PX}px`);
  });
});

describe('aspectRatioCss', () => {
  it('converts a storyboard ratio to a CSS aspect-ratio', () => {
    expect(aspectRatioCss('16:9')).toBe('16 / 9');
    expect(aspectRatioCss('2.39:1')).toBe('2.39 / 1');
  });
  it('returns null for free-form or invalid ratios', () => {
    expect(aspectRatioCss('free')).toBeNull();
    expect(aspectRatioCss(null)).toBeNull();
    expect(aspectRatioCss('0:0')).toBeNull();
    expect(aspectRatioCss('nonsense')).toBeNull();
  });
});

describe('setAvRowCue', () => {
  it('stores a duration on the caret’s row', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvRowCue', { duration: '0:05' });
    expect(firstRow(next!).attrs.duration).toBe('0:05');
  });

  it('clears a field back to null so the derived value takes over again', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowCue', { shot: '22c' })!;
    expect(firstRow(s).attrs.shot).toBe('22c');
    s = run(s, 'setAvRowCue', { shot: '' })!;
    expect(firstRow(s).attrs.shot).toBeNull();
  });

  it('leaves fields it was not given alone', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowCue', { duration: '0:05' })!;
    s = run(s, 'setAvRowCue', { shot: '3.' })!;
    expect(firstRow(s).attrs.duration).toBe('0:05');
    expect(firstRow(s).attrs.shot).toBe('3.');
  });

  it('declines outside an AV body', () => {
    const doc = testSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'x' }] }] });
    const state = EditorState.create({ doc, schema: testSchema });
    expect(run(state, 'setAvRowCue', { duration: '0:05' })).toBeNull();
  });
});

describe('toggleAvColumn / setAvColumnWidth', () => {
  it('turns the storyboard column on for the whole body', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'toggleAvColumn', 'image');
    expect(readColumnConfig(firstBlock(next!).attrs).image).toBe(true);
  });

  it('turns the cue column off', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'toggleAvColumn', 'cue', false);
    expect(readColumnConfig(firstBlock(next!).attrs).cue).toBe(false);
  });

  it('sets a column width, clamped', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvColumnWidth', 'video', 3)!;
    expect(readColumnConfig(firstBlock(s).attrs).widths.video).toBe(3);
    s = run(s, 'setAvColumnWidth', 'video', 0)!;
    expect(readColumnConfig(firstBlock(s).attrs).widths.video).toBe(1);
  });
});

describe('storyboard frames', () => {
  it('adds an image cell to a legacy two-cell row', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvRowImage', { src: 'a.png', aspect: '4:3' });
    const row = firstRow(next!);
    expect(row.childCount).toBe(3);
    expect(row.child(2).type.name).toBe('avImage');
    expect(row.child(2).attrs.src).toBe('a.png');
    expect(row.child(2).attrs.aspect).toBe('4:3');
  });

  it('switches the storyboard column on so the frame is actually visible', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvRowImage', { src: 'a.png' });
    expect(readColumnConfig(firstBlock(next!).attrs).image).toBe(true);
  });

  it('replaces an existing frame rather than stacking a second one', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { src: 'a.png' })!;
    s = run(s, 'setAvRowImage', { src: 'b.png' })!;
    const row = firstRow(s);
    expect(row.childCount).toBe(3);
    expect(row.child(2).attrs.src).toBe('b.png');
  });

  it('supports a deliberately blank frame — a slot for art not yet drawn', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvRowImage', { src: null });
    const row = firstRow(next!);
    expect(row.child(2).type.name).toBe('avImage');
    expect(row.child(2).attrs.src).toBeNull();
  });

  it('removes a frame and returns the row to two cells', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { src: 'a.png' })!;
    s = run(s, 'clearAvRowImage')!;
    expect(firstRow(s).childCount).toBe(2);
  });

  it('declines to clear when there is no frame', () => {
    expect(run(stateInFirstCell(docWith([legacyRow()])), 'clearAvRowImage')).toBeNull();
  });

  /**
   * A frame update is partial.
   *
   * The reported bug was "choose an aspect ratio, get a frame, and then it will
   * not take an image" — two separate faults, both of them this one: the menu
   * passed only the field it was changing, and the command replaced the whole
   * attribute set with it.
   */
  it('keeps the picture when only the aspect ratio changes', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { src: 'a.png', assetId: 'asset-1', projectId: 'proj-1', alt: 'a' })!;
    s = run(s, 'setAvRowImage', { aspect: '9:16' })!;
    const frame = firstRow(s).child(2);
    expect(frame.attrs.aspect).toBe('9:16');
    expect(frame.attrs.src).toBe('a.png');
    expect(frame.attrs.assetId).toBe('asset-1');
    expect(frame.attrs.projectId).toBe('proj-1');
    expect(frame.attrs.alt).toBe('a');
  });

  it('keeps the aspect ratio when only the picture changes', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    // Exactly the reported order: pick a ratio on an empty row, then a picture.
    s = run(s, 'setAvRowImage', { aspect: '2.39:1' })!;
    expect(firstRow(s).child(2).attrs.src).toBeNull();
    s = run(s, 'setAvRowImage', { src: 'a.png', alt: 'a' })!;
    const frame = firstRow(s).child(2);
    expect(frame.attrs.src).toBe('a.png');
    expect(frame.attrs.aspect).toBe('2.39:1');
  });

  it('blanks the picture but keeps the frame and its ratio', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { src: 'a.png', assetId: 'asset-1', aspect: '1:1' })!;
    s = run(s, 'setAvRowImage', AV_BLANK_FRAME)!;
    const frame = firstRow(s).child(2);
    expect(frame.attrs.src).toBeNull();
    expect(frame.attrs.assetId).toBeNull();
    expect(frame.attrs.aspect).toBe('1:1');
  });
});

/**
 * Clicking a frame must not switch the AV menu off.
 *
 * A frame is an atom, so a click on one leaves a NodeSelection on the frame
 * rather than a caret in a cell — and the writer who has just been given an
 * empty frame clicks the frame. Gating the menu on `isInAvCell` meant every AV
 * control, the one that fills the frame included, greyed out at that exact
 * moment.
 */
describe('a selected storyboard frame', () => {
  const withFrameSelected = (): EditorState => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { aspect: '4:3' })!;
    let framePos = -1;
    s.doc.descendants((n, p) => { if (framePos < 0 && n.type.name === 'avImage') framePos = p; return framePos < 0; });
    return s.apply(s.tr.setSelection(NodeSelection.create(s.doc, framePos)));
  };

  it('is not in a cell — which is why the cell test was the wrong gate', () => {
    expect(isInAvCell(withFrameSelected())).toBe(false);
  });

  it('is still in an AV row, so the AV controls stay live', () => {
    expect(isInAvRow(withFrameSelected())).toBe(true);
  });

  it('takes a picture while it is the selection', () => {
    const s = run(withFrameSelected(), 'setAvRowImage', { src: 'a.png' });
    expect(s).not.toBeNull();
    const frame = firstRow(s!).child(2);
    expect(frame.attrs.src).toBe('a.png');
    expect(frame.attrs.aspect).toBe('4:3');
  });

  it('takes a new aspect ratio while it is the selection', () => {
    const s = run(withFrameSelected(), 'setAvRowImage', { aspect: '1:1' });
    expect(firstRow(s!).child(2).attrs.aspect).toBe('1:1');
  });

  it('can still be removed, and the row goes back to two cells', () => {
    const s = run(withFrameSelected(), 'clearAvRowImage');
    expect(firstRow(s!).childCount).toBe(2);
  });
});

/**
 * What a column toggle would take out of sight.
 *
 * Switching a column off keeps the data — it is the flag that decides whether
 * the gutter draws and whether `readAvBlock` writes the column out — so the
 * menu asks first, and it can only ask when it knows there is something there.
 */
describe('avColumnDataCount', () => {
  it('counts nothing on a legacy body with no times and no frames', () => {
    const block = firstBlock(stateInFirstCell(docWith([legacyRow(), legacyRow()])));
    expect(avColumnDataCount(block, 'cue')).toBe(0);
    expect(avColumnDataCount(block, 'image')).toBe(0);
  });

  it('counts a row the writer typed a duration into', () => {
    let s = stateInFirstCell(docWith([legacyRow(), legacyRow()]));
    s = run(s, 'setAvRowCue', { duration: '0:05' })!;
    expect(avColumnDataCount(firstBlock(s), 'cue')).toBe(1);
  });

  it('counts a manual shot number or start override, not a derived one', () => {
    // Nothing is stored for a shot number the editor would have derived, so a
    // body that merely *displays* 1. 2. 3. has nothing to warn about.
    let s = stateInFirstCell(docWith([legacyRow()]));
    expect(avColumnDataCount(firstBlock(s), 'cue')).toBe(0);
    s = run(s, 'setAvRowCue', { shot: '10.' })!;
    expect(avColumnDataCount(firstBlock(s), 'cue')).toBe(1);
  });

  it('ignores a duration cleared back to empty', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowCue', { duration: '0:05' })!;
    s = run(s, 'setAvRowCue', { duration: '' })!;
    expect(avColumnDataCount(firstBlock(s), 'cue')).toBe(0);
  });

  it('counts a frame with a picture in it', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { src: 'a.png' })!;
    expect(avColumnDataCount(firstBlock(s), 'image')).toBe(1);
  });

  it('does not count a blank frame — an empty slot is not work to lose', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'setAvRowImage', { src: null })!;
    expect(avColumnDataCount(firstBlock(s), 'image')).toBe(0);
  });
});

describe('avBlockAtSelection', () => {
  it('finds the body the cursor is in', () => {
    const block = avBlockAtSelection(stateInFirstCell(docWith([legacyRow()])));
    expect(block?.type.name).toBe('avBlock');
  });

  it('returns null outside an AV body', () => {
    const doc = testSchema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'action', content: [{ type: 'text', text: 'A plain line.' }] }],
    });
    const state = EditorState.create({ doc, schema: testSchema });
    expect(avBlockAtSelection(state)).toBeNull();
  });
});

/**
 * The command behind the drag handle.
 *
 * Two columns move together, so they have to be written in one transaction:
 * one undo step for one gesture, and no intermediate state where a body is
 * wider than its page.
 */
describe('setAvColumnWidths', () => {
  it('writes both sides of a divider at once', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvColumnWidths', { video: 3, audio: 1 });
    const w = readColumnConfig(firstBlock(next!).attrs).widths;
    expect(w.video).toBe(3);
    expect(w.audio).toBe(1);
  });

  it('leaves the columns it was not given alone', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvColumnWidths', { video: 3 });
    const w = readColumnConfig(firstBlock(next!).attrs).widths;
    expect(w.cue).toBe(AV_DEFAULT_COLUMNS.widths.cue);
    expect(w.audio).toBe(AV_DEFAULT_COLUMNS.widths.audio);
  });

  it('keeps the column visibility flags', () => {
    let s = stateInFirstCell(docWith([legacyRow()]));
    s = run(s, 'toggleAvColumn', 'image')!;
    s = run(s, 'setAvColumnWidths', { video: 3 })!;
    expect(readColumnConfig(firstBlock(s).attrs).image).toBe(true);
  });

  it('clamps what it is handed', () => {
    const next = run(stateInFirstCell(docWith([legacyRow()])), 'setAvColumnWidths', { video: 999, audio: -4 });
    const w = readColumnConfig(firstBlock(next!).attrs).widths;
    expect(w.video).toBe(10);
    expect(w.audio).toBe(1);
  });

  it('declines a change that changes nothing, so a click is not an undo step', () => {
    const s = stateInFirstCell(docWith([legacyRow()]));
    expect(run(s, 'setAvColumnWidths', { video: AV_DEFAULT_COLUMNS.widths.video })).toBeNull();
    expect(run(s, 'setAvColumnWidths', {})).toBeNull();
  });

  it('takes an explicit block position, for a drag whose body is not the cursor’s', () => {
    // The pointer is on a divider in one body while the caret sits in another.
    const doc = docWith([legacyRow()]);
    const state = stateInFirstCell(doc);
    let blockPos = -1;
    state.doc.descendants((n, p) => { if (blockPos < 0 && n.type.name === 'avBlock') blockPos = p; return blockPos < 0; });
    const next = run(state, 'setAvColumnWidths', { video: 3 }, blockPos);
    expect(readColumnConfig(firstBlock(next!).attrs).widths.video).toBe(3);
  });

  it('refuses a position that is not an AV body', () => {
    const state = stateInFirstCell(docWith([legacyRow()]));
    expect(run(state, 'setAvColumnWidths', { video: 3 }, 99999)).toBeNull();
    expect(run(state, 'setAvColumnWidths', { video: 3 }, -1)).toBeNull();
  });

  it('is why the singular command cannot just be chained', () => {
    // Tiptap hands every command in a chain the SAME starting state, so a
    // second setAvColumnWidth reads the block's pre-chain attrs and its
    // setNodeMarkup drops what the first wrote. Demonstrated rather than
    // asserted in prose, because it is the entire reason this command exists.
    let s = stateInFirstCell(docWith([legacyRow()]));
    const start = s;
    s = run(s, 'setAvColumnWidth', 'video', 3)!;
    // Re-running the second command against the ORIGINAL state, as a chain does:
    const chained = run(start, 'setAvColumnWidth', 'audio', 1)!;
    expect(readColumnConfig(firstBlock(chained).attrs).widths.video)
      .toBe(AV_DEFAULT_COLUMNS.widths.video);
    expect(readColumnConfig(firstBlock(s).attrs).widths.audio)
      .toBe(AV_DEFAULT_COLUMNS.widths.audio);
  });
});
