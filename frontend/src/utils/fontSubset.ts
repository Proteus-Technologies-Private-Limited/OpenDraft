/**
 * Cutting a font down to the characters a document uses.
 *
 * jsPDF embeds whatever font bytes it is given, whole. For a bundled 70 kB face
 * that does not matter; for a Chinese, Japanese or Korean family it does — they
 * are 5–15 MB each, and a PDF carrying one for a script of a few hundred
 * characters is a PDF nobody wants to email. HarfBuzz's subsetter, the one
 * Chrome and Android use, keeps only the glyphs asked for and everything they
 * need to be drawn.
 *
 * It is a second WebAssembly module (harfbuzzjs/hb-subset.wasm), loaded on the
 * first export that wants it and kept. Anything that goes wrong — the module not
 * loading, a font it cannot read, an empty result — gives back null, and the
 * caller embeds the whole font as it always did: a bigger file is never a
 * reason to fail an export.
 */

interface SubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

let loading: Promise<SubsetExports | null> | null = null;

async function instantiate(): Promise<SubsetExports> {
  // As with hb.wasm (utils/textShaping): a bundled asset in the app, which has to
  // be fetched, and a file beside its package under Node, where the tests run.
  let bytes: ArrayBuffer;
  try {
    const { default: wasmUrl } = await import('harfbuzzjs/hb-subset.wasm?url');
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  } catch {
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises');
    const buffer = await readFile(new URL('../../node_modules/harfbuzzjs/hb-subset.wasm', import.meta.url));
    bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
  const { instance } = await WebAssembly.instantiate(bytes);
  return instance.exports as unknown as SubsetExports;
}

function loadSubsetter(): Promise<SubsetExports | null> {
  if (!loading) {
    loading = instantiate().catch((error: unknown) => {
      console.warn('[fontSubset] the subsetter could not be loaded; fonts will be embedded whole', error);
      loading = null;
      return null;
    });
  }
  return loading;
}

/** HB_SUBSET_FLAGS_NO_HINTING: hints only matter when a font is rasterised on screen. */
const NO_HINTING = 0x1;
const HB_MEMORY_MODE_WRITABLE = 2;

/**
 * A TrueType font reduced to `codePoints`, or null if that could not be done.
 *
 * The result is a complete font — cmap, glyf, hmtx and the rest — that jsPDF
 * reads like any other.
 */
export async function subsetFont(
  font: Uint8Array,
  codePoints: Iterable<number>,
): Promise<Uint8Array | null> {
  const wasm = await loadSubsetter();
  if (!wasm) return null;

  let fontPtr = 0;
  let face = 0;
  let input = 0;
  let subset = 0;
  let result = 0;
  try {
    fontPtr = wasm.malloc(font.byteLength);
    if (!fontPtr) return null;
    // Read the memory after the allocation, not before: malloc may have grown it,
    // and a view taken earlier would then point at a buffer that no longer exists.
    new Uint8Array(wasm.memory.buffer).set(font, fontPtr);

    const blob = wasm.hb_blob_create(fontPtr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    face = wasm.hb_face_create(blob, 0);
    wasm.hb_blob_destroy(blob);

    input = wasm.hb_subset_input_create_or_fail();
    if (!input) return null;
    const unicodes = wasm.hb_subset_input_unicode_set(input);
    for (const codePoint of codePoints) wasm.hb_set_add(unicodes, codePoint);
    wasm.hb_subset_input_set_flags(input, NO_HINTING);

    subset = wasm.hb_subset_or_fail(face, input);
    if (!subset) return null;
    result = wasm.hb_face_reference_blob(subset);
    const length = wasm.hb_blob_get_length(result);
    if (length === 0) return null;
    const offset = wasm.hb_blob_get_data(result, 0);
    // Copied out: the view is into wasm memory, which is freed below.
    return new Uint8Array(wasm.memory.buffer).slice(offset, offset + length);
  } catch (error) {
    console.warn('[fontSubset] could not subset a font; it will be embedded whole', error);
    return null;
  } finally {
    try {
      if (result) wasm.hb_blob_destroy(result);
      if (subset) wasm.hb_face_destroy(subset);
      if (input) wasm.hb_subset_input_destroy(input);
      if (face) wasm.hb_face_destroy(face);
      if (fontPtr) wasm.free(fontPtr);
    } catch {
      // Cleanup failing leaks a few kilobytes of wasm memory at worst.
    }
  }
}
