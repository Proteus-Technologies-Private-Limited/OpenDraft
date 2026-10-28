import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { getAttributesFromExtensions, getSplittedAttributes } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { testSchema, testExtensions, block, doc } from '../test/screenplaySchema';
import { PLOTLINE_COLORS, newPlotline, normalizePlotlines, plotlineIdsOf, type Plotline } from './plotlines';
import {
  plotlineSummary,
  removePlotlineFromScenesTransaction,
  timelineScenes,
  toggleScenePlotlineTransaction,
} from './storyTimeline';
import { DEFAULT_TIMING_OPTIONS } from './scriptTiming';
import { useEditorStore } from '../stores/editorStore';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { SAVE_METADATA_KEYS } from './saveContent';

const heading = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ ...block('sceneHeading', text), attrs });

function script() {
  return EditorState.create({
    schema: testSchema,
    doc: testSchema.nodeFromJSON(doc(
      block('action', 'FADE IN:'),
      heading('INT. KITCHEN - NIGHT', { sceneNumber: '1' }),
      block('action', 'Maya waits. And waits. And waits some more, longer than anyone should.'),
      { type: 'sceneHeading', content: [] }, // an empty heading is no scene
      heading('EXT. ROOF - DAY', { sceneNumber: '2' }),
      block('character', 'MAYA'),
      block('dialogue', 'Now.'),
    )),
  });
}

describe('plotlines', () => {
  it('names new plotlines A, B, C Story, then by number, each in an unused colour', () => {
    const made: Plotline[] = [];
    for (let i = 0; i < 4; i++) made.push(newPlotline(made));
    expect(made.map((p) => p.name)).toEqual(['A Story', 'B Story', 'C Story', 'Plotline 4']);
    expect(new Set(made.map((p) => p.color)).size).toBe(4);
    expect(made[0].color).toBe(PLOTLINE_COLORS[0]);
  });

  it('skips a default name already in use', () => {
    expect(newPlotline([{ id: 'x', name: 'a story', color: '#000' }]).name).toBe('B Story');
  });

  it('reads plotlines from a file, dropping anything malformed or repeated', () => {
    expect(normalizePlotlines([
      { id: 'a', name: 'A Story', color: '#f00' },
      { id: 'a', name: 'dupe', color: '#0f0' },
      { id: '', name: 'no id' },
      null,
      { id: 'b', name: 3 },
    ])).toEqual([
      { id: 'a', name: 'A Story', color: '#f00' },
      { id: 'b', name: '', color: PLOTLINE_COLORS[1] },
    ]);
    expect(normalizePlotlines('nope')).toEqual([]);
  });

  it('reads the plotlines on a scene heading', () => {
    expect(plotlineIdsOf({ plotlines: ['a', 7, 'b'] })).toEqual(['a', 'b']);
    expect(plotlineIdsOf({ plotlines: null })).toEqual([]);
  });
});

describe('the timeline', () => {
  it('lists the scenes the timing engine counts, with numbers and screen time in order', () => {
    const scenes = timelineScenes(script().doc, DEFAULT_TIMING_OPTIONS);
    expect(scenes.map((s) => [s.number, s.heading])).toEqual([['1', 'INT. KITCHEN - NIGHT'], ['2', 'EXT. ROOF - DAY']]);
    expect(scenes[0].seconds).toBeGreaterThan(0);
    expect(scenes[1].startSeconds).toBe(scenes[0].seconds);
  });

  it('puts a scene in a plotline and takes it out again', () => {
    let s = script();
    const [first] = timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS);
    s = s.apply(toggleScenePlotlineTransaction(s, first.pos, 'a')!);
    s = s.apply(toggleScenePlotlineTransaction(s, first.pos, 'b')!);
    expect(timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS)[0].plotlineIds).toEqual(['a', 'b']);
    s = s.apply(toggleScenePlotlineTransaction(s, first.pos, 'a')!);
    expect(timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS)[0].plotlineIds).toEqual(['b']);
    s = s.apply(toggleScenePlotlineTransaction(s, first.pos, 'b')!);
    expect(s.doc.nodeAt(first.pos)?.attrs.plotlines).toBeNull();
  });

  it('only changes scene headings', () => {
    const s = script();
    expect(toggleScenePlotlineTransaction(s, 0, 'a')).toBeNull();
  });

  it('sums what a plotline carries', () => {
    let s = script();
    const scenes = timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS);
    s = s.apply(toggleScenePlotlineTransaction(s, scenes[1].pos, 'a')!);
    const sum = plotlineSummary(timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS), 'a');
    expect(sum).toEqual({ scenes: 1, seconds: scenes[1].seconds });
  });

  it('takes a deleted plotline off every scene', () => {
    let s = script();
    for (const sc of timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS)) {
      s = s.apply(toggleScenePlotlineTransaction(s, sc.pos, 'a')!);
    }
    s = s.apply(toggleScenePlotlineTransaction(s, timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS)[0].pos, 'b')!);
    s = s.apply(removePlotlineFromScenesTransaction(s, 'a')!);
    expect(timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS).map((x) => x.plotlineIds)).toEqual([['b'], []]);
    expect(removePlotlineFromScenesTransaction(s, 'a')).toBeNull();
  });

  it('keeps a scene in its plotlines through a save and load', () => {
    let s = script();
    const pos = timelineScenes(s.doc, DEFAULT_TIMING_OPTIONS)[0].pos;
    s = s.apply(toggleScenePlotlineTransaction(s, pos, 'a')!);
    const reloaded = testSchema.nodeFromJSON(JSON.parse(JSON.stringify(s.doc.toJSON())));
    expect(timelineScenes(reloaded, DEFAULT_TIMING_OPTIONS)[0].plotlineIds).toEqual(['a']);
  });

  it('starts a scene split off with Enter in no plotline', () => {
    const carried = getSplittedAttributes(
      getAttributesFromExtensions(testExtensions), 'sceneHeading', { plotlines: ['a'], sceneNumber: '1' },
    );
    expect(carried).not.toHaveProperty('plotlines');
  });
});

describe('plotlines in the store', () => {
  beforeEach(() => {
    useEditorStore.setState({ plotlines: [], beats: [] });
  });

  it('adds, renames and recolours', () => {
    const s = useEditorStore.getState();
    const id = s.addPlotline();
    s.updatePlotline(id, { name: 'Maya’s arc', color: '#123456' });
    expect(useEditorStore.getState().plotlines).toEqual([{ id, name: 'Maya’s arc', color: '#123456' }]);
  });

  it('takes a deleted plotline off its beats', () => {
    const s = useEditorStore.getState();
    const a = s.addPlotline();
    const b = s.addPlotline();
    useEditorStore.setState({
      beats: [
        { id: 'x', plotlineIds: [a, b] },
        { id: 'y', plotlineIds: [a] },
        { id: 'z' },
      ] as unknown as ReturnType<typeof useEditorStore.getState>['beats'],
    });
    s.deletePlotline(a);
    const st = useEditorStore.getState();
    expect(st.plotlines.map((p) => p.id)).toEqual([b]);
    expect(st.beats.map((x) => x.plotlineIds)).toEqual([[b], [], undefined]);
  });

  it('is saved with the script and restored from it', () => {
    expect(SAVE_METADATA_KEYS).toContain('_plotlines');
    const saved = [{ id: 'a', name: 'A Story', color: '#f00' }];
    hydrateEditorStoresFromContent({ _plotlines: JSON.stringify(saved) });
    expect(useEditorStore.getState().plotlines).toEqual(saved);
  });
});
