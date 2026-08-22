import React, { useCallback, useEffect, useState } from 'react';
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

function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function describeStyle(font: CustomFont): string {
  const weight = font.weight === 400 ? '' : String(font.weight);
  const slant = font.italic ? 'Italic' : '';
  return [font.subfamily || 'Regular', weight, slant].filter(Boolean).join(' · ');
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
        setStatus(`Added ${result.installed.length} font file${result.installed.length === 1 ? '' : 's'} — ${families.join(', ')}.`);
      } else if (result.errors.length === 0) {
        setStatus('Nothing to add.');
      }
    } catch (err) {
      setErrors([{ fileName: '', message: (err as Error)?.message || 'Could not add those fonts.' }]);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Read dropped `File` objects — the web and Tauri-desktop drop paths. */
  const addDroppedFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const sources: FontSource[] = [];
    const failures: { fileName: string; message: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        sources.push({ name: file.name, bytes: await file.arrayBuffer() });
      } catch (err) {
        failures.push({ fileName: file.name, message: `Could not read that file: ${(err as Error)?.message || String(err)}` });
      }
    }
    await addFiles(sources);
    if (failures.length > 0) setErrors((prev) => [...prev, ...failures]);
  }, [addFiles]);

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
      setErrors([{ fileName: '', message: `Could not open the font picker: ${(err as Error)?.message || String(err)}` }]);
    }
  }, [addFiles]);

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
            failures.push({ fileName, message: `Could not read that file: ${(err as Error)?.message || String(err)}` });
          }
        }
      } catch (err) {
        failures.push({ fileName: '', message: `Could not read the dropped files: ${(err as Error)?.message || String(err)}` });
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
  }, [addFiles]);

  const handleRemove = useCallback(async (font: CustomFont) => {
    setBusy(true);
    try {
      await removeCustomFont(font.id);
      setStatus(`Removed ${font.family}.`);
      setErrors([]);
    } catch (err) {
      setErrors([{ fileName: font.fileName, message: (err as Error)?.message || 'Could not remove that font.' }]);
    } finally {
      setFonts(listCustomFonts());
      setBusy(false);
    }
  }, []);

  const handleScanDevice = useCallback(async () => {
    setBusy(true);
    setErrors([]);
    try {
      const added = await requestLocalFonts();
      setStatus(`Found ${added} font${added === 1 ? '' : 's'} installed on this device. They are now in the font list.`);
    } catch (err) {
      setErrors([{ fileName: '', message: (err as Error)?.message || 'Could not read installed fonts.' }]);
    } finally {
      setBusy(false);
    }
  }, []);

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
      setStatus(`“${name}” is available on this device and has been added to the font list.`);
      setNamedFont('');
    } else {
      setErrors([{
        fileName: '',
        message: `This device cannot render a font called “${name}”. Check the spelling against the name the font itself uses, or add its file above.`,
      }]);
    }
  }, [namedFont]);

  const handleProbeDevice = useCallback(() => {
    // Detection normally runs at startup, so this usually just reports what it
    // already found rather than finding anything new.
    detectDeviceFonts();
    const count = getAllFonts().filter((f) => f.source === 'device').length;
    setStatus(count > 0
      ? `${count} font${count === 1 ? '' : 's'} on this device are available in the picker.`
      : 'No fonts beyond the built-in library were found on this device.');
  }, []);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="tp-editor-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="dialog-header">Fonts</div>
        <div className="tp-editor-body" style={{ display: 'block', padding: 20 }}>

          <p className="fonts-dialog-intro">
            OpenDraft comes with a full library of screenplay, serif, sans-serif, monospaced and
            display fonts. Add your own TrueType (<code>.ttf</code>) or OpenType (<code>.otf</code>)
            files here to use them anywhere in a script, and in exported PDFs.
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
            {canDrop && <p>Drop font files here</p>}
            <button
              type="button"
              className="dialog-primary"
              disabled={busy}
              onClick={() => void choose()}
            >
              Choose Font Files…
            </button>
            <p className="fonts-dropzone-hint">
              {FONT_FILE_EXTENSIONS.map((e) => e.toUpperCase()).join(', ')}, up to
              {' '}{Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB each.
              Add each weight as its own file to get real bold and italic.
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

          <h4 className="fonts-dialog-heading">Your fonts</h4>
          {fonts.length === 0 ? (
            <p className="fonts-dialog-empty">No custom fonts installed yet.</p>
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
                    title={`Remove ${font.family}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h4 className="fonts-dialog-heading">Fonts on this device</h4>
          <p className="fonts-dialog-empty">
            {deviceCount > 0
              ? `${deviceCount} font${deviceCount === 1 ? '' : 's'} installed on this device are available in the picker.`
              : 'Fonts installed on this device can be used as well as the built-in library.'}
          </p>
          {canQueryLocalFonts() ? (
            <button type="button" disabled={busy} onClick={() => void handleScanDevice()}>
              List All Installed Fonts…
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={handleProbeDevice}>
              Look for Installed Fonts
            </button>
          )}

          {!canQueryLocalFonts() && (
            <div className="fonts-named-row">
              <p className="fonts-dialog-empty">
                This platform will not list its fonts, so OpenDraft looks for the ones it knows
                about. If you have another font installed — through a font app or a profile —
                type its name and it will be added if this device can render it.
              </p>
              <div className="fonts-named-input-row">
                <input
                  className="props-input"
                  type="text"
                  placeholder="e.g. Avenir Next Condensed"
                  value={namedFont}
                  onChange={(e) => setNamedFont(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNamed(); } }}
                  aria-label="Font name"
                />
                <button type="button" disabled={busy || !namedFont.trim()} onClick={handleAddNamed}>
                  Add by Name
                </button>
              </div>
            </div>
          )}

          <p className="fonts-dialog-note">
            A script records the name of the font it was written in, so it keeps that choice
            when you open it on another device. Where the font isn&apos;t installed there,
            OpenDraft substitutes the closest match of the same kind — a typewriter face for a
            typewriter face, a serif for a serif — and the original name is restored as soon as
            the script is opened somewhere the font exists.
          </p>
        </div>
        <div className="dialog-actions">
          <button className="dialog-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default FontsDialog;
