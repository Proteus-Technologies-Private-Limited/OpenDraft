/**
 * Typing `@` in a note offers collaborators to mention and project assets to
 * reference. Both are written as one `@word` — spaces become underscores — so
 * the note text stays plain and the panel resolves the word when it draws it.
 */
import type { Asset } from '../stores/assetStore';
import { mentionToken } from './noteThreads';

export type MentionSuggestion =
  | { kind: 'person'; name: string }
  | { kind: 'asset'; asset: Asset };

/** What a suggestion inserts into the text. */
export function suggestionText(s: MentionSuggestion): string {
  return s.kind === 'person' ? mentionToken(s.name) : `@${s.asset.original_name.replace(/\s+/g, '_')}`;
}

/** People first — they are who a comment is for — then matching assets. */
export function buildMentionSuggestions(query: string, people: string[], assets: Asset[]): MentionSuggestion[] {
  const q = query.toLowerCase();
  const matches = (name: string) =>
    name.toLowerCase().includes(q) || name.replace(/\s+/g, '_').toLowerCase().includes(q);
  return [
    ...people.filter(matches).map((name): MentionSuggestion => ({ kind: 'person', name })),
    ...assets.filter((a) => matches(a.original_name)).map((asset): MentionSuggestion => ({ kind: 'asset', asset })),
  ].slice(0, 8);
}

/** The `@word` being typed just before the caret, if any. */
export function mentionQueryAt(value: string, caret: number): string | null {
  const m = value.slice(0, caret).match(/@(\S*)$/);
  return m ? m[1] : null;
}

/** Replace the `@word` before the caret with a suggestion; returns the new text and caret. */
export function insertSuggestion(value: string, caret: number, s: MentionSuggestion): { value: string; caret: number } {
  const before = value.slice(0, caret);
  const m = before.match(/@(\S*)$/);
  if (!m) return { value, caret };
  const prefix = before.slice(0, before.length - m[0].length);
  const text = `${suggestionText(s)} `;
  return { value: prefix + text + value.slice(caret), caret: prefix.length + text.length };
}
