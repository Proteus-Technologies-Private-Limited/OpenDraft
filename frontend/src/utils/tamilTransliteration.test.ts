import { describe, it, expect } from 'vitest';
import {
  transliterateToTamil,
  normalizeTamilPhonetics,
  getTamilSuggestions,
} from './tamilTransliteration';

describe('Tamil Transliteration Engine (Phase 1)', () => {
  it('transliterates basic vowels and words', () => {
    expect(transliterateToTamil('ammaa')).toBe('அம்மா');
    expect(transliterateToTamil('appaa')).toBe('அப்பா');
  });

  it('normalizes and transliterates common conversational words', () => {
    expect(normalizeTamilPhonetics('kaatchi')).toBe('kATchi');
    expect(transliterateToTamil('vanakkam')).toBe('வணக்கம்');
    expect(transliterateToTamil('nandri')).toBe('நன்றி');
    expect(transliterateToTamil('thamizh')).toBe('தமிழ்');
  });

  it('handles screenplay terms like kaatchi', () => {
    expect(transliterateToTamil('kaatchi')).toBe('காட்சி');
  });

  it('provides multiple suggestions for ambiguous input', () => {
    const suggestions = getTamilSuggestions('vanakkam');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions).toContain('வணக்கம்');
  });

  it('gracefully handles empty or non-transliterable input', () => {
    expect(transliterateToTamil('')).toBe('');
    expect(transliterateToTamil('   ')).toBe('   ');
  });
});
