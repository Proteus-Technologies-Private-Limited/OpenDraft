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
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import type { JSONContent } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import {
  GENRE_PRESETS, MAX_GENRES, PACING_OPTIONS, cleanGenre, normalizeGenres, type Pacing,
} from '../utils/scriptProfile';
import { activeTimingOptions, computeSceneTiming, formatRuntime } from '../utils/scriptTiming';

interface Props {
  onClose: () => void;
  /** The current document, for the per-pacing runtime preview. */
  getDoc: () => JSONContent | null | undefined;
}

const ScriptProfileDialog: React.FC<Props> = ({ onClose, getDoc }) => {
  const { t } = useTranslation(['story', 'common']);
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
        if (secs > 0) out[o.id] = formatRuntime(secs);
      }
    } catch (err) {
      console.warn('[scriptProfile] runtime preview failed', err);
    }
    return out;
  }, [getDoc]);

  // Genres are stored as their English spelling; only the displayed label is looked up.
  const genreLabels: Record<string, string> = {
    "Action": t('scriptProfile.genres.action'),
    "Adventure": t('scriptProfile.genres.adventure'),
    "Animation": t('scriptProfile.genres.animation'),
    "Biopic": t('scriptProfile.genres.biopic'),
    "Comedy": t('scriptProfile.genres.comedy'),
    "Coming-of-Age": t('scriptProfile.genres.comingOfAge'),
    "Crime": t('scriptProfile.genres.crime'),
    "Dark Comedy": t('scriptProfile.genres.darkComedy'),
    "Documentary": t('scriptProfile.genres.documentary'),
    "Drama": t('scriptProfile.genres.drama'),
    "Family": t('scriptProfile.genres.family'),
    "Fantasy": t('scriptProfile.genres.fantasy'),
    "Historical": t('scriptProfile.genres.historical'),
    "Horror": t('scriptProfile.genres.horror'),
    "Legal": t('scriptProfile.genres.legal'),
    "Musical": t('scriptProfile.genres.musical'),
    "Mystery": t('scriptProfile.genres.mystery'),
    "Noir": t('scriptProfile.genres.noir'),
    "Political": t('scriptProfile.genres.political'),
    "Psychological Thriller": t('scriptProfile.genres.psychologicalThriller'),
    "Romance": t('scriptProfile.genres.romance'),
    "Romantic Comedy": t('scriptProfile.genres.romanticComedy'),
    "Satire": t('scriptProfile.genres.satire'),
    "Sci-Fi": t('scriptProfile.genres.sciFi'),
    "Sports": t('scriptProfile.genres.sports'),
    "Superhero": t('scriptProfile.genres.superhero'),
    "Thriller": t('scriptProfile.genres.thriller'),
    "War": t('scriptProfile.genres.war'),
    "Western": t('scriptProfile.genres.western'),
  };
  const genreLabel = (g: string) => genreLabels[g] ?? g;
  const paceLabels: Record<Pacing, { label: string; description: string }> = {
    brisk: { label: t('scriptProfile.pace.brisk.label'), description: t('scriptProfile.pace.brisk.description') },
    standard: { label: t('scriptProfile.pace.standard.label'), description: t('scriptProfile.pace.standard.description') },
    measured: { label: t('scriptProfile.pace.measured.label'), description: t('scriptProfile.pace.measured.description') },
  };

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
      setError(t('scriptProfile.maxGenres', { max: MAX_GENRES }));
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
      setError(t('scriptProfile.saveFailed', { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box script-profile-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-profile-title"
      >
        <div className="dialog-header" id="script-profile-title">{t('scriptProfile.title')}</div>
        <div className="dialog-body">
          <div className="script-profile-subhead">{t('scriptProfile.pacing')}</div>
          <p className="script-profile-help">
            {t('scriptProfile.pacingHelp')}
          </p>
          <div className="script-profile-pacing" role="radiogroup" aria-label={t('scriptProfile.pacing')}>
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
                    {paceLabels[o.id]?.label ?? o.label}
                    {previews[o.id] && <span className="script-profile-pace-runtime">{previews[o.id]}</span>}
                  </span>
                  <span className="script-profile-help">{paceLabels[o.id]?.description ?? o.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="script-profile-subhead">{t('scriptProfile.genre')}</div>
          <p className="script-profile-help">{t('scriptProfile.genreHelp')}</p>
          <div className="script-profile-chips" role="group" aria-label={t('scriptProfile.genresGroup')}>
            {GENRE_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                className={`script-profile-chip${selected.has(g.toLowerCase()) ? ' selected' : ''}`}
                aria-pressed={selected.has(g.toLowerCase())}
                onClick={() => toggle(g)}
              >
                {genreLabel(g)}
              </button>
            ))}
            {customGenres.map((g) => (
              <button
                key={`custom-${g}`}
                type="button"
                className="script-profile-chip selected custom"
                aria-label={t('scriptProfile.removeGenre', { genre: g })}
                title={t('scriptProfile.remove')}
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
              placeholder={t('scriptProfile.customPlaceholder')}
              maxLength={200}
              aria-label={t('scriptProfile.addGenre')}
              onChange={(e) => { setCustom(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
              }}
            />
            <button type="button" onClick={addCustom} disabled={!cleanGenre(custom.replace(/,/g, ''))}>{t('common:add')}</button>
          </div>

          {error && <p className="script-profile-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={save}>{t('common:save')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ScriptProfileDialog;
