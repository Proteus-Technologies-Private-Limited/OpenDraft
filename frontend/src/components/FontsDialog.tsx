import React, { useCallback, useEffect, useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation, Trans } from 'react-i18next';
import { t as tGlobal } from '../i18n';
import {
  installFontFiles, listCustomFonts, removeCustomFont, MAX_FONT_BYTES,
  type CustomFont, type FontSource,
} from '../services/customFonts';
import { pickFontFiles, FONT_FILE_EXTENSIONS } from '../utils/fileOps';
import { isMobileTauri } from '../services/platform';
import { addNamedFont, canQueryLocalFonts, detectDeviceFonts, requestLocalFonts } from '../utils/deviceFonts';
import { getAllFonts, fontStack } from '../utils/fonts';

interface Props {
  onClose: () => void;
}

// i18n-ignore-start: MB / KB are unit symbols
function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
// i18n-ignore-end

function describeStyle(font: CustomFont): string {
  const weight = font.weight === 400 ? '' : String(font.weight);
  const slant = font.italic ? tGlobal('format:fonts.italic') : '';
  return [font.subfamily || tGlobal('format:fonts.regular'), weight, slant].filter(Boolean).join(' · ');
}

/**
 * Where a writer adds their own fonts, and sees what this machine already has.
 *
 * The list here is only the fonts installed *into OpenDraft* — the ones whose
 * files we hold, and can therefore embed in an exported PDF. Faces belonging to
 * the operating system are counted, not listed: there can be hundreds, and they
 * are already in the picker.
 */
