import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { PLUGIN_PANEL_CLOSE_EVENT } from '../../components/PluginPanelTabs';
import { loadSettings } from './settings';
import { availableEngines, ENGINE_NAMES, ENGINE_PRIVACY } from './capabilities';
import { onDeactivate } from './lifecycle';
import { insertDictation } from './editor/dictation';
import { parseDictation } from './utils/dictation';
import { getOS } from '../../services/platform';
import { startBrowserRecognition, type RecognitionSession } from './services/recognition';
import { startLocalRecognition, disposeLocalRecognition } from './services/local';
import { startNativeRecognition } from './services/native';
import './DictationDialog.css';

export default function DictationDialog({ editor }: { editor: Editor }) {
  const close = () => document.dispatchEvent(new CustomEvent(PLUGIN_PANEL_CLOSE_EVENT));
  const [{ engine, language, commands }] = useState(loadSettings);
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
    const unsubscribe = onDeactivate(cancel);
    if (!dialog.current?.open) dialog.current?.showModal();
    const hide = () => { if (document.hidden && !(engine === 'device' && getOS() === 'android')) { cancel(); setBusy(false); setText(''); setStatus('Recording stopped because the app was hidden.'); } };
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancel(); disposeLocalRecognition(); unsubscribe();
      document.removeEventListener('visibilitychange', hide);
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.commands.focus(); else previous?.focus();
      });
    };
  }, [cancel, editor, engine]);
  const start = async () => {
    cancel();
    if (!availableEngines().includes(engine)) { setError('This recognition engine is unavailable here. Choose an available engine in Settings → Add-ons → Dictation.'); return; }
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setText(''); setError(''); setStatus('Listening…');
    const callbacks = {
      result: (value: string) => { if (!abort.signal.aborted) { setText(value); setStatus('Review the transcript before inserting.'); } },
      interim: (value: string) => { if (!abort.signal.aborted) { setStatus(value); } },
      notice: (value: string) => { if (!abort.signal.aborted) setStatus(value); },
      error: (value: string) => { if (!abort.signal.aborted) { setText(''); setError(value); } },
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
    <p><strong>{ENGINE_NAMES[engine]}</strong> · {language}</p>
    <p>{ENGINE_PRIVACY[engine]}</p>
    {engine === 'local' && <p>First use downloads 39 MiB of q8 model weights, plus tokenizer and runtime assets. Recordings stop after 30 seconds; first recognition may take a few minutes.</p>}
    {engine === 'device' && getOS() === 'android' && <p>Use the system speech dialog to finish or cancel recording.</p>}
    <p>Change engine, language or voice commands in Settings → Add-ons → Dictation.</p>
    {commands && <p>Say a complete command: “new scene”, “character Sarah”, “action”, “dialogue”, “parenthetical”, “transition”, or “new paragraph”. Prefix “literal” to dictate those words instead.</p>}
    <div className="dictation-controls"><button type="button" onClick={() => void start()} disabled={busy}>Start recording</button><button type="button" disabled={!busy || (engine === 'device' && getOS() === 'android')} onClick={() => { session.current?.stop(); setStatus('Finishing recognition…'); }}>Stop</button><button type="button" disabled={!busy} onClick={() => { cancel(); setBusy(false); setText(''); setStatus('Cancelled.'); }}>Cancel recording</button></div>
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
