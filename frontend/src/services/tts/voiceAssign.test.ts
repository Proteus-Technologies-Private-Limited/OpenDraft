import { describe, it, expect } from 'vitest';
import { castVoices, genderOf, inferGenders } from './voiceAssign';
import type { CharacterProfile } from '../../stores/editorStore';
import type { VoiceInfo } from './types';

const profile = (name: string, extra: Partial<CharacterProfile> = {}): CharacterProfile => ({
  name, description: '', color: '', highlighted: false, gender: '', age: '', role: '',
  backstory: '', arc: '', speechPattern: '', vocabulary: '', verbalTics: '', sampleDialogue: '',
  images: [], ...extra,
});

const v = (id: string, lang = 'en-US', gender?: 'female' | 'male'): VoiceInfo => ({ id, name: id, lang, gender });

describe('genderOf', () => {
  it('reads the usual ways a writer fills in Gender', () => {
    expect(genderOf('Female')).toBe('female');
    expect(genderOf('f')).toBe('female');
    expect(genderOf('Male')).toBe('male');
    expect(genderOf('man, 40s')).toBe('male');
    expect(genderOf('non-binary')).toBeUndefined();
    expect(genderOf('')).toBeUndefined();
  });
});

describe('castVoices', () => {
  const voices = [v('a'), v('b'), v('c'), v('d'), v('fr', 'fr-FR')];

  it('gives the narrator the first voice and each character a different one', () => {
    const c = castVoices({
      kind: 'system', voices, speakers: ['ANNA', 'BEN', 'CAL'], profiles: [], narrator: {}, preferredLang: 'en-GB',
    });
    expect(c.narrator).toBe('a');
    expect([...c.bySpeaker.values()]).toEqual(['b', 'c', 'd']);
  });

  it('keeps a voice the writer chose, and casts around it', () => {
    const c = castVoices({
      kind: 'system', voices, speakers: ['ANNA', 'BEN'],
      profiles: [profile('BEN', { voice: { system: 'b' } })], narrator: {}, preferredLang: 'en',
    });
    expect(c.bySpeaker.get('BEN')).toBe('b');
    expect(c.bySpeaker.get('ANNA')).toBe('c');
  });

  it('reads the slot for the engine in use', () => {
    const ai = [v('openai:nova', ''), v('openai:onyx', '')];
    const c = castVoices({
      kind: 'ai', voices: ai, speakers: ['ANNA'],
      profiles: [profile('ANNA', { voice: { system: 'a', ai: 'openai:onyx' } })], narrator: {}, preferredLang: 'en',
    });
    expect(c.bySpeaker.get('ANNA')).toBe('openai:onyx');
  });

  it('ignores a chosen voice that is not installed here', () => {
    const c = castVoices({
      kind: 'system', voices, speakers: ['ANNA'],
      profiles: [profile('ANNA', { voice: { system: 'missing' } })], narrator: {}, preferredLang: 'en',
    });
    expect(c.bySpeaker.get('ANNA')).toBe('b');
  });

  it('prefers the writer\'s language and honours a chosen narrator', () => {
    const c = castVoices({
      kind: 'system', voices, speakers: ['ANNA'], profiles: [], narrator: { system: 'c' }, preferredLang: 'fr-CA',
    });
    expect(c.narrator).toBe('c');
    expect(c.bySpeaker.get('ANNA')).toBe('fr');
  });

  it('matches gender where both sides say', () => {
    const g = [v('n'), v('m1', 'en', 'male'), v('f1', 'en', 'female')];
    const c = castVoices({
      kind: 'ai', voices: g, speakers: ['ANNA', 'BEN'],
      profiles: [profile('ANNA', { gender: 'Female' }), profile('BEN', { gender: 'Male' })],
      narrator: {}, preferredLang: 'en',
    });
    expect(c.bySpeaker.get('ANNA')).toBe('f1');
    expect(c.bySpeaker.get('BEN')).toBe('m1');
  });

  it('reuses voices, not the narrator, once they run out', () => {
    const c = castVoices({
      kind: 'system', voices: [v('a'), v('b')], speakers: ['X', 'Y', 'Z'], profiles: [], narrator: {}, preferredLang: 'en',
    });
    expect([...c.bySpeaker.values()]).toEqual(['b', 'b', 'b']);
  });

  it('copes with no voices at all', () => {
    const c = castVoices({ kind: 'system', voices: [], speakers: ['X'], profiles: [], narrator: {}, preferredLang: 'en' });
    expect(c.narrator).toBeNull();
    expect(c.bySpeaker.get('X')).toBeNull();
  });
});

describe('novelty voices', () => {
  it('are never cast automatically while a reading voice exists', () => {
    const c = castVoices({
      kind: 'system',
      voices: [{ ...v('bubbles'), novelty: true }, v('a'), { ...v('zarvox'), novelty: true }, v('b')],
      speakers: ['X', 'Y'], profiles: [], narrator: {}, preferredLang: 'en',
    });
    expect(c.narrator).toBe('a');
    expect([...c.bySpeaker.values()]).toEqual(['b', 'b']);
  });
});

describe('inferGenders', () => {
  const action = (text: string) => ({ kind: 'action', text }) as never;

  it('reads the pronouns in the action line that introduces a character', () => {
    const lines = [
      action('SARAH CHEN (30s, sharp eyes) sits alone. She stares at her phone. Her leg bounces.'),
      action('The door SWINGS open. MARCUS WEBB (40s) enters, shaking rain off his umbrella. He spots Sarah and heads her way.'),
      action('A HOODED FIGURE watches from across the street.'),
    ];
    const g = inferGenders(lines, ['SARAH', 'MARCUS', 'HOODED FIGURE', 'NOBODY']);
    expect(g.get('SARAH')).toBe('female');
    expect(g.get('MARCUS')).toBe('male');
    expect(g.has('HOODED FIGURE')).toBe(false);
    expect(g.has('NOBODY')).toBe(false);
  });
});

describe('casting without any gender information', () => {
  it('alternates female and male voices rather than taking the first few listed', () => {
    const voices = [v('n', 'en', 'female'), v('f1', 'en', 'female'), v('f2', 'en', 'female'), v('m1', 'en', 'male'), v('m2', 'en', 'male')];
    const c = castVoices({ kind: 'ai', voices, speakers: ['A', 'B', 'C', 'D'], profiles: [], narrator: {}, preferredLang: 'en' });
    expect([...c.bySpeaker.values()]).toEqual(['f1', 'm1', 'f2', 'm2']);
  });

  it('uses genders inferred from the script when the profile has none', () => {
    const voices = [v('n', 'en', 'female'), v('f1', 'en', 'female'), v('m1', 'en', 'male')];
    const c = castVoices({
      kind: 'ai', voices, speakers: ['MARCUS'], profiles: [], narrator: {}, preferredLang: 'en',
      inferred: new Map([['MARCUS', 'male']]),
    });
    expect(c.bySpeaker.get('MARCUS')).toBe('m1');
  });
});