const FontsDialog: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation(['format', 'common']);
  const [fonts, setFonts] = useState<CustomFont[]>(() => listCustomFonts());
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [namedFont, setNamedFont] = useState('');

  const deviceCount = getAllFonts().filter((f) => f.source === 'device').length;
  // Nothing can be dragged onto an iPad or a phone, so the drop zone does not
  // pretend otherwise there — the button is the whole story on those.
  const canDrop = !isMobileTauri();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addFiles = useCallback(async (sources: FontSource[]) => {
    if (sources.length === 0) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await installFontFiles(sources);
      setFonts(listCustomFonts());
      setErrors(result.errors);
      if (result.installed.length > 0) {
        const families = [...new Set(result.installed.map((f) => f.family))];
        setStatus(t('fonts.added', { count: result.installed.length, families: families.join(', ') }));
      } else if (result.errors.length === 0) {
        setStatus(t('fonts.nothingToAdd'));
      }
    } catch (err) {
      setErrors([{ fileName: '', message: (err as Error)?.message || t('fonts.addFailed') }]);
    } finally {
      setBusy(false);
    }
  }, [t]);

  /** Read dropped `File` objects — the web and Tauri-desktop drop paths. */
  const addDroppedFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const sources: FontSource[] = [];
    const failures: { fileName: string; message: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        sources.push({ name: file.name, bytes: await file.arrayBuffer() });
      } catch (err) {
        failures.push({ fileName: file.name, message: t('fonts.readFailed', { error: (err as Error)?.message || String(err) }) });
      }
    }
    await addFiles(sources);
    if (failures.length > 0) setErrors((prev) => [...prev, ...failures]);
  }, [addFiles, t]);

  /**
   * Open the platform's own picker.
   *
   * Not a hidden `<input type="file">`: on desktop the webview gives one no
   * usable panel from a `tauri://` page, and on Android the bytes have to come
   * back through ContentResolver. `pickFontFiles` knows which is which.
   */
  const choose = useCallback(async () => {
    setBusy(true);
    setStatus('');
    try {
      const picked = await pickFontFiles();
      setBusy(false);
      await addFiles(picked);
    } catch (err) {
      setBusy(false);
      setErrors([{ fileName: '', message: t('fonts.pickerFailed', { error: (err as Error)?.message || String(err) }) }]);
    }
  }, [addFiles, t]);

  // On desktop Tauri the webview swallows OS file drops, so the browser's drop
  // event carries no files — only paths, forwarded from the editor's native
  // listener (see ScreenplayEditor). Read them and install them the same way.
  useEffect(() => {
    const handler = async (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[] | undefined;
      if (!paths || paths.length === 0) return;
      setBusy(true);
      setDragging(false);
      const failures: { fileName: string; message: string }[] = [];
      const files: FontSource[] = [];
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        for (const path of paths) {
          const fileName = path.replace(/^.*[\\/]/, '') || 'font';
          try {
            const data = await invoke<number[]>('read_binary_file', { path });
            files.push({ name: fileName, bytes: new Uint8Array(data).buffer });
          } catch (err) {
            failures.push({ fileName, message: t('fonts.readFailed', { error: (err as Error)?.message || String(err) }) });
          }
        }
      } catch (err) {
        failures.push({ fileName: '', message: t('fonts.dropReadFailed', { error: (err as Error)?.message || String(err) }) });
      } finally {
        setBusy(false);
      }
      // addFiles replaces the error list with its own, so unreadable paths are
      // added afterwards rather than being wiped by it.
      if (files.length > 0) await addFiles(files);
      if (failures.length > 0) setErrors((prev) => [...prev, ...failures]);
    };
    window.addEventListener('tauri-font-drop', handler);
    return () => window.removeEventListener('tauri-font-drop', handler);
  }, [addFiles, t]);

  const handleRemove = useCallback(async (font: CustomFont) => {
    setBusy(true);
    try {
      await removeCustomFont(font.id);
      setStatus(t('fonts.removed', { name: font.family }));
      setErrors([]);
    } catch (err) {
      setErrors([{ fileName: font.fileName, message: (err as Error)?.message || t('fonts.removeFailed') }]);
    } finally {
      setFonts(listCustomFonts());
      setBusy(false);
    }
  }, [t]);

  const handleScanDevice = useCallback(async () => {
    setBusy(true);
    setErrors([]);
    try {
      const added = await requestLocalFonts();
      setStatus(t('fonts.found', { count: added }));
    } catch (err) {
      setErrors([{ fileName: '', message: (err as Error)?.message || t('fonts.scanFailed') }]);
    } finally {
      setBusy(false);
    }
  }, [t]);

  /**
   * Add a font this device has but nothing could enumerate.
   *
   * iPadOS and Android have no equivalent of `queryLocalFonts`, so a font
   * installed through a font-manager app or a configuration profile is
   * invisible to us — but it is not unusable, and the writer knows its name.
   */
  const handleAddNamed = useCallback(() => {
    const name = namedFont.trim();
    if (!name) return;
    setErrors([]);
    if (addNamedFont(name)) {
      setStatus(t('fonts.namedAdded', { name }));
      setNamedFont('');
    } else {
      setErrors([{
        fileName: '',
        message: t('fonts.namedFailed', { name }),
      }]);
    }
  }, [namedFont, t]);

  const handleProbeDevice = useCallback(() => {
    // Detection normally runs at startup, so this usually just reports what it
    // already found rather than finding anything new.
    detectDeviceFonts();
    const count = getAllFonts().filter((f) => f.source === 'device').length;
    setStatus(count > 0
      ? t('fonts.probeFound', { count })
      : t('fonts.probeNone'));
  }, [t]);

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div className="tp-editor-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="dialog-header">{t('fonts.title')}</div>
        <div className="tp-editor-body" style={{ display: 'block', padding: 20 }}>

          <p className="fonts-dialog-intro">
            <Trans ns="format" i18nKey="fonts.intro" components={{ code: <code /> }} />
          </p>

          <div
            className={`fonts-dropzone${dragging ? ' is-dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addDroppedFiles(e.dataTransfer?.files ?? null);
            }}
          >
            {canDrop && <p>{t('fonts.dropHere')}</p>}
            <button
              type="button"
              className="dialog-primary"
              disabled={busy}
              onClick={() => void choose()}
            >
              {t('fonts.chooseFiles')}
            </button>
            <p className="fonts-dropzone-hint">
              {t('fonts.fileHint', {
                extensions: FONT_FILE_EXTENSIONS.map((e) => e.toUpperCase()).join(', '),
                size: Math.round(MAX_FONT_BYTES / 1024 / 1024),
              })}
            </p>
          </div>

          {status && <p className="fonts-dialog-status">{status}</p>}
          {errors.length > 0 && (
            <ul className="fonts-dialog-errors">
              {errors.map((err, i) => (
                <li key={`${err.fileName}-${i}`}>
                  {err.fileName ? <strong>{err.fileName}: </strong> : null}{err.message}
                </li>
              ))}
            </ul>
          )}

          <h4 className="fonts-dialog-heading">{t('fonts.yourFonts')}</h4>
          {fonts.length === 0 ? (
            <p className="fonts-dialog-empty">{t('fonts.noCustom')}</p>
          ) : (
            <ul className="fonts-list">
              {fonts.map((font) => (
                <li key={font.id} className="fonts-list-row">
                  <span className="fonts-list-sample" style={{ fontFamily: fontStack(font.family) }}>
                    {font.family}
                  </span>
                  <span className="fonts-list-meta">
                    {describeStyle(font)} · {font.fileName} · {describeSize(font.size)}
                  </span>
                  <button
                    type="button"
                    className="fonts-list-remove"
                    disabled={busy}
                    onClick={() => void handleRemove(font)}
                    title={t('fonts.removeTitle', { name: font.family })}
                  >
                    {t('common:remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h4 className="fonts-dialog-heading">{t('fonts.onDevice')}</h4>
          <p className="fonts-dialog-empty">
            {deviceCount > 0
              ? t('fonts.deviceCount', { count: deviceCount })
              : t('fonts.deviceHint')}
          </p>
          {canQueryLocalFonts() ? (
            <button type="button" disabled={busy} onClick={() => void handleScanDevice()}>
              {t('fonts.listAll')}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={handleProbeDevice}>
              {t('fonts.lookFor')}
            </button>
          )}

          {!canQueryLocalFonts() && (
            <div className="fonts-named-row">
              <p className="fonts-dialog-empty">
                {t('fonts.namedHelp')}
              </p>
              <div className="fonts-named-input-row">
                <input
                  className="props-input"
                  type="text"
                  placeholder={t('fonts.namedPlaceholder')}
                  value={namedFont}
                  onChange={(e) => setNamedFont(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNamed(); } }}
                  aria-label={t('fonts.namedLabel')}
                />
                <button type="button" disabled={busy || !namedFont.trim()} onClick={handleAddNamed}>
                  {t('fonts.addByName')}
                </button>
              </div>
            </div>
          )}

          <p className="fonts-dialog-note">
            {t('fonts.note')}
          </p>
        </div>
        <div className="dialog-actions">
          <button className="dialog-primary" onClick={onClose}>{t('common:done')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default FontsDialog;
