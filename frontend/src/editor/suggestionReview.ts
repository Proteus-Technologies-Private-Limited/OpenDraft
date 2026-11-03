import type { Suggestion, SuggestedFormat } from './suggestions';
export type ReviewFilter = 'all' | 'text' | 'format' | 'structure';
export const FORMAT_LABELS: Record<SuggestedFormat, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  subscript: 'subscript',
  superscript: 'superscript',
};
export function filterSuggestions(
  all: Suggestion[],
  author: string,
  kind: ReviewFilter,
): Suggestion[] {
  return all.filter(
    (s) =>
      (!author || s.by === author) &&
      (kind === 'all' ||
        s.kinds.some((k) =>
          kind === 'text'
            ? k === 'insert' || k === 'delete'
            : kind === 'format'
              ? k === 'format'
              : k === 'split' || k === 'join' || k === 'type',
        )),
  );
}
/** Previous/next wrap within the filtered list, starting at the current change or caret. */
export function adjacentSuggestion(
  shown: Suggestion[],
  currentId: string | null,
  pos: number,
  direction: 1 | -1,
): Suggestion | null {
  if (!shown.length) return null;
  const at = shown.findIndex((s) => s.id === currentId);
  if (at >= 0) return shown[(at + direction + shown.length) % shown.length];
  return (
    (direction === 1
      ? shown.find((s) => s.pos >= pos)
      : [...shown].reverse().find((s) => s.pos <= pos)) ??
    (direction === 1 ? shown[0] : shown[shown.length - 1])
  );
}
export function formattingDescription(s: Suggestion): string {
  if (!s.kinds.includes('format')) return '';
  const changes = (s.formats ?? []).map(
    (f) => `${f.after ? 'Add' : 'Remove'} ${FORMAT_LABELS[f.format]}`,
  );
  return `${changes.join(', ')}${s.formatted ? ` on “${s.formatted.replace(/\n/g, ' ').trim()}”` : ''}`;
}
