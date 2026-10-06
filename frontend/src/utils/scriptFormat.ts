/**
 * Telling a treatment from a screenplay by its content.
 *
 * Local storage (desktop, iOS, Android) did not record a script's format until
 * the `format` column was added, so a treatment written there reopened in the
 * screenplay editor. Their content tells them apart: a treatment is prose — the
 * treatment editor's paragraphs, headings and lists — and a screenplay is
 * built only of screenplay elements, none of which share those node names.
 */

/** Top-level node types the treatment editor writes (TreatmentEditor.tsx). */
const TREATMENT_BLOCKS = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule',
]);

export function looksLikeTreatment(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const blocks = (content as { content?: unknown }).content;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  return blocks.every((b) => !!b && typeof b === 'object' && TREATMENT_BLOCKS.has(String((b as { type?: unknown }).type)));
}

/**
 * A stored format value, or the screenplay default. The web backend's default
 * is "json" — a leftover meaning "a screenplay stored as JSON" — so a script
 * from a web export arrives carrying it; it is a screenplay here.
 */
export function normalizeFormat(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  return v && v !== 'json' ? v : 'screenplay';
}
