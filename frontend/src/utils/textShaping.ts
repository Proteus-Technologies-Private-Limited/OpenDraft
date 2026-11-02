/**
 * Shaping text with HarfBuzz, for the scripts that cannot be drawn without it.
 *
 * jsPDF paints one glyph per character, in the order the characters come. For
 * Latin that is all there is to it. For the Indic scripts it is not: the
 * letters a reader sees are produced by the font's OpenType tables — Tamil's
 * கு is one glyph that no character maps to, Hindi's क्ष another, and the vowel
 * sign typed after a consonant is drawn before it. A program that only reads
 * `cmap` draws the pieces instead, which a Tamil reader sees as gibberish.
 *
 * HarfBuzz is the shaping engine Chrome, Firefox, Android and LibreOffice use
 * to run those tables. Given a font and a string it returns the glyphs to draw
 * and where to draw each one; `pdfShapedText` then gets them onto the page.
 *
 * It is WebAssembly, loaded on the first export that needs it and kept. If it
 * cannot be loaded the export does not fail: the caller falls back to the
 * reordering in `utils/indic`, which is legible if not typeset.
 *
 * harfbuzzjs 0.x rather than 1.x on purpose: 1.x initialises with a top-level
 * await, which the es2019 legacy-macOS build cannot transpile.
 */
import type { HarfBuzz, HbFace, HbFont } from 'harfbuzzjs/hbjs.js';

/** One shaped glyph, in font units. */
export interface ShapedGlyph {
  /** Glyph id in the font that shaped it. */
  gid: number;
  /** UTF-16 offset of the first character of the cluster it came from. */
  cluster: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

/** A font ready to be shaped with. */
export interface ShapingFont {
  /** Font units per em — what every number in a ShapedGlyph is a fraction of. */
  upem: number;
  /**
   * Shape `text` in `script` (an ISO 15924 tag such as 'Taml'), left to right.
   * Throws if HarfBuzz does; callers fall back on a failure.
   */
  shape(text: string, script: string): ShapedGlyph[];
}

let loading: Promise<HarfBuzz | null> | null = null;

async function instantiate(): Promise<HarfBuzz> {
  const [{ default: createHarfBuzz }, { default: hbjs }] = await Promise.all([
    import('harfbuzzjs/hb.js'),
    import('harfbuzzjs/hbjs.js'),
  ]);

  // In the app the binary is a bundled asset and has to be fetched; handing
  // the bytes over keeps Emscripten from guessing at a path. Under Node — the
  // tests — there is nothing to fetch it from, and Emscripten finds the file
  // next to its own script instead.
  let wasmBinary: ArrayBuffer | undefined;
  try {
    const { default: wasmUrl } = await import('harfbuzzjs/hb.wasm?url');
    const response = await fetch(wasmUrl);
    if (response.ok) wasmBinary = await response.arrayBuffer();
  } catch {
    // Left to Emscripten's own lookup below.
  }

  const module = await createHarfBuzz(wasmBinary ? { wasmBinary } : undefined);
  return hbjs(module);
}

/**
 * HarfBuzz, loaded once per session, or null when it cannot be.
 *
 * A failure is not cached: a WebView that refused the module once (a memory
 * spike, a cancelled fetch) gets another try on the next export.
 */
export function loadHarfBuzz(): Promise<HarfBuzz | null> {
  if (!loading) {
    loading = instantiate().catch((error: unknown) => {
      console.warn('[textShaping] HarfBuzz could not be loaded; Indic text will be reordered but not shaped', error);
      loading = null;
      return null;
    });
  }
  return loading;
}

/** Shaping fonts already built, by the font bytes' cache key. */
const fonts = new Map<string, ShapingFont>();

/**
 * Build a shaping font from a TrueType file, or null if HarfBuzz is not
 * available. Kept by `key`, so a face used on every export is parsed once —
 * `bytes` is only called on the first.
 */
export async function shapingFont(key: string, bytes: () => Uint8Array): Promise<ShapingFont | null> {
  const known = fonts.get(key);
  if (known) return known;

  const hb = await loadHarfBuzz();
  if (!hb) return null;

  let face: HbFace;
  let font: HbFont;
  try {
    const blob = hb.createBlob(bytes());
    face = hb.createFace(blob, 0);
    font = hb.createFont(face);
    // The face and font hold their own references; the blob handle can go.
    blob.destroy();
  } catch (error) {
    console.warn(`[textShaping] could not load ${key} for shaping`, error);
    return null;
  }

  const shaping: ShapingFont = {
    upem: face.upem || 1000,
    shape(text: string, script: string): ShapedGlyph[] {
      const buffer = hb.createBuffer();
      try {
        buffer.addText(text);
        // Script and direction are set rather than guessed: a piece that opens
        // with a space or a digit would otherwise be guessed as Common, and
        // the Indic shaper would never run.
        buffer.setDirection('ltr');
        buffer.setScript(script);
        buffer.guessSegmentProperties(); // fills in the language only
        hb.shape(font, buffer);
        return buffer.json().map((glyph) => ({
          gid: glyph.g,
          cluster: glyph.cl,
          xAdvance: glyph.ax,
          xOffset: glyph.dx,
          yOffset: glyph.dy,
        }));
      } finally {
        buffer.destroy();
      }
    },
  };
  fonts.set(key, shaping);
  return shaping;
}
