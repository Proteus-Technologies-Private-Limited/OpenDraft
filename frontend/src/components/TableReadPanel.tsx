/**
 * Table Read (issue #131): the script read aloud, a voice for each character.
 *
 * Docked along the bottom of the editor. The live preview shows the line
 * being read with the word the voice is on highlighted, the line before it
 * and the lines coming up; the same line and word are marked in the script,
 * which scrolls to follow. Clicking any line in the preview reads from there.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
import {
  FaPlay, FaPause, FaStop, FaStepBackward, FaStepForward, FaFastBackward, FaFastForward,
  FaCog, FaTimes, FaMicrophoneAlt,
} from 'react-icons/fa';
import { useTableReadStore, NARRATOR_KEY } from '../stores/tableReadStore';
import { useEditorStore } from '../stores/editorStore';
import { AI_PROVIDERS, isAiProviderConfigured, providerIsRemote, useVoiceSettingsStore, type TableReadOptions } from '../stores/voiceSettingsStore';
import { onKokoroProgress, type KokoroProgress } from '../services/tts/kokoroClient';
import { activeEngineKind, availableEngineKinds, selectedEngineKind } from '../services/tts/engines';
import { primeAudioPlayback } from '../services/tts/aiEngine';
import * as player from '../services/tts/player';
import type { ReadLine } from '../services/tts/script';
import VoicePicker from './VoicePicker';

/** The label shown for a kind of line. Looked up by kind, at render time. */
function kindLabel(kind: ReadLine['kind'], t: TFunction<'tools'>): string {
  switch (kind) {
    case 'sceneHeading': return t('tableRead.kinds.sceneHeading');
    case 'heading': return t('tableRead.kinds.heading');
    case 'action': return t('tableRead.kinds.action');
    case 'character': return t('tableRead.kinds.character');
    case 'dialogue': return t('tableRead.kinds.dialogue');
    case 'parenthetical': return t('tableRead.kinds.parenthetical');
    case 'transition': return t('tableRead.kinds.transition');
    case 'lyrics': return t('tableRead.kinds.lyrics');
    default: return kind;
  }
}

/** The "Read aloud" switches, built when rendered so the labels follow the language. */
function readToggles(t: TFunction<'tools'>): { key: keyof TableReadOptions; label: string }[] {
  return [
    { key: 'readSceneHeadings', label: t('tableRead.toggles.sceneHeadings') },
    { key: 'readAction', label: t('tableRead.toggles.action') },
    { key: 'readParentheticals', label: t('tableRead.toggles.parentheticals') },
    { key: 'readTransitions', label: t('tableRead.toggles.transitions') },
    { key: 'announceCharacters', label: t('tableRead.toggles.characterNames') },
  ];
}

