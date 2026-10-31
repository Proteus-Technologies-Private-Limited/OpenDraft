import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useDictationStore } from '../stores/dictationStore';
import { insertDictation } from '../editor/dictation';
import { parseDictation } from '../utils/dictation';
import { getOS, isMobileTauri } from '../services/platform';
import { startBrowserRecognition, type RecognitionSession } from '../services/dictation/recognition';
import { startLocalRecognition } from '../services/dictation/local';
import { startNativeRecognition } from '../services/dictation/native';
import './DictationDialog.css';

type Engine = 'local' | 'browser' | 'device';
export default function DictationDialog({ editor }: { editor: Editor }) {
  const close = () => useDictationStore.getState().setOpen(false);
  const [engine, setEngine] = useState<Engine>(isMobileTauri() ? 'device' : 'local');
  const [language, setLanguage] = useState('en');
  const [commands, setCommands] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const session = useRef<RecognitionSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useCallback(() => { controller.current?.abort(); session.current?.cancel(); session.current = null; }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.current?.open) dialog.current?.showModal();
    const hide = () => { if (document.hidden && !(engine === 'device' && getOS() === 'android')) { cancel(); setBusy(false); setStatus('Recording stopped because the app was hidden.'); } };
    document.addEventListener('visibilitychange', hide);
    return () => { cancel(); document.removeEventListener('visibilitychange', hide); previous?.focus(); };
  }, [cancel, engine]);
  const start = async () => {
    cancel();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setText(''); setError(''); setStatus('Listening…');
    const callbacks = {
      result: (value: string) => { if (!abort.signal.aborted) { setText(value); setStatus('Review the transcript before inserting.'); } },
      interim: (value: string) => { if (!abort.signal.aborted) { if (engine !== 'local') setText(value); setStatus(value); } },
      error: (value: string) => { if (!abort.signal.aborted) setError(value); },
      end: () => { if (!abort.signal.aborted) { setBusy(false); setStatus('Recording stopped. Review the transcript before inserting.'); } },
    };
    try {
      const value = engine === 'device' ? await startNativeRecognition(language, callbacks, abort.signal)
        : engine === 'browser' ? startBrowserRecognition(language, callbacks)
        : await startLocalRecognition(language, callbacks, abort.signal);
      if (abort.signal.aborted) value.cancel(); else session.current = value;
    } catch (err) { if (!abort.signal.aborted) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); setStatus(''); } }
  };
  const action = parseDictation(text, commands);
  return <dialog ref={dialog} className="dictation-dialog" aria-labelledby="dictation-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <h2 id="dictation-title">Dictation</h2>
    <p>Speak a short phrase, review it, then insert it at the script cursor.</p>
    <label>Recognition <select aria-label="Recognition" value={engine} disabled={busy} onChange={e => setEngine(e.target.value as Engine)}>
      <option value="local">Local Whisper (on this device)</option>
      <option value="browser">Browser speech service</option>
      {isMobileTauri() && <option value="device">Device speech service</option>}
    </select></label>
    <p>{engine === 'local' ? 'Starting downloads the Whisper Tiny model if needed (roughly 100 MB). Audio stays on this device. Recordings stop after 30 seconds; first recognition may take a few minutes.' : 'Your browser or device speech provider may send audio to its servers. Starting grants consent to use that provider. Availability and offline support depend on your device.'}</p>
    <label>Language <select aria-label="Language" value={language} disabled={busy} onChange={e => setLanguage(e.target.value)}>
      <option value="en">English</option><option value="pl">Polish</option><option value="fr">French</option><option value="de">German</option><option value="es">Spanish</option><option value="it">Italian</option><option value="pt">Portuguese</option><option value="ja">Japanese</option>
    </select></label>
    <label><input type="checkbox" checked={commands} onChange={e => setCommands(e.target.checked)} /> Interpret English voice commands</label>
    {commands && <p>Say a complete command: “new scene”, “character Sarah”, “action”, “dialogue”, “parenthetical”, “transition”, or “new paragraph”. Prefix “literal” to dictate those words instead.</p>}
    <div className="dictation-controls"><button type="button" onClick={() => void start()} disabled={busy}>Start recording</button><button type="button" disabled={!busy} onClick={() => session.current?.stop()}>Stop</button><button type="button" disabled={!busy} onClick={() => { cancel(); setBusy(false); setStatus('Cancelled.'); }}>Cancel recording</button></div>
    <p role="status" aria-live="polite">{status}</p>
    {error && <p role="alert">{error}</p>}
    <label>Transcript <textarea aria-label="Transcript" value={text} onChange={e => setText(e.target.value)} rows={4} disabled={busy} /></label>
    {action?.kind === 'element' && <p>Command: start {action.type}{action.text ? `: ${action.text}` : ''}.</p>}
    <div className="dictation-controls"><button type="button" disabled={busy || !text.trim() || !editor.isEditable} onClick={() => {
      if (insertDictation(editor, text, commands)) { setText(''); setStatus('Inserted.'); }
      else setError('Place the cursor in a screenplay text element before inserting.');
    }}>Insert into script</button><button type="button" onClick={close}>Close</button></div>
  </dialog>;
}
