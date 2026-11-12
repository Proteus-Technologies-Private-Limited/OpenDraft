import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { testExtensions, block, doc as jsonDoc } from '../test/screenplaySchema';

const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
const schema = getSchema(testExtensions);

afterEach(() => {
  Object.defineProperty(Intl, 'Segmenter', descriptor);
  vi.resetModules();
});

describe('Script Health without Intl.Segmenter', () => {
  it('imports and analyzes when the API is absent at application startup', async () => {
    Reflect.deleteProperty(Intl, 'Segmenter');
    vi.resetModules();
    const { analyzeScriptHealth } = await import('./scriptHealth');
    const text = 'a'.repeat(179) + '😀' + 'trailing text';
    const document = schema.nodeFromJSON(jsonDoc(block('dialogue', text)));
    const findings = analyzeScriptHealth(document, {
      numbering: {}, sceneNumbersVisible: true, dialogueChecks: true, notes: [],
    });
    expect(findings[0].excerpt).toBe('a'.repeat(179) + '😀');
    expect(findings[0].excerpt).not.toContain('\ufffd');
  });

  it('uses a bounded code-point fallback for combined characters and emoji sequences', async () => {
    Reflect.deleteProperty(Intl, 'Segmenter');
    vi.resetModules();
    const { takeCharacters, graphemeSegmenter } = await import('./textSegmentation');
    expect(graphemeSegmenter).toBeNull();
    for (const text of ['कि'.repeat(100), '👨‍👩‍👧‍👦'.repeat(40), 'e\u0301'.repeat(100)]) {
      const result = takeCharacters(text, 180);
      expect(result).toBe(Array.from(text).slice(0, 180).join(''));
      expect(new TextDecoder().decode(new TextEncoder().encode(result))).toBe(result);
    }
    expect(takeCharacters('😀', 0)).toBe('');
  });

  it('keeps available grapheme boundaries and handles short or empty input', async () => {
    const { takeCharacters } = await import('./textSegmentation');
    expect(takeCharacters('a👨‍👩‍👧‍👦b', 2)).toBe('a👨‍👩‍👧‍👦');
    expect(takeCharacters('', 180)).toBe('');
    expect(takeCharacters('short', 180)).toBe('short');
  });
});
