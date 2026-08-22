import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  installFontFiles, listCustomFonts, removeCustomFont, MAX_FONT_BYTES,
  type CustomFont,
} from '../services/customFonts';
import { canQueryLocalFonts, detectDeviceFonts, requestLocalFonts } from '../utils/deviceFonts';
import { getAllFonts, fontStack } from '../utils/fonts';

interface Props {
  onClose: () => void;
}

const ACCEPT = '.ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

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
  const inputRef = useRef<HTMLInputElement>(null);

  const deviceCount = getAllFonts().filter((f) => f.source === 'device').length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await installFontFiles(files);
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
      if (inputRef.current) inputRef.current.value = '';
    }
  }, []);

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
      const files: File[] = [];
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        for (const path of paths) {
          const fileName = path.replace(/^.*[\\/]/, '') || 'font';
          try {
            const data = await invoke<number[]>('read_binary_file', { path });
            files.push(new File([new Uint8Array(data)] as BlobPart[], fileName));
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
              void addFiles(e.dataTransfer?.files ?? null);
            }}
          >
            <p>Drop font files here</p>
            <button
              type="button"
              className="dialog-primary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Choose Font Files…
            </button>
            <p className="fonts-dropzone-hint">
              TTF, OTF, WOFF and WOFF2, up to {Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB each.
              Add each weight as its own file to get real bold and italic.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void addFiles(e.target.files)}
            />
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
