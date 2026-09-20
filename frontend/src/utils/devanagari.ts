/**
 * Devanagari's share of the Indic reordering.
 *
 * The algorithm this used to hold moved to `utils/indic.ts` when nine more
 * scripts turned out to need exactly the same walk over a syllable — the
 * scripts differ only in where their letters sit in Unicode, which is what
 * `IndicScript` holds. That module's header explains what the reordering is
 * for and what it deliberately does not do.
 *
 * These two names stay because Devanagari is where this started and its tests
 * are the closest reading of the algorithm anyone has written down; pointing
 * them at the shared engine keeps them guarding every script that now uses it.
 */
import { DEVANAGARI, hasScript, reorderIndic } from './indic';

/** Whether there is any Devanagari in `text`. */
export function hasDevanagari(text: string): boolean {
  return hasScript(text, DEVANAGARI);
}

/**
 * Reorder `text` for a renderer that paints characters where it finds them.
 *
 * Returns the input unchanged when there is no Devanagari in it, and always
 * returns the same characters — only their order can differ.
 */
export function reorderDevanagari(text: string): string {
  return reorderIndic(text, DEVANAGARI);
}