function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const TableReadPanel: React.FC<{ editor: Editor }> = ({ editor }) => {
  const { t } = useTranslation('tools');
  const {
    lines, current, word, status, error, engineLabel, voices, casting,
  } = useTableReadStore();
  const profiles = useEditorStore((s) => s.characterProfiles);
  const upsertCharacterProfile = useEditorStore((s) => s.upsertCharacterProfile);
  const voiceSettings = useVoiceSettingsStore();
  const { options, narratorVoice, setNarratorVoice, setOptions } = voiceSettings;
  const [showSettings, setShowSettings] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load the script when the panel opens; stop and clear the highlight when it closes.
  useEffect(() => {
    player.prepare(editor);
    return () => player.teardown();
  }, [editor]);

  // A change of voice source (Settings, the provider dialog) takes effect on the next line.
  const engineKind = activeEngineKind(voiceSettings);
  const lastKind = useRef(engineKind);
  useEffect(() => {
    if (lastKind.current === engineKind) return;
    lastKind.current = engineKind;
    const playing = useTableReadStore.getState().status === 'playing';
    player.stop();
    player.resetEngine();
    if (playing) player.play(editor, useTableReadStore.getState().current);
  }, [engineKind, editor]);

  const line = lines[current];
  const playing = status === 'playing' || status === 'loading';

  const voiceName = useCallback((id: string | null | undefined) => {
    if (!id) return '';
    return voices.find((v) => v.id === id)?.name ?? '';
  }, [voices]);

  const colorOf = useCallback((speaker: string | null) => {
    if (!speaker) return undefined;
    const c = profiles.find((p) => p.name === speaker)?.color;
    return c && c !== '#ffffff' && c !== '#000000' ? c : undefined;
  }, [profiles]);

  const speakers = useMemo(() => {
    const seen: string[] = [];
    for (const l of lines) if (l.speaker && !seen.includes(l.speaker)) seen.push(l.speaker);
    return seen;
  }, [lines]);

  const sceneTotal = useMemo(() => lines.reduce((m, l) => Math.max(m, l.sceneIndex), -1) + 1, [lines]);

  const togglePlay = useCallback(() => {
    // Inside the click, so Safari will let the provider's audio play later.
    if (activeEngineKind() === 'ai') primeAudioPlayback();
    const s = useTableReadStore.getState().status;
    if (s === 'playing' || s === 'loading') player.pause();
    else if (s === 'paused') player.resume();
    else player.play(editor, useTableReadStore.getState().current);
  }, [editor]);

  const selectedSource = selectedEngineKind(voiceSettings);

  // Kokoro's first use downloads its model; say so rather than sit silent.
  const [kokoro, setKokoro] = useState<KokoroProgress>({ fraction: null, device: null, busy: 0 });
  useEffect(() => onKokoroProgress(setKokoro), []);

  const remoteProvider = engineKind === 'ai' && providerIsRemote(voiceSettings.aiProvider)
    ? (voiceSettings.aiProvider === 'openai-compatible'
        ? t('tableRead.yourSpeechServer')
        : AI_PROVIDERS.find((p) => p.id === voiceSettings.aiProvider)?.label ?? t('tableRead.theProvider'))
    : null;

  /** Switch voice source from the panel; AI with no provider set up opens the setup dialog. */
  const chooseSource = useCallback((kind: 'system' | 'ai') => {
    const vs = useVoiceSettingsStore.getState();
    vs.setEnginePreference(kind);
    if (kind === 'ai' && !isAiProviderConfigured(vs)) useTableReadStore.getState().setNeedsProvider(true);
  }, []);

  const close = useCallback(() => {
    useTableReadStore.getState().setOpen(false);
  }, []);

  // Space plays and pauses, Escape closes — only while focus is in the panel,
  // so neither ever reaches the script.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); player.step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); player.step(-1); }
  };

  const setOption = (patch: Partial<TableReadOptions>, rebuild: boolean) => {
    setOptions(patch);
    if (rebuild) player.rebuild();
    else if ('rate' in patch) player.restartCurrentLine();
  };

  const renderCurrent = (l: ReadLine) => {
    const w = word && word.end <= l.text.length ? word : null;
    if (!w) return <span>{l.text}</span>;
    return (
      <>
        <span className="table-read-spoken">{l.text.slice(0, w.start)}</span>
        <mark className="table-read-preview-word">{l.text.slice(w.start, w.end)}</mark>
        <span>{l.text.slice(w.end)}</span>
      </>
    );
  };

  const speakerLabel = (l: ReadLine) => {
    if (l.speaker && (l.kind === 'dialogue' || l.kind === 'lyrics' || l.kind === 'parenthetical')) return l.cue || l.speaker;
    return kindLabel(l.kind, t);
  };

  const readerOf = (l: ReadLine) => {
    const id = l.speaker && (l.kind === 'dialogue' || l.kind === 'lyrics') ? casting[l.speaker] : casting[NARRATOR_KEY];
    return voiceName(id);
  };

  const before = lines.slice(Math.max(0, current - 1), current);
  const after = lines.slice(current + 1, current + 3);

  return (
    <div
      className="table-read-panel"
      ref={panelRef}
      role="region"
      aria-label={t('tableRead.title')}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div className="table-read-header">
        <FaMicrophoneAlt className="table-read-icon" aria-hidden="true" />
        <span className="table-read-title">{t('tableRead.title')}</span>
        {availableEngineKinds().length > 1 ? (
          <div className="table-read-source" role="radiogroup" aria-label={t('tableRead.voiceSource')}>
            {(['system', 'ai'] as const).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={selectedSource === k}
                className={selectedSource === k ? 'active' : ''}
                onClick={() => chooseSource(k)}
                title={k === 'system' ? t('tableRead.systemVoicesTitle') : t('tableRead.aiVoicesTitle')}
              >
                {k === 'system' ? t('tableRead.systemVoices') : t('tableRead.aiVoices')}
              </button>
            ))}
          </div>
        ) : (
          engineLabel && <span className="table-read-engine">{engineLabel}</span>
        )}
        <span className="table-read-progress">
          {lines.length ? t('tableRead.lineOf', { current: current + 1, total: lines.length }) : t('tableRead.noLines')}
          {line && line.sceneIndex >= 0 ? ` · ${t('tableRead.sceneOf', { current: line.sceneIndex + 1, total: sceneTotal })}` : ''}
        </span>
        <button
          className={`table-read-icon-btn${showSettings ? ' active' : ''}`}
          onClick={() => setShowSettings((v) => !v)}
          title={t('tableRead.options')}
          aria-label={t('tableRead.options')}
          aria-expanded={showSettings}
        >
          <FaCog />
        </button>
        <button className="table-read-icon-btn" onClick={close} title={t('tableRead.close')} aria-label={t('tableRead.close')}>
          <FaTimes />
        </button>
      </div>

      {remoteProvider && (
        <div className="table-read-notice table-read-notice-warn" role="note">
          {t('tableRead.remoteWarning', { provider: remoteProvider })}
        </div>
      )}
      {engineKind === 'ai' && voiceSettings.aiProvider === 'kokoro' && kokoro.fraction === null && kokoro.busy > 0 && status === 'playing' && !word && (
        <div className="table-read-notice" role="status">
          {t('tableRead.kokoroPreparing', { device: kokoro.device === 'webgpu' ? t('tableRead.graphicsChip') : t('tableRead.processor') })}
        </div>
      )}
      {kokoro.fraction !== null && (
        <div className="table-read-notice" role="status">
          {t('tableRead.kokoroDownloading', { percent: Math.round(kokoro.fraction * 100) })}
          <progress max={1} value={kokoro.fraction} />
        </div>
      )}

      <div className="table-read-body">
        <div className="table-read-preview" aria-live="off">
          {lines.length === 0 ? (
            <div className="table-read-empty">
              <Trans ns="tools" i18nKey="tableRead.empty" components={{ icon: <FaCog aria-hidden="true" /> }} />
            </div>
          ) : (
            <>
              {before.map((l) => (
                <button key={l.index} className="table-read-line table-read-line-dim" onClick={() => player.jumpTo(l.index)}>
                  <span className="table-read-who">{speakerLabel(l)}</span>
                  <span className="table-read-text">{l.text}</span>
                </button>
              ))}
              {line && (
                <div
                  className={`table-read-line table-read-line-current kind-${line.kind}`}
                  style={colorOf(line.speaker) ? { borderLeftColor: colorOf(line.speaker) } : undefined}
                >
                  <div className="table-read-who">
                    <span style={colorOf(line.speaker) ? { color: colorOf(line.speaker) } : undefined}>{speakerLabel(line)}</span>
                    {readerOf(line) && <span className="table-read-voice">{t('tableRead.voice', { name: readerOf(line) })}</span>}
                  </div>
                  <div className="table-read-text">{renderCurrent(line)}</div>
                </div>
              )}
              {after.map((l) => (
                <button key={l.index} className="table-read-line table-read-line-dim" onClick={() => player.jumpTo(l.index)}>
                  <span className="table-read-who">{speakerLabel(l)}</span>
                  <span className="table-read-text">{l.text}</span>
                </button>
              ))}
            </>
          )}
          {error && (
            <div className="table-read-error" role="alert">
              {error}
            </div>
          )}
        </div>

        {showSettings && (
          <div className="table-read-settings">
            <div className="table-read-settings-group">
              <div className="table-read-settings-title">{t('tableRead.readAloud')}</div>
              {readToggles(t).map((toggle) => (
                <label key={toggle.key} className="table-read-check">
                  <input
                    type="checkbox"
                    checked={!!options[toggle.key]}
                    onChange={(e) => setOption({ [toggle.key]: e.target.checked }, true)}
                  />
                  {toggle.label}
                </label>
              ))}
              <label className="table-read-check">
                <input
                  type="checkbox"
                  checked={options.followScript}
                  onChange={(e) => setOption({ followScript: e.target.checked }, false)}
                />
                {t('tableRead.followAlong')}
              </label>
              <button className="table-read-link" onClick={() => useTableReadStore.getState().setNeedsProvider(true)}>
                {t('tableRead.voiceSourceLink')}
              </button>
            </div>

            <div className="table-read-settings-group table-read-cast">
              <div className="table-read-settings-title">{t('tableRead.cast')}</div>
              <div className="table-read-cast-row">
                <span className="table-read-cast-name">{t('tableRead.narrator')}</span>
                <VoicePicker
                  compact
                  value={narratorVoice}
                  onChange={(slot, id) => { setNarratorVoice(slot, id); player.restartCurrentLine(); }}
                  sample="Interior. Kitchen. Night. Rain hammers the windows." /* i18n-ignore: sample spoken aloud by the voice, in English */
                  automaticVoiceId={casting[NARRATOR_KEY]}
                />
              </div>
              {speakers.map((name) => {
                const profile = profiles.find((p) => p.name === name);
                return (
                  <div key={name} className="table-read-cast-row">
                    <span className="table-read-cast-name" style={colorOf(name) ? { color: colorOf(name) } : undefined}>
                      {titleCase(name)}
                    </span>
                    <VoicePicker
                      compact
                      value={profile?.voice}
                      onChange={(slot, id) => {
                        const voice = { ...(profile?.voice ?? {}) };
                        if (id) voice[slot] = id;
                        else delete voice[slot];
                        upsertCharacterProfile(name, { voice });
                        player.restartCurrentLine();
                      }}
                      sample={`Hello, I'm ${titleCase(name)}.`} /* i18n-ignore: sample spoken aloud by the voice */
                      automaticVoiceId={casting[name]}
                    />
                  </div>
                );
              })}
              {speakers.length === 0 && <div className="table-read-hint">{t('tableRead.noSpeakers')}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="table-read-controls">
        <button onClick={() => player.stepScene(-1)} disabled={!lines.length} title={t('tableRead.previousScene')} aria-label={t('tableRead.previousScene')}><FaFastBackward /></button>
        <button onClick={() => player.step(-1)} disabled={!lines.length || current === 0} title={t('tableRead.previousLine')} aria-label={t('tableRead.previousLine')}><FaStepBackward /></button>
        <button
          className="table-read-play"
          onClick={togglePlay}
          disabled={!lines.length}
          title={playing ? t('tableRead.pauseTitle') : status === 'paused' ? t('tableRead.resumeTitle') : t('tableRead.playTitle')}
          aria-label={playing ? t('tableRead.pause') : t('tableRead.play')}
        >
          {status === 'loading' ? <span className="table-read-spinner" aria-hidden="true" /> : playing ? <FaPause /> : <FaPlay />}
        </button>
        <button onClick={() => player.step(1)} disabled={!lines.length || current >= lines.length - 1} title={t('tableRead.nextLine')} aria-label={t('tableRead.nextLine')}><FaStepForward /></button>
        <button onClick={() => player.stepScene(1)} disabled={!lines.length} title={t('tableRead.nextScene')} aria-label={t('tableRead.nextScene')}><FaFastForward /></button>
        <button onClick={() => player.stop()} disabled={status === 'idle' || status === 'error'} title={t('tableRead.stop')} aria-label={t('tableRead.stop')}><FaStop /></button>
        <button
          className="table-read-from-cursor"
          onClick={() => {
            if (activeEngineKind() === 'ai') primeAudioPlayback();
            player.play(editor);
          }}
          disabled={!lines.length}
          title={t('tableRead.fromCursorTitle')}
        >
          {t('tableRead.fromCursor')}
        </button>
        <label className="table-read-speed">
          <span>{t('tableRead.speed', { value: options.rate.toFixed(2).replace(/0$/, '') })}</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={options.rate}
            onChange={(e) => setOptions({ rate: Number(e.target.value) })}
            onPointerUp={() => player.restartCurrentLine()}
            onKeyUp={() => player.restartCurrentLine()}
            aria-label={t('tableRead.readingSpeed')}
          />
        </label>
      </div>
    </div>
  );
};

export default TableReadPanel;
