/**
 * "Set Up Table Read Voices" — opened when a Table Read needs a voice source:
 * in a browser the first time (installed voices or an AI provider), and
 * anywhere AI voices are chosen with no provider configured (issue #131).
 */
import React, { useEffect } from 'react';
import { useTableReadStore } from '../stores/tableReadStore';
import { isAiProviderConfigured, useVoiceSettingsStore } from '../stores/voiceSettingsStore';
import { isTauri } from '../services/platform';
import { selectedEngineKind } from '../services/tts/engines';
import VoiceProviderSettings from './VoiceProviderSettings';

const VoiceProviderDialog: React.FC = () => {
  const open = useTableReadStore((s) => s.needsProvider);
  const settings = useVoiceSettingsStore();
  const configured = isAiProviderConfigured(settings);
  const close = () => useTableReadStore.getState().setNeedsProvider(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={close}>
      <div
        className="dialog-box voice-provider-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-provider-title"
      >
        <div className="dialog-header" id="voice-provider-title">Set Up Table Read Voices</div>
        <div className="dialog-body">
          <p className="voice-provider-intro">
            {isTauri()
              ? 'Table Read can use the voices installed on this device, or an AI voice provider with your own API key.'
              : 'Choose how Table Read speaks in the browser: with the voices installed on this computer, free, or with an AI voice provider and your own API key.'}
          </p>
          <VoiceProviderSettings autoFocus />
        </div>
        <div className="dialog-actions">
          <button onClick={close}>Cancel</button>
          <button
            className="dialog-primary"
            disabled={selectedEngineKind(settings) === null || (selectedEngineKind(settings) === 'ai' && !configured)}
            onClick={close}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceProviderDialog;
