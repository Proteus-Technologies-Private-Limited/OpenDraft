/**
 * Format → Genre & Pacing…  (also opened by clicking "Est." in the status bar)
 *
 * The writer's own description of the film, saved with the script as
 * `_scriptProfile`:
 *
 * - Pacing comes first: it is what changes the runtime, and on a phone the
 *   genre chips would otherwise push it below the fold.
 * - Pacing scales the runtime estimate. Each choice shows the runtime it would
 *   give this script, so the setting is never a hidden fudge factor.
 * - Genres are descriptive only: pick any of the suggestions, add your own.
 *   They do not move the estimate — see utils/scriptProfile for why.
 */
import React, { useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import {
  GENRE_PRESETS, MAX_GENRES, PACING_OPTIONS, cleanGenre, normalizeGenres, type Pacing,
} from '../utils/scriptProfile';
import { activeTimingOptions, computeSceneTiming, formatRuntime, formatSceneDuration } from '../utils/scriptTiming';

interface Props {
  onClose: () => void;
  /** The current document, for the per-pacing runtime preview. */
  getDoc: () => JSONContent | null | undefined;
}

const ScriptProfileDialog: React.FC<Props> = ({ onClose, getDoc }) => {
  const current = useEditorStore((s) => s.scriptProfile);
  const [pacing, setPacing] = useState<Pacing>(current.pacing);
  const [genres, setGenres] = useState<string[]>(current.genres);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  // What each pacing would make of this script, measured once on open.
  const previews = useMemo(() => {
    const out: Partial<Record<Pacing, string>> = {};
    try {
      const doc = getDoc();
      if (!doc) return out;
      const base = activeTimingOptions();
      for (const o of PACING_OPTIONS) {
        const secs = computeSceneTiming(doc, { ...base, pacingMultiplier: o.multiplier }).totalSeconds;
        // Whole minutes hide the difference on a short script ("3m" either
        // way), so anything under ten minutes is shown to the second.
        if (secs > 0) out[o.id] = secs < 600 ? formatSceneDuration(secs) : formatRuntime(secs);
      }
    } catch (err) {
      console.warn('[scriptProfile] runtime preview failed', err);
    }
    return out;
  }, [getDoc]);

  const selected = useMemo(() => new Set(genres.map((g) => g.toLowerCase())), [genres]);
  const customGenres = genres.filter((g) => !GENRE_PRESETS.some((p) => p.toLowerCase() === g.toLowerCase()));

  const toggle = (genre: string) => {
    setError(null);
    setGenres((list) => (
      selected.has(genre.toLowerCase())
        ? list.filter((g) => g.toLowerCase() !== genre.toLowerCase())
        : normalizeGenres([...list, genre])
    ));
  };

  /** Add what is typed — several at once when separated by commas. */
  const addCustom = () => {
    const parts = custom.split(',').map(cleanGenre).filter(Boolean);
    if (parts.length === 0) return;
    const next = normalizeGenres([...genres, ...parts]);
    if (next.length >= MAX_GENRES && genres.length + parts.length > MAX_GENRES) {
      setError(`Up to ${MAX_GENRES} genres.`);
    } else {
      setError(null);
    }
    setGenres(next);
    setCustom('');
  };

  const save = () => {
    try {
      // A half-typed genre the writer did not press Add for is still meant.
      const pending = custom.split(',').map(cleanGenre).filter(Boolean);
      useEditorStore.getState().setScriptProfile({ pacing, genres: normalizeGenres([...genres, ...pending]) });
      onClose();
    } catch (err) {
      console.error('[scriptProfile] could not save', err);
      setError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box script-profile-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-profile-title"
      >
        <div className="dialog-header" id="script-profile-title">Genre &amp; Pacing</div>
        <div className="dialog-body">
          <div className="script-profile-subhead">Pacing</div>
          <p className="script-profile-help">
            How the film will play against the page. It scales the runtime estimate; scene timings you set by hand are kept.
          </p>
          <div className="script-profile-pacing" role="radiogroup" aria-label="Pacing">
            {PACING_OPTIONS.map((o) => (
              <label key={o.id} className={`script-profile-pace${pacing === o.id ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="script-pacing"
                  value={o.id}
                  checked={pacing === o.id}
                  onChange={() => setPacing(o.id)}
                />
                <span className="script-profile-pace-text">
                  <span className="script-profile-pace-label">
                    {o.label}
                    {previews[o.id] && <span className="script-profile-pace-runtime">{previews[o.id]}</span>}
                  </span>
                  <span className="script-profile-help">{o.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="script-profile-subhead">Genre</div>
          <p className="script-profile-help">Pick as many as fit, or add your own. Saved with the script.</p>
          <div className="script-profile-chips" role="group" aria-label="Genres">
            {GENRE_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                className={`script-profile-chip${selected.has(g.toLowerCase()) ? ' selected' : ''}`}
                aria-pressed={selected.has(g.toLowerCase())}
                onClick={() => toggle(g)}
              >
                {g}
              </button>
            ))}
            {customGenres.map((g) => (
              <button
                key={`custom-${g}`}
                type="button"
                className="script-profile-chip selected custom"
                aria-label={`Remove ${g}`}
                title="Remove"
                onClick={() => toggle(g)}
              >
                {g} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
          <div className="script-profile-add">
            <input
              type="text"
              value={custom}
              placeholder="Add your own, e.g. Slow-burn Neo-Western"
              maxLength={200}
              aria-label="Add a genre"
              onChange={(e) => { setCustom(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
              }}
            />
            <button type="button" onClick={addCustom} disabled={!cleanGenre(custom.replace(/,/g, ''))}>Add</button>
          </div>

          {error && <p className="script-profile-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default ScriptProfileDialog;
