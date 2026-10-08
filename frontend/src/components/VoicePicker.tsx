/**
 * Choose a Table Read voice (issue #131) — for a character on their profile,
 * for the narrator, or in the Table Read panel's cast list.
 *
 * Lists the voices of whichever engine reads the script here: the machine's
 * installed voices in the app, the AI provider's in a browser (or in the app,
 * when the writer prefers it). "Automatic" leaves the choice to casting.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FaPlay, FaStop } from 'react-icons/fa';
import type { CharacterVoice } from '../stores/editorStore';
import { useTableReadStore } from '../stores/tableReadStore';
import { useVoiceList } from '../hooks/useVoiceList';
import { primeAudioPlayback } from '../services/tts/aiEngine';
import { previewVoice } from '../services/tts/player';
import type { VoiceInfo } from '../services/tts/types';
import { showToast } from './Toast';

function languageName(tag: string): string {
  if (!tag) return 'Other';
  try {
    const dn = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
    return dn.of(tag) || tag;
  } catch {
    return tag;
  }
}

function voiceLabel(v: VoiceInfo): string {
  const extra = [v.gender, v.detail].filter(Boolean).join(', ');
  return extra ? `${v.name} (${extra})` : v.name;
}

interface VoicePickerProps {
  /** The voices already chosen, one per engine kind. */
  value: CharacterVoice | undefined;
  onChange: (slot: keyof CharacterVoice, id: string | undefined) => void;
  /** What Preview says. */
  sample: string;
  /** Voice casting picked when the value is Automatic, shown as a hint. */
  automaticVoiceId?: string | null;
  id?: string;
  compact?: boolean;
}

const VoicePicker: React.FC<VoicePickerProps> = ({ value, onChange, sample, automaticVoiceId, id, compact }) => {
  const { kind, voices, loading, error, needsProvider } = useVoiceList();
  const [previewing, setPreviewing] = useState(false);
  const slot: keyof CharacterVoice = kind === 'ai' ? 'ai' : 'system';
  const chosen = value?.[slot];
  const chosenMissing = !!chosen && !loading && !voices.some((v) => v.id === chosen);

  // System voices come in dozens of languages; group them so the writer's own is easy to find.
  const groups = useMemo(() => {
    if (kind === 'ai') return null;
    const want = (navigator.language || 'en').toLowerCase().split('-')[0];
    const byLang = new Map<string, VoiceInfo[]>();
    for (const v of voices) {
      const lang = v.lang ? v.lang.split(/[-_]/)[0].toLowerCase() : '';
      const list = byLang.get(lang) ?? [];
      list.push(v);
      byLang.set(lang, list);
    }
    return [...byLang.entries()]
      .sort(([a], [b]) => (a === want ? -1 : b === want ? 1 : languageName(a).localeCompare(languageName(b))))
      .map(([lang, list]) => ({ lang, label: languageName(lang), list: [...list].sort((x, y) => Number(!!x.novelty) - Number(!!y.novelty) || x.name.localeCompare(y.name)) }));
  }, [kind, voices]);

  const autoName = automaticVoiceId ? voices.find((v) => v.id === automaticVoiceId)?.name : undefined;

  const handlePreview = useCallback(async () => {
    if (previewing) return;
    // Has to happen inside the click for Safari to allow the audio later.
    if (kind === 'ai') primeAudioPlayback();
    setPreviewing(true);
    try {
      await previewVoice(kind, chosen ?? automaticVoiceId ?? null, sample);
    } catch (err) {
      console.warn('[tableRead] voice preview failed:', err);
      showToast(`Could not play the voice: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setPreviewing(false);
    }
  }, [previewing, kind, chosen, automaticVoiceId, sample]);

  if (needsProvider) {
    return (
      <div className={`voice-picker${compact ? ' compact' : ''}`}>
        <button
          type="button"
          className="voice-picker-setup"
          onClick={() => useTableReadStore.getState().setNeedsProvider(true)}
        >
          Set up an AI voice provider…
        </button>
      </div>
    );
  }

  return (
    <div className={`voice-picker${compact ? ' compact' : ''}`}>
      <select
        id={id}
        className="voice-picker-select"
        value={chosen ?? ''}
        disabled={loading || !!error}
        onChange={(e) => onChange(slot, e.target.value || undefined)}
        aria-label="Voice"
      >
        <option value="">
          {loading ? 'Loading voices…' : autoName ? `Automatic (${autoName})` : 'Automatic'}
        </option>
        {chosenMissing && (
          <option value={chosen}>Not on this device ({chosen.split(/[:.]/).pop()})</option>
        )}
        {groups
          ? groups.map((g) => (
              <optgroup key={g.lang || 'other'} label={g.label}>
                {g.list.map((v) => <option key={v.id} value={v.id}>{voiceLabel(v)}</option>)}
              </optgroup>
            ))
          : voices.map((v) => <option key={v.id} value={v.id}>{voiceLabel(v)}</option>)}
      </select>
      <button
        type="button"
        className="voice-picker-preview"
        onClick={handlePreview}
        disabled={loading || !!error || previewing}
        title="Hear this voice"
        aria-label="Hear this voice"
      >
        {previewing ? <FaStop /> : <FaPlay />}
      </button>
      {error && <div className="voice-picker-error" role="alert">{error}</div>}
      {chosenMissing && (
        <div className="voice-picker-hint">
          That voice is not installed here, so an automatic voice reads instead.
        </div>
      )}
    </div>
  );
};

export default VoicePicker;
