/**
 * Genre & Pacing — the writer's description of the film, saved with the
 * script. Pacing scales the runtime estimate; genres never do.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import {
  DEFAULT_SCRIPT_PROFILE, GENRE_PRESETS, MAX_GENRE_LENGTH, MAX_GENRES,
  normalizeGenres, normalizeScriptProfile, pacingMultiplier,
} from './scriptProfile';
import { computeSceneTiming, DEFAULT_TIMING_OPTIONS, activeTimingOptions } from './scriptTiming';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { resetStoresForImport } from './importScreenplay';
import { SAVE_METADATA_KEYS } from './saveContent';
import { useEditorStore } from '../stores/editorStore';

const block = (type: string, text: string): JSONContent => ({ type, content: [{ type: 'text', text }] });
const script: JSONContent = {
  type: 'doc',
  content: Array.from({ length: 40 }, (_, i) => [
    block('sceneHeading', `INT. ROOM ${i} - DAY`),
    block('action', 'She crosses to the window and waits for the rain to stop, which it does not.'),
    block('character', 'MAYA'),
    block('dialogue', 'We should have left an hour ago, and you know it.'),
  ]).flat(),
};

describe('normalizeScriptProfile', () => {
  it('reads a stored profile, object or JSON string', () => {
    const p = { pacing: 'measured', genres: ['Drama', 'Western'] };
    expect(normalizeScriptProfile(p)).toEqual(p);
    expect(normalizeScriptProfile(JSON.stringify(p))).toEqual(p);
  });

  it('falls back to Standard with no genres for a missing or broken value', () => {
    for (const raw of [undefined, null, 42, 'not json', [], { pacing: 'glacial' }]) {
      const out = normalizeScriptProfile(raw);
      expect(out.pacing).toBe('standard');
      expect(out.genres).toEqual([]);
    }
  });

  it('keeps a valid pacing when the genres are junk, and vice versa', () => {
    expect(normalizeScriptProfile({ pacing: 'brisk', genres: 'Drama' })).toEqual({ pacing: 'brisk', genres: [] });
    expect(normalizeScriptProfile({ pacing: 7, genres: ['Drama'] })).toEqual({ pacing: 'standard', genres: ['Drama'] });
  });
});

describe('normalizeGenres', () => {
  it('drops duplicates case-insensitively and adopts the preset spelling', () => {
    expect(normalizeGenres(['sci-fi', 'Sci-Fi', 'DRAMA', '  slow   burn  ', 'Slow Burn']))
      .toEqual(['Sci-Fi', 'Drama', 'slow burn']);
  });

  it('keeps custom genres alongside presets, in the writer\'s order', () => {
    expect(normalizeGenres(['Neo-Western', 'Thriller', 'Folk Horror'])).toEqual(['Neo-Western', 'Thriller', 'Folk Horror']);
  });

  it('ignores non-strings and blanks, and caps length and count', () => {
    expect(normalizeGenres([null, 3, '', '   ', 'Drama'])).toEqual(['Drama']);
    expect(normalizeGenres(['x'.repeat(200)])[0]).toHaveLength(MAX_GENRE_LENGTH);
    expect(normalizeGenres(Array.from({ length: 50 }, (_, i) => `Genre ${i}`))).toHaveLength(MAX_GENRES);
  });

  it('offers a sensible preset list', () => {
    expect(GENRE_PRESETS).toContain('Drama');
    expect(new Set(GENRE_PRESETS.map((g) => g.toLowerCase())).size).toBe(GENRE_PRESETS.length);
  });
});

describe('pacing in the runtime estimate', () => {
  const total = (m: number) => computeSceneTiming(script, { ...DEFAULT_TIMING_OPTIONS, pacingMultiplier: m }).totalSeconds;

  it('Standard leaves the estimate untouched', () => {
    expect(pacingMultiplier('standard')).toBe(1);
    expect(total(1)).toBe(computeSceneTiming(script, DEFAULT_TIMING_OPTIONS).totalSeconds);
  });

  it('Brisk shortens it and Measured lengthens it, by their multipliers', () => {
    const std = total(1);
    expect(Math.abs(total(pacingMultiplier('brisk')) - std * 0.85)).toBeLessThanOrEqual(40);
    expect(Math.abs(total(pacingMultiplier('measured')) - std * 1.3)).toBeLessThanOrEqual(40);
  });

  it('never scales a scene timing the writer typed in', () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'sceneHeading', attrs: { timingOverride: 90 }, content: [{ type: 'text', text: 'INT. A - DAY' }] },
      block('action', 'Long.'),
    ] };
    const scene = computeSceneTiming(doc, { ...DEFAULT_TIMING_OPTIONS, pacingMultiplier: 1.3 }).scenes[0];
    expect(scene.finalSeconds).toBe(90);
  });

  it('the open script\'s pacing reaches the status bar\'s options', () => {
    useEditorStore.getState().setScriptProfile({ pacing: 'measured' });
    expect(activeTimingOptions().pacingMultiplier).toBe(1.3);
    useEditorStore.getState().setScriptProfile(DEFAULT_SCRIPT_PROFILE);
    expect(activeTimingOptions().pacingMultiplier).toBe(1);
  });

  it('genres do not move the estimate', () => {
    useEditorStore.getState().setScriptProfile({ pacing: 'standard', genres: [] });
    const before = computeSceneTiming(script).totalSeconds;
    useEditorStore.getState().setScriptProfile({ genres: ['Horror', 'Western', 'My Own Thing'] });
    expect(computeSceneTiming(script).totalSeconds).toBe(before);
  });
});

describe('saved with the script', () => {
  beforeEach(() => useEditorStore.getState().setScriptProfile(DEFAULT_SCRIPT_PROFILE));

  it('is a save-metadata key, so .odraft, backups and the library carry it', () => {
    expect(SAVE_METADATA_KEYS).toContain('_scriptProfile');
  });

  it('comes back when a saved script is imported', () => {
    hydrateEditorStoresFromContent({ _notes: [], _scriptProfile: { pacing: 'brisk', genres: ['Comedy', 'Heist'] } });
    expect(useEditorStore.getState().scriptProfile).toEqual({ pacing: 'brisk', genres: ['Comedy', 'Heist'] });
  });

  it('an imported script does not inherit the open one\'s genre and pacing', () => {
    useEditorStore.getState().setScriptProfile({ pacing: 'brisk', genres: ['Comedy'] });
    resetStoresForImport();
    expect(useEditorStore.getState().scriptProfile).toEqual(DEFAULT_SCRIPT_PROFILE);
  });

  it('a script saved before profiles existed does not inherit the last one\'s', () => {
    useEditorStore.getState().setScriptProfile({ pacing: 'measured', genres: ['Drama'] });
    hydrateEditorStoresFromContent({ _notes: [] });
    expect(useEditorStore.getState().scriptProfile).toEqual(DEFAULT_SCRIPT_PROFILE);
  });
});
