/**
 * Text the Android app shows instead of an Apple-specific string must not name
 * Apple's platforms or products in any language: Play reviewers treat that the
 * way App Review treats "Android" in an iOS app (see docs/RELEASE.md, step 3).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname, '..', 'locales');
const APPLE = /apple|pencil|ipad|iphone|\bios\b|macos/i;

describe('Android-only wording', () => {
  for (const code of readdirSync(LOCALES)) {
    it(`${code}: the writing pad's stylus placeholder names no Apple product`, () => {
      const editor = JSON.parse(readFileSync(join(LOCALES, code, 'editor.json'), 'utf8'));
      const text: unknown = editor?.scribble?.placeholderStylus;
      expect(typeof text).toBe('string');
      expect(text).not.toMatch(APPLE);
    });
  }
});
