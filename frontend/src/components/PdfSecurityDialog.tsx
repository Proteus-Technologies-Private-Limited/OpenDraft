/**
 * File → Export → PDF with Watermark or Password…
 *
 * A script going out to readers carries a watermark — CONFIDENTIAL, or the
 * name of the person it was sent to, so a leaked copy says whose it was — and
 * can be locked with a password and against printing or copying.
 *
 * Given a list of recipients it writes one copy per name, each watermarked
 * with that name, and saves them together as a .zip.
 */
import React, { useState } from 'react';
import { watermarkFor, type PdfSecurity, type PdfWatermark } from '../utils/pdfExporter';

export interface PdfSecurityRequest {
  /** One watermark per copy; a single entry for a single file. */
  copies: Array<{ watermark: PdfWatermark | null; recipient: string | null }>;
  security: PdfSecurity | null;
}

interface Props {
  /** Render and save; resolves once saved, rejects with the reason. */
  onExport: (request: PdfSecurityRequest) => Promise<void>;
  onClose: () => void;
}

/** The writer's watermark choices, remembered between exports. Never the passwords. */
const PREFS_KEY = 'opendraft:pdfWatermarkPrefs';

interface Prefs {
  text: string;
  style: 'diagonal' | 'footer';
  opacity: number;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { text: 'CONFIDENTIAL', style: 'diagonal', opacity: 15 };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      text: typeof p.text === 'string' ? p.text : fallback.text,
      style: p.style === 'footer' ? 'footer' : 'diagonal',
      opacity: typeof p.opacity === 'number' ? Math.min(60, Math.max(5, p.opacity)) : fallback.opacity,
    };
  } catch {
    return fallback;
  }
}

const PdfSecurityDialog: React.FC<Props> = ({ onExport, onClose }) => {
  const initial = loadPrefs();
  const [text, setText] = useState(initial.text);
  const [style, setStyle] = useState<'diagonal' | 'footer'>(initial.style);
  const [opacity, setOpacity] = useState(initial.opacity);
  const [recipients, setRecipients] = useState('');
  const [password, setPassword] = useState('');
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = recipients.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
  const nothingToDo = !text.trim() && names.length === 0 && !password && allowPrinting && allowCopying;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ text, style, opacity }));
    } catch { /* a preference that cannot be saved is not worth failing the export */ }
    const watermarkOf = (recipient: string | null): PdfWatermark | null => {
      const t = watermarkFor(text, recipient);
      return t ? { text: t, style, opacity: opacity / 100 } : null;
    };
    const copies = names.length > 0
      ? names.map((name) => ({ watermark: watermarkOf(name), recipient: name }))
      : [{ watermark: watermarkOf(null), recipient: null }];
    const security: PdfSecurity | null = password || !allowPrinting || !allowCopying
      ? { userPassword: password || undefined, allowPrinting, allowCopying }
      : null;
    try {
      await onExport({ copies, security });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box pdf-security-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-security-title"
      >
        <div className="dialog-header" id="pdf-security-title">PDF with Watermark or Password</div>
        <div className="dialog-body">
          <div className="revision-settings-subhead">Watermark</div>
          <label className="pdf-security-field">
            <span>Text</span>
            <input
              type="text"
              value={text}
              placeholder="e.g. CONFIDENTIAL, or {recipient}"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="pdf-security-inline" role="radiogroup" aria-label="Watermark placement">
            <label><input type="radio" checked={style === 'diagonal'} onChange={() => setStyle('diagonal')} /> Across the page</label>
            <label><input type="radio" checked={style === 'footer'} onChange={() => setStyle('footer')} /> At the foot of the page</label>
          </div>
          <label className="pdf-security-field">
            <span>Strength {opacity}%</span>
            <input type="range" min={5} max={60} step={5} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>

          <div className="revision-settings-subhead">One copy per recipient</div>
          <p className="revision-settings-help">
            One name per line. Each copy is watermarked with its name — put {'{recipient}'} in the text to place it — and all of them are saved together in a .zip.
          </p>
          <textarea
            className="pdf-security-recipients"
            rows={4}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            aria-label="Recipients, one per line"
            placeholder={'Jane Producer\nSam Director'}
          />

          <div className="revision-settings-subhead">Protection</div>
          <label className="pdf-security-field">
            <span>Password to open</span>
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder="None"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="revision-settings-check">
            <input type="checkbox" checked={allowPrinting} onChange={(e) => setAllowPrinting(e.target.checked)} />
            <span>Allow printing</span>
          </label>
          <label className="revision-settings-check">
            <input type="checkbox" checked={allowCopying} onChange={(e) => setAllowCopying(e.target.checked)} />
            <span>Allow copying text</span>
          </label>
          <p className="revision-settings-help">
            PDF restrictions keep honest readers honest; they use the PDF standard&rsquo;s basic encryption, which determined software can remove. The watermark is what identifies a leaked copy.
          </p>
          {error && <p className="revision-settings-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={() => { void run(); }} disabled={busy || nothingToDo}>
            {busy ? 'Exporting…' : names.length > 1 ? `Export ${names.length} PDFs…` : 'Export PDF…'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PdfSecurityDialog;
