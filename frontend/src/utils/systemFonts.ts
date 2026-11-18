/**
 * Installed-font lookup for the PDF exporter (desktop app only).
 *
 * For a script the exporter bundles no font for, the desktop app can ask the
 * operating system for an installed font that covers the text. The Rust side
 * only returns single-face TrueType files, because that is all jsPDF can embed.
 *
 * Everywhere else — the browser, iOS, Android — there is nothing to ask, and
 * this resolves to null at once. Any failure also resolves to null: a missing
 * fallback font must never stop an export.
 */
import { isDesktopTauri } from '../services/platform';

/**
 * Bytes of an installed TrueType font that covers every visible character of
 * `text`, preferring the requested weight and slant, or null when there is
 * none (or this build cannot look).
 */
export async function systemFontForText(
  text: string,
  bold: boolean,
  italic: boolean,
): Promise<Uint8Array | null> {
  try {
    if (!isDesktopTauri()) return null;
    if (!text || !text.trim()) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<number[] | ArrayBuffer | Uint8Array | null>('system_font_for_text', {
      text,
      bold,
      italic,
    });
    if (result == null) return null;
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer | number[]);
    return bytes.length > 0 ? bytes : null;
  } catch (err) {
    console.warn('[systemFonts] system font lookup failed:', err);
    return null;
  }
}
