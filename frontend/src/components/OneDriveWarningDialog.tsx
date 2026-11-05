/**
 * Warns the user when OpenDraft's app data folder is under OneDrive sync.
 *
 * OneDrive grabs SQLite WAL/journal files mid-write, which on Windows
 * causes silent save failures. This dialog runs at startup once we've
 * resolved the app data path, lets the user dismiss permanently, and
 * points them at a fix.
 */

import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { isDesktopTauri } from '../services/platform';

const DISMISS_KEY = 'opendraft.oneDriveWarning.dismissed';

const OneDriveWarningDialog: React.FC = () => {
  const { t } = useTranslation(['dialogs', 'common']);
  const [show, setShow] = useState(false);
  const [path, setPath] = useState<string>('');

  useEffect(() => {
    if (!isDesktopTauri()) return;
    if (typeof navigator === 'undefined' || !/Windows/i.test(navigator.userAgent)) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    let cancelled = false;
    (async () => {
      try {
        const { collectDiagnostics } = await import('../services/diagnostics');
        const r = await collectDiagnostics();
        if (cancelled) return;
        if (r.oneDriveSuspect && r.appDataDir) {
          setPath(r.appDataDir);
          setShow(true);
        }
      } catch {
        // Diagnostics failure is harmless — never block startup.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const dismiss = () => setShow(false);
  const dismissForever = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div className="dialog-overlay" onClick={dismiss}>
      <div
        className="dialog-box"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="dialog-header">{t('oneDrive.title')}</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>
            <Trans ns="dialogs" i18nKey="oneDrive.intro" components={{ strong: <strong /> }} />
          </p>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--fd-text-muted)' }}>
            {t('oneDrive.affectedFolder')}
          </p>
          <pre
            style={{
              margin: '0 0 12px',
              padding: '8px 10px',
              fontSize: 12,
              background: '#f4f4f4',
              color: '#1a1a1a',
              border: '1px solid #ddd',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {path}
          </pre>
          <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{t('oneDrive.howToFix')}</p>
          <ol style={{ margin: '0 0 0 18px', paddingLeft: 0, fontSize: 13, lineHeight: 1.6 }}>
            <li>{t('oneDrive.step1')}</li>
            <li>{t('oneDrive.step2')}</li>
            <li>{t('oneDrive.step3')}</li>
          </ol>
        </div>
        <div className="dialog-footer" style={{ display: 'flex', gap: 8 }}>
          <button className="dialog-btn" onClick={dismissForever}>
            {t('oneDrive.dontShowAgain')}
          </button>
          <div style={{ flex: 1 }} />
          <button className="dialog-btn dialog-btn-primary" onClick={dismiss} autoFocus>
            {t('common:continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OneDriveWarningDialog;
