import { describe, it, expect, beforeEach } from 'vitest';
import { readRevisionState, restoreRevisionState } from './revisionState';
import { SAVE_METADATA_KEYS, stripSaveMetadata } from './saveContent';
import { useEditorStore } from '../stores/editorStore';
import { nextRevisionColor, REVISION_COLORS, DEFAULT_REVISION_SETTINGS } from '../editor/revisionColors';

describe('revision state in a saved script', () => {
  beforeEach(() => useEditorStore.getState().resetRevisionState());

  it('is part of the save metadata, kept out of the document', () => {
    for (const k of ['_revisionMode', '_revisionColor', '_revisionHistory']) {
      expect(SAVE_METADATA_KEYS).toContain(k);
    }
    const { pmDoc, metadata } = stripSaveMetadata({ type: 'doc', content: [], _revisionMode: true, _revisionColor: 'Pink' });
    expect(pmDoc).toEqual({ type: 'doc', content: [] });
    expect(metadata).toEqual({ _revisionMode: true, _revisionColor: 'Pink' });
  });

  it('reads what was saved', () => {
    expect(readRevisionState({
      _revisionMode: true,
      _revisionColor: 'pink',
      _revisionHistory: [{ color: 'Blue', date: '2026-09-01' }, { color: 'Pink', date: '2026-10-01' }],
    })).toEqual({
      revisionMode: true,
      revisionColor: 'Pink',
      revisionHistory: [{ color: 'Blue', date: '2026-09-01' }, { color: 'Pink', date: '2026-10-01' }],
      revisionSettings: DEFAULT_REVISION_SETTINGS,
    });
  });

  it('reads the marks and coloured-page setting, dropping what cannot be a mark', () => {
    const s = readRevisionState({
      _revisionSettings: { markChar: '+', marks: { blue: '#', pink: '', Green: 7 }, colorPages: true },
    });
    expect(s.revisionSettings).toEqual({ markChar: '+', marks: { Blue: '#' }, colorPages: true });
    expect(readRevisionState({ _revisionSettings: 'not json' }).revisionSettings).toEqual(DEFAULT_REVISION_SETTINGS);
  });

  it('accepts history stored as a JSON string, and drops junk entries', () => {
    const s = readRevisionState({ _revisionHistory: JSON.stringify([{ color: 'Blue' }, 7, null, { nope: 1 }]) });
    expect(s.revisionHistory).toEqual([{ color: 'Blue', date: '' }]);
  });

  it('falls back to defaults for a script that predates Revision Mode', () => {
    const defaults = { revisionMode: false, revisionColor: 'White', revisionHistory: [], revisionSettings: DEFAULT_REVISION_SETTINGS };
    expect(readRevisionState({ type: 'doc' })).toEqual(defaults);
    expect(readRevisionState(null)).toEqual(defaults);
  });

  it('does not carry Revision Mode from the previous script into one without it', () => {
    useEditorStore.getState().advanceRevisionColor();
    expect(useEditorStore.getState().revisionMode).toBe(true);
    restoreRevisionState({ type: 'doc' });
    const st = useEditorStore.getState();
    expect([st.revisionMode, st.revisionColor, st.revisionHistory]).toEqual([false, 'White', []]);
  });
});

describe('revision colour actions', () => {
  beforeEach(() => useEditorStore.getState().resetRevisionState());

  it('records each colour the first time it is revised in', () => {
    const st = useEditorStore.getState();
    st.setRevisionColor('Blue'); // mode off: not a revision yet
    expect(useEditorStore.getState().revisionHistory).toEqual([]);
    st.setRevisionMode(true);
    st.setRevisionColor('Pink');
    st.setRevisionColor('Blue');
    expect(useEditorStore.getState().revisionHistory.map((h) => h.color)).toEqual(['Blue', 'Pink']);
  });

  it('Next Revision Color moves along the sequence and turns the mode on', () => {
    const st = useEditorStore.getState();
    st.advanceRevisionColor();
    expect(useEditorStore.getState()).toMatchObject({ revisionMode: true, revisionColor: 'Blue' });
    st.advanceRevisionColor();
    expect(useEditorStore.getState().revisionColor).toBe('Pink');
  });

  it('stops at the end of the sequence', () => {
    const last = REVISION_COLORS[REVISION_COLORS.length - 1].name;
    expect(nextRevisionColor(last)).toBe(last);
    expect(nextRevisionColor('Nonsense')).toBe('White');
  });
});
