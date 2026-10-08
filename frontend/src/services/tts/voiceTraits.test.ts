import { describe, it, expect } from 'vitest';
import { isNoveltyVoice, voiceGender } from './voiceTraits';

describe('voiceTraits', () => {
  it('knows the gender of common macOS and Windows voices', () => {
    expect(voiceGender('Samantha')).toBe('female');
    expect(voiceGender('Daniel (English (UK))')).toBe('male');
    expect(voiceGender('Microsoft Zira Desktop - English (United States)')).toBe('female');
    expect(voiceGender('Microsoft David - English (United States)')).toBe('male');
    expect(voiceGender('Somebody New')).toBeUndefined();
  });

  it('spots the novelty voices', () => {
    expect(isNoveltyVoice('Bubbles')).toBe(true);
    expect(isNoveltyVoice('Bad News')).toBe(true);
    expect(isNoveltyVoice('Zarvox')).toBe(true);
    expect(isNoveltyVoice('Samantha')).toBe(false);
    expect(isNoveltyVoice('Flo (English (US))')).toBe(false);
  });
});
