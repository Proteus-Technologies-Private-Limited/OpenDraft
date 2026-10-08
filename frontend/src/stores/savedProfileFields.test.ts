import { describe, it, expect } from 'vitest';
import { savedProfileFields } from './editorStore';

describe('savedProfileFields', () => {
  it('keeps the Table Read voice when a saved script is opened (issue #131)', () => {
    const saved = JSON.parse(JSON.stringify({
      name: 'SARAH', description: 'A detective', color: '#8b5cf6', highlighted: true, gender: 'Female',
      age: '30s', role: 'Lead', backstory: '', arc: '', speechPattern: 'Clipped', vocabulary: '',
      verbalTics: '', sampleDialogue: '', images: ['a1'],
      voice: { system: 'com.apple.voice.compact.en-US.Samantha', ai: 'openai:nova' },
    }));
    const fields = savedProfileFields(saved);
    expect(fields.voice).toEqual({ system: 'com.apple.voice.compact.en-US.Samantha', ai: 'openai:nova' });
    expect(fields.highlighted).toBe(true);
    expect(fields.images).toEqual(['a1']);
    expect(fields.speechPattern).toBe('Clipped');
  });

  it('leaves the voice out of profiles written before Table Read, and of malformed ones', () => {
    expect(savedProfileFields({ name: 'A' }).voice).toBeUndefined();
    expect(savedProfileFields({ name: 'A', voice: 'Samantha' }).voice).toBeUndefined();
    expect(savedProfileFields({ name: 'A', voice: { system: 3, ai: '' } }).voice).toBeUndefined();
    expect(savedProfileFields({ name: 'A', voice: { ai: 'gemini:Kore' } }).voice).toEqual({ ai: 'gemini:Kore' });
  });

  it('defaults the text fields of an old profile to empty', () => {
    const f = savedProfileFields({ name: 'A', description: 5 });
    expect(f.description).toBe('');
    expect(f.highlighted).toBe(false);
    expect(f.images).toEqual([]);
  });
});
