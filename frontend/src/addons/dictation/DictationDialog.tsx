import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { PLUGIN_PANEL_CLOSE_EVENT } from '../../components/PluginPanelTabs';
import { loadSettings } from './settings';
import { availableEngines, engineName, enginePrivacy } from './capabilities';
import { onDeactivate } from './lifecycle';
import { insertDictation } from './editor/dictation';
import { parseDictation } from './utils/dictation';
import { getOS } from '../../services/platform';
import { startBrowserRecognition, type RecognitionSession } from './services/recognition';
import { startLocalRecognition, disposeLocalRecognition } from './services/local';
import { startNativeRecognition } from './services/native';
import './DictationDialog.css';

export default function DictationDialog({ editor }: { editor: Editor }) {
  const { t } = useTranslation(['addons', 'common']);
  const close = () => document.dispatchEvent(new CustomEvent(PLUGIN_PANEL_CLOSE_EVENT));
  const [{ engine, language, commands }] = useState(loadSettings);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const session = useRef<RecognitionSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    controller.current?.abort();
    session.current?.cancel();
    session.current = null;
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unsubscribe = onDeactivate(cancel);
    const hide = () => {
      if (document.hidden && !(engine === 'device' && getOS() === 'android')) {
        cancel();
        setBusy(false);
        setText('');
        setStatus(t('dictation.status.hidden'));
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancel();
      disposeLocalRecognition();
      unsubscribe();
      document.removeEventListener('visibilitychange', hide);
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.commands.focus();
        else previous?.focus();
      });
    };
  }, [cancel, editor, engine, t]);
  const start = async () => {
    cancel();
    if (!availableEngines().includes(engine)) {
      setError(t('dictation.error.engineUnavailable'));
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setText('');
    setError('');
    setStatus(t('dictation.status.listening'));
    let failed = false;
    const callbacks = {
      result: (value: string) => {
        if (!abort.signal.aborted && !failed) {
          setText(value);
          setStatus(t('dictation.status.review'));
        }
      },
      interim: (value: string) => {
        if (!abort.signal.aborted && !failed) {
          setStatus(value);
        }
      },
      notice: (value: string) => {
        if (!abort.signal.aborted && !failed) setStatus(value);
      },
      error: (value: string) => {
        if (!abort.signal.aborted) {
          failed = true;
          setText('');
          setStatus('');
          setError(value);
        }
      },
      end: () => {
        if (!abort.signal.aborted) {
          setBusy(false);
          if (!failed) setStatus(t('dictation.status.stopped'));
        }
      },
    };
    try {
      const value =
        engine === 'device'
          ? await startNativeRecognition(language, callbacks, abort.signal)
          : engine === 'browser'
            ? startBrowserRecognition(language, callbacks)
            : await startLocalRecognition(language, callbacks, abort.signal);
      if (abort.signal.aborted) value.cancel();
      else session.current = value;
    } catch (err) {
      if (!abort.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        setStatus('');
      }
    }
  };
  const action = parseDictation(text, commands);
  return (
    <section
      className="dictation-panel"
      aria-labelledby="dictation-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <h2 id="dictation-title">{t('dictation.title')}</h2>
      <p>{t('dictation.intro')}</p>
      <p>
        <strong>{engineName(engine)}</strong> · {language}
      </p>
      <p>{enginePrivacy(engine)}</p>
      {engine === 'local' && (
        <p>{t('dictation.localNote')}</p>
      )}
      {engine === 'device' && getOS() === 'android' && (
        <p>{t('dictation.androidNote')}</p>
      )}
      <p>{t('dictation.changeSettings')}</p>
      {commands && (
        <p>{t('dictation.commandsHelp')}</p>
      )}
      <div className="dictation-controls">
        <button type="button" onClick={() => void start()} disabled={busy}>
          {t('dictation.start')}
        </button>
        <button
          type="button"
          disabled={!busy || (engine === 'device' && getOS() === 'android')}
          onClick={() => {
            setStatus(t('dictation.status.finishing'));
            session.current?.stop();
          }}
        >
          {t('dictation.stop')}
        </button>
        <button
          type="button"
          disabled={!busy}
          onClick={() => {
            cancel();
            setBusy(false);
            setText('');
            setStatus(t('dictation.status.cancelled'));
          }}
        >
          {t('dictation.cancel')}
        </button>
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('dictation.transcript')}{' '}
        <textarea
          aria-label={t('dictation.transcript')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          disabled={busy}
        />
      </label>
      {action?.kind === 'element' && (
        <p>
          {action.text
            ? t('dictation.commandWithText', { type: action.type, text: action.text })
            : t('dictation.command', { type: action.type })}
        </p>
      )}
      <div className="dictation-controls">
        <button
          type="button"
          disabled={busy || !text.trim() || !editor.isEditable}
          onClick={() => {
            if (insertDictation(editor, text, commands)) {
              setError('');
              setText('');
              setStatus(t('dictation.status.inserted'));
            } else
              setError(
                action?.kind !== 'text'
                  ? t('dictation.error.commandNotHere')
                  : t('dictation.error.placeCursor'),
              );
          }}
        >
          {t('dictation.insert')}
        </button>
        <button type="button" onClick={close}>
          {t('common:close')}
        </button>
      </div>
    </section>
  );
}
