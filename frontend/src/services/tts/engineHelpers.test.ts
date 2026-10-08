import { describe, it, expect, vi } from 'vitest';
import { chunkText } from './webSpeechEngine';
import { WordClock, estimateDurationMs } from './wordClock';
import { loadVoiceSettings, isAiProviderConfigured, providerIsRemote } from '../../stores/voiceSettingsStore';

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('Hello there.')).toEqual([{ text: 'Hello there.', offset: 0 }]);
  });

  it('splits long text at sentence ends, with offsets back into the original', () => {
    const s1 = 'A'.repeat(150) + '. ';
    const s2 = 'B'.repeat(150) + '.';
    const text = s1 + s2;
    const chunks = chunkText(text, 200);
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('cuts a single over-long sentence at a space', () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
  });
});

describe('WordClock', () => {
  it('moves forward through the words and lands on the last', () => {
    const onWord = vi.fn();
    const clock = new WordClock('one two three', onWord);
    clock.update(0);
    clock.update(0.5);
    clock.update(0.4); // never backwards
    clock.update(1);
    const starts = onWord.mock.calls.map((c) => c[0]);
    expect(starts[0]).toBe(0);
    expect(starts[starts.length - 1]).toBe(8);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('estimates longer for more text and slower speech', () => {
    expect(estimateDurationMs('a '.repeat(100), 1)).toBeGreaterThan(estimateDurationMs('a', 1));
    expect(estimateDurationMs('hello world', 0.5)).toBeGreaterThan(estimateDurationMs('hello world', 2));
  });
});

describe('loadVoiceSettings', () => {
  it('falls back to defaults on missing or corrupt data', () => {
    expect(loadVoiceSettings(null).enginePreference).toBe('system');
    expect(loadVoiceSettings('{not json').aiProvider).toBe('');
  });

  it('keeps good fields and drops bad ones', () => {
    const s = loadVoiceSettings(JSON.stringify({
      aiProvider: 'elevenlabs',
      apiKeys: { elevenlabs: 'k', bogus: 'x' },
      options: { rate: 9, readAction: false, followScript: 'yes' },
      narratorVoice: { system: 'Alex', ai: 3 },
    }));
    expect(s.aiProvider).toBe('elevenlabs');
    expect(s.apiKeys).toEqual({ elevenlabs: 'k' });
    expect(s.options.rate).toBe(2);
    expect(s.options.readAction).toBe(false);
    expect(s.options.followScript).toBe(true);
    expect(s.narratorVoice).toEqual({ system: 'Alex' });
  });

  it('rejects an unknown provider', () => {
    expect(loadVoiceSettings(JSON.stringify({ aiProvider: 'acme' })).aiProvider).toBe('');
  });
});

describe('isAiProviderConfigured', () => {
  it('needs a key for hosted providers and an address for a compatible server', () => {
    expect(isAiProviderConfigured({ aiProvider: '', apiKeys: {}, compatibleBaseUrl: '' })).toBe(false);
    expect(isAiProviderConfigured({ aiProvider: 'openai', apiKeys: {}, compatibleBaseUrl: '' })).toBe(false);
    expect(isAiProviderConfigured({ aiProvider: 'openai', apiKeys: { openai: 'sk' }, compatibleBaseUrl: '' })).toBe(true);
    expect(isAiProviderConfigured({ aiProvider: 'openai-compatible', apiKeys: {}, compatibleBaseUrl: 'http://localhost:8880/v1' })).toBe(true);
    expect(isAiProviderConfigured({ aiProvider: 'openai-compatible', apiKeys: {}, compatibleBaseUrl: 'localhost' })).toBe(false);
  });
});

describe('new providers', () => {
  const none = { apiKeys: {}, compatibleBaseUrl: '' };

  it('Kokoro needs nothing; Gemini a key; Azure a key and a region', () => {
    expect(isAiProviderConfigured({ ...none, aiProvider: 'kokoro' })).toBe(true);
    expect(isAiProviderConfigured({ ...none, aiProvider: 'gemini' })).toBe(false);
    expect(isAiProviderConfigured({ ...none, aiProvider: 'gemini', apiKeys: { gemini: 'k' } })).toBe(true);
    expect(isAiProviderConfigured({ ...none, aiProvider: 'azure', apiKeys: { azure: 'k' } })).toBe(false);
    expect(isAiProviderConfigured({ ...none, aiProvider: 'azure', apiKeys: { azure: 'k' }, azureRegion: 'eastus' })).toBe(true);
  });

  it('only Kokoro keeps the script on the device', () => {
    expect(providerIsRemote('kokoro')).toBe(false);
    for (const p of ['gemini', 'openai', 'elevenlabs', 'azure', 'openai-compatible'] as const) {
      expect(providerIsRemote(p)).toBe(true);
    }
    expect(providerIsRemote('')).toBe(false);
  });

  it('loads the new providers and their settings back', () => {
    const s = loadVoiceSettings(JSON.stringify({
      aiProvider: 'azure', apiKeys: { azure: 'k', gemini: 'g' }, azureRegion: 'westeurope', geminiModel: 'gemini-3.8-flash-lite-tts',
    }));
    expect(s.aiProvider).toBe('azure');
    expect(s.apiKeys).toEqual({ azure: 'k', gemini: 'g' });
    expect(s.azureRegion).toBe('westeurope');
    expect(s.geminiModel).toBe('gemini-3.8-flash-lite-tts');
  });
});
