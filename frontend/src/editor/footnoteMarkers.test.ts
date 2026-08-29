import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { createFootnoteMarkerPlugin } from './footnoteMarkers';
import { buildFootnotePlan } from '../utils/footnotes';
import {
  DEFAULT_PAGE_LAYOUT,
  type NoteInfo,
  type PageLayout,
  type FootnoteSettings,
} from '../stores/editorStore';
import { block, doc, marked, pmDoc, testSchema } from '../test/screenplaySchema';
import type { JSONContent } from '@tiptap/react';
import type { DecorationSet } from '@tiptap/pm/view';

const CTX = { assets: [], assetUrl: () => null };

const note = (id: string, over: Partial<NoteInfo> = {}): NoteInfo => ({
  id, content: 'Armstrong, N. (1969).', anchorText: '', elementType: 'action',
  contextLabel: '', color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z',
  sceneId: null, printInScript: true, ...over,
});

const layout = (over: Partial<FootnoteSettings> = {}): PageLayout => ({
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, ...over },
});

const noted = (text: string, noteId: string): JSONContent =>
  marked('action', text, { type: 'scriptNote', attrs: { noteId, color: '#f4d35e' } });

function decorationsFor(json: JSONContent, notes: NoteInfo[], l: PageLayout = layout()) {
  const plan = buildFootnotePlan(json, l, notes, CTX);
  const plugin = createFootnoteMarkerPlugin(() => plan);
  const state = EditorState.create({ schema: testSchema, doc: pmDoc(json), plugins: [plugin] });
  // The plugin keeps no state of its own; ask it directly what it would draw.
  const decos = plugin.props.decorations!.call(plugin, state) as DecorationSet;
  return { state, decos };
}

describe('footnote markers', () => {
  it('draws one marker per printing note, in document order', () => {
    const json = doc(noted('First.', 'n1'), noted('Second.', 'n2'));
    const { state, decos } = decorationsFor(json, [note('n1'), note('n2')]);
    const found = decos.find(0, state.doc.content.size);
    expect(found).toHaveLength(2);
  });

  it('draws nothing when no note prints', () => {
    const json = doc(noted('First.', 'n1'));
    const { state, decos } = decorationsFor(json, [note('n1', { printInScript: false })]);
    expect(decos.find(0, state.doc.content.size)).toHaveLength(0);
  });

  it('draws nothing when the document switch is off', () => {
    const json = doc(noted('First.', 'n1'));
    const { state, decos } = decorationsFor(json, [note('n1')], DEFAULT_PAGE_LAYOUT);
    expect(decos.find(0, state.doc.content.size)).toHaveLength(0);
  });

  it('places the marker at the end of the annotated phrase', () => {
    const json = doc({
      type: 'action',
      content: [
        { type: 'text', text: 'one small ' },
        { type: 'text', text: 'step', marks: [{ type: 'scriptNote', attrs: { noteId: 'n1' } }] },
        { type: 'text', text: ' for a man' },
      ],
    });
    const { state, decos } = decorationsFor(json, [note('n1')]);
    const [d] = decos.find(0, state.doc.content.size);
    // Block starts at 0, its text starts at 1, and the phrase ends at 14.
    expect(d.from).toBe(1 + 'one small step'.length);
  });

  it('leaves the document text untouched', () => {
    // The export-safety contract: nothing a serializer reads can see a marker.
    const json = doc(noted('One small step.', 'n1'), block('action', 'After.'));
    const { state } = decorationsFor(json, [note('n1')]);
    const plainState = EditorState.create({ schema: testSchema, doc: pmDoc(json) });
    expect(state.doc.textContent).toBe(plainState.doc.textContent);
    expect(state.doc.toJSON()).toEqual(plainState.doc.toJSON());
  });
});
