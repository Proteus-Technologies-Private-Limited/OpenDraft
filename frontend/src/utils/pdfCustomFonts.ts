/**
 * Putting the writer's own fonts into an exported PDF.
 *
 * jsPDF draws in the PDF Standard 14 — Courier, Times, Helvetica — so every
 * other family is normally approximated by whichever of those is closest. For a
 * Google-hosted webfont there is nothing to be done about that; the bytes were
 * never ours. For a font the writer installed there is: we hold the file, so it
 * can be embedded, and a title page set in it comes out of the PDF looking like
 * the one on screen.
 *
 * Only the styles a family actually has are embedded, and a style it hasn't got
 * falls back to the nearest one it has rather than being left undefined — a
 * bold line in a regular-only family is still that family, as it is on screen.
 */
import type jsPDF from 'jspdf';
import { getCustomFontBytes, isCustomFamily } from '../services/customFonts';
import type { FontStyle } from './pdfUnicodeFont';

/** A family that is in the document, keyed for lookup while drawing. */
export interface EmbeddedFace {
  /** The jsPDF font id — also the /BaseFont a reader will show. */
  id: string;
}

const STYLES: { style: FontStyle; bold: boolean; italic: boolean }[] = [
  { style: 'normal', bold: false, italic: false },
  { style: 'bold', bold: true, italic: false },
  { style: 'italic', bold: false, italic: true },
  { style: 'bolditalic', bold: true, italic: true },
];

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // a whole font at once overflows the argument stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** jsPDF writes the id into the PDF, so keep it to characters a name can hold. */
function fontId(family: string): string {
  return family.replace(/[^A-Za-z0-9]+/g, '') || 'CustomFont';
}

/**
 * Embed every named family that turns out to be one of the writer's own.
 *
 * Returns a lookup from lowercased family name to the face to draw in; families
 * that aren't installed here are simply absent, and the caller falls back to the
 * built-in faces exactly as before. An embedding that fails is logged and left
 * out for the same reason — a broken font must not cost the writer the export.
 */
export function embedCustomFonts(pdf: jsPDF, families: Iterable<string>): Map<string, EmbeddedFace> {
  const embedded = new Map<string, EmbeddedFace>();
  const seen = new Set<string>();

  for (const family of families) {
    const name = (family || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isCustomFamily(name)) continue;

    try {
      const id = fontId(name);
      let any = false;
      for (const { style, bold, italic } of STYLES) {
        const bytes = getCustomFontBytes(name, { bold, italic });
        if (!bytes) continue;
        const vfsName = `${id}-${style}.ttf`;
        pdf.addFileToVFS(vfsName, toBase64(new Uint8Array(bytes)));
        pdf.addFont(vfsName, id, style);
        any = true;
      }
      if (any) embedded.set(key, { id });
    } catch (err) {
      console.warn(`[pdf] "${name}" could not be embedded; falling back to a built-in face:`, err);
    }
  }
  return embedded;
}
