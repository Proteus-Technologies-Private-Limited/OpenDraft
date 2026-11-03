import { describe, it, expect } from 'vitest';
import { adjacentSuggestion, filterSuggestions, formattingDescription } from './suggestionReview';
import type { Suggestion } from './suggestions';
const all: Suggestion[] = [
  { id: 'a', by: 'Ann', at: 1, kinds: ['insert'], inserted: 'new', deleted: '', pos: 1 },
  {
    id: 'b',
    by: 'Bob',
    at: 2,
    kinds: ['format'],
    inserted: '',
    deleted: '',
    formatted: 'one',
    formats: [{ format: 'bold', before: false, after: true }],
    pos: 5,
  },
  { id: 'c', by: 'Ann', at: 3, kinds: ['type'], inserted: '', deleted: '', pos: 9 },
];
describe('review navigation and filters', () => {
  it('combines author and change-type filters', () => {
    expect(filterSuggestions(all, 'Ann', 'format')).toEqual([]);
    expect(filterSuggestions(all, '', 'format').map((s) => s.id)).toEqual(['b']);
    expect(filterSuggestions(all, 'Ann', 'all').map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterSuggestions(all, '', 'structure').map((s) => s.id)).toEqual(['c']);
  });
  it('wraps in both directions and uses the caret when no change is selected', () => {
    expect(adjacentSuggestion(all, 'c', 9, 1)?.id).toBe('a');
    expect(adjacentSuggestion(all, 'a', 1, -1)?.id).toBe('c');
    expect(adjacentSuggestion(all, null, 3, 1)?.id).toBe('b');
    expect(adjacentSuggestion(all, null, 7, -1)?.id).toBe('b');
    expect(adjacentSuggestion([], null, 1, 1)).toBeNull();
  });
  it('navigation stays in the filtered set when the selected change disappears', () => {
    const shown = filterSuggestions(all, 'Ann', 'all');
    expect(adjacentSuggestion(shown, 'b', 5, 1)?.id).toBe('c');
    expect(adjacentSuggestion(shown, 'b', 5, -1)?.id).toBe('a');
  });
  it('describes the actual proposed action and affected text', () => {
    expect(formattingDescription(all[1])).toBe('Add bold on “one”');
    expect(
      formattingDescription({
        ...all[1],
        formats: [{ format: 'strike', before: true, after: false }],
      }),
    ).toBe('Remove strikethrough on “one”');
  });
});
