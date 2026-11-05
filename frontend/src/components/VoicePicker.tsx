/**
 * Choose a Table Read voice (issue #131) — for a character on their profile,
 * for the narrator, or in the Table Read panel's cast list.
 *
 * Lists the voices of whichever engine reads the script here: the machine's
 * installed voices in the app, the AI provider's in a browser (or in the app,
 * when the writer prefers it). "Automatic" leaves the choice to casting.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaPlay, FaStop } from 'react-icons/fa';
import type { CharacterVoice } from '../stores/editorStore';
import { useTableReadStore } from '../stores/tableReadStore';
import { useVoiceList } from '../hooks/useVoiceList';
import { primeAudioPlayback } from '../services/tts/aiEngine';
import { previewVoice } from '../services/tts/player';
import type { VoiceInfo } from '../services/tts/types';
import { showToast } from './Toast';
import Select from './Select';

function languageName(tag: string, other: string): string {
  if (!tag) return other;
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
  const { t } = useTranslation(['settings', 'common']);
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
      .sort(([a], [b]) => (a === want ? -1 : b === want ? 1 : languageName(a, t('voicePicker.otherLanguage')).localeCompare(languageName(b, t('voicePicker.otherLanguage')))))
      .map(([lang, list]) => ({ lang, label: languageName(lang, t('voicePicker.otherLanguage')), list: [...list].sort((x, y) => Number(!!x.novelty) - Number(!!y.novelty) || x.name.localeCompare(y.name)) }));
  }, [kind, voices, t]);

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
      showToast(t('voicePicker.previewFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setPreviewing(false);
    }
  }, [previewing, kind, chosen, automaticVoiceId, sample, t]);

  if (needsProvider) {
    return (
      <div className={`voice-picker${compact ? ' compact' : ''}`}>
        <button
          type="button"
          className="voice-picker-setup"
          onClick={() => useTableReadStore.getState().setNeedsProvider(true)}
        >
          {t('voicePicker.setUpProvider')}
        </button>
      </div>
    );
  }

  return (
    <div className={`voice-picker${compact ? ' compact' : ''}`}>
      <Select
        id={id}
        className="voice-picker-select"
        value={chosen ?? ''}
        disabled={loading || !!error}
        onChange={(e) => onChange(slot, e.target.value || undefined)}
        aria-label={t('voicePicker.voice')}
      >
        <option value="">
          {loading ? t('voicePicker.loading') : autoName ? t('voicePicker.automaticNamed', { name: autoName }) : t('voicePicker.automatic')}
        </option>
        {chosenMissing && (
          <option value={chosen}>{t('voicePicker.notOnDevice', { id: chosen.split(/[:.]/).pop() })}</option>
        )}
        {groups
          ? groups.map((g) => (
              <optgroup key={g.lang || 'other'} label={g.label}>
                {g.list.map((v) => <option key={v.id} value={v.id}>{voiceLabel(v)}</option>)}
              </optgroup>
            ))
          : voices.map((v) => <option key={v.id} value={v.id}>{voiceLabel(v)}</option>)}
      </Select>
      <button
        type="button"
        className="voice-picker-preview"
        onClick={handlePreview}
        disabled={loading || !!error || previewing}
        title={t('voicePicker.hear')}
        aria-label={t('voicePicker.hear')}
      >
        {previewing ? <FaStop /> : <FaPlay />}
      </button>
      {error && <div className="voice-picker-error" role="alert">{error}</div>}
      {chosenMissing && (
        <div className="voice-picker-hint">
          {t('voicePicker.missingHint')}
        </div>
      )}
    </div>
  );
};

export default VoicePicker;
