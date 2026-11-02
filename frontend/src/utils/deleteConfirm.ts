/**
 * Type-the-name confirmation for deleting a script.
 *
 * The point is a deliberate act, not a spelling test. A phone keyboard
 * capitalises the first letter and may add a trailing space; a Mac turns "-"
 * into "–" and "'" into "’" as you type. None of that makes the writer any
 * less sure, so none of it should keep the Delete button greyed out.
 */

const DASHES = /[‐-―−﹘﹣－]/g;
const SINGLE_QUOTES = /[‘’‚‛′＇]/g;
const DOUBLE_QUOTES = /[“”„‟″＂]/g;

/** What a name is compared as: same letters, ignoring case, spacing and
 *  typographic dashes or quotes. */
export function normalizeConfirmName(value: string): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

/** The name the writer is asked to type. A script with no title is shown, and
 *  confirmed, as "Untitled" so the box can never match an empty string. */
export function confirmTargetName(title: string): string {
  const t = String(title ?? '').trim();
  return t || 'Untitled';
}

/** True when what was typed confirms deleting `title`. */
export function confirmNameMatches(typed: string, title: string): boolean {
  const target = normalizeConfirmName(confirmTargetName(title));
  return target.length > 0 && normalizeConfirmName(typed) === target;
}
