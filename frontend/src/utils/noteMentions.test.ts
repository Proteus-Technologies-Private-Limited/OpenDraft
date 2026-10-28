import { describe, it, expect } from 'vitest';
import { buildMentionSuggestions, insertSuggestion, mentionQueryAt } from './noteMentions';
import type { Asset } from '../stores/assetStore';

const asset = { id: 'a1', original_name: 'Jane mood board.png', mime_type: 'image/png', tags: [] } as unknown as Asset;

describe('@ suggestions in notes', () => {
  it('reads the word being typed after @', () => {
    expect(mentionQueryAt('ask @Ja', 7)).toBe('Ja');
    expect(mentionQueryAt('ask @', 5)).toBe('');
    expect(mentionQueryAt('ask Ja', 6)).toBeNull();
  });

  it('offers people before assets', () => {
    const s = buildMentionSuggestions('jane', ['Jane Doe', 'Ben'], [asset]);
    expect(s.map((x) => x.kind)).toEqual(['person', 'asset']);
  });

  it('inserts a person as one word and puts the caret after it', () => {
    const r = insertSuggestion('ask @Ja about it', 7, { kind: 'person', name: 'Jane Doe' });
    expect(r.value).toBe('ask @Jane_Doe  about it');
    expect(r.caret).toBe('ask @Jane_Doe '.length);
  });

  it('inserts an asset the way asset references were always written', () => {
    expect(insertSuggestion('@mood', 5, { kind: 'asset', asset }).value).toBe('@Jane_mood_board.png ');
  });
});
