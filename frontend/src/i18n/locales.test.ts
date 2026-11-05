/**
 * Every shipped language is complete and well-formed.
 *
 * Fails, with the exact keys, when a language is missing a file or a key, has
 * a key English does not, drops or invents a {{placeholder}} or <tag>, lacks a
 * plural form its language needs, leaves a value empty — or leaves text
 * untranslated. See docs/i18n.md.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES } from './languages';
import { NAMESPACES, resources } from './resources';
import { checkNamespace, flatten, scriptCoverage, type Json } from './localeCheck';
import reviewedSame from './sameAsEnglish.json';

const LOCALES = join(__dirname, '..', 'locales');

const read = (code: string, ns: string): Json => JSON.parse(readFileSync(join(LOCALES, code, `${ns}.json`), 'utf8')) as Json;

/** Words that are names, not language: they may stay as they are in a translation. */
const KEEP = new Set([
  'opendraft', 'final', 'draft', 'fountain', 'fdx', 'pdf', 'docx', 'html', 'csv', 'txt', 'rtf', 'json', 'xml', 'yaml', 'markdown',
  'celtx', 'highland', 'writerduet', 'scrivener', 'google', 'apple', 'icloud', 'onedrive', 'dropbox', 'github', 'ios', 'android',
  'windows', 'macos', 'linux', 'ipad', 'iphone', 'openai', 'anthropic', 'claude', 'ollama', 'kokoro', 'harper', 'whisper',
  'wikipedia', 'imdb', 'hunspell', 'unicode', 'utf', 'mac', 'web', 'api', 'url', 'wifi', 'qr', 'pro', 'sides',
  'courier', 'prime', 'arial', 'times', 'roman', 'helvetica', 'calibri', 'verdana', 'georgia',
]);

/**
 * Strings that are the same word in English and in that language (French
 * "Dialogue", Spanish "Color", Portuguese "Layout"…). Each was read and
 * approved; a NEW string left in English is still caught. Add to
 * sameAsEnglish.json only after checking the word really is the right one.
 */
const REVIEWED = reviewedSame as Record<string, string[]>;

function sameAsEnglishOk(en: string): boolean {
  const words = en.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').match(/\p{L}{3,}/gu) ?? [];
  return words.every((w) => KEEP.has(w.toLowerCase()));
}

const SCRIPT: Record<string, RegExp> = {
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
};

describe('English source', () => {
  it('has a file for every namespace, and no stray ones', () => {
    const files = readdirSync(join(LOCALES, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual([...NAMESPACES].sort());
  });

  it.each(NAMESPACES)('%s has only string values and no empty text', (ns) => {
    const flat = flatten(resources[ns] as Json);
    const empty = Object.entries(flat).filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('gives every plural key both _one and _other', () => {
    const bad: string[] = [];
    for (const ns of NAMESPACES) {
      const keys = Object.keys(flatten(resources[ns] as Json));
      for (const k of keys) {
        const m = /^(.*)_(one|other)$/.exec(k);
        if (m && !keys.includes(`${m[1]}_${m[2] === 'one' ? 'other' : 'one'}`)) bad.push(`${ns}:${k}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe.each(LANGUAGES.filter((l) => l.code !== 'en'))('$englishName ($code)', ({ code }) => {
  it('has a file for every namespace', () => {
    const missing = NAMESPACES.filter((ns) => !existsSync(join(LOCALES, code, `${ns}.json`)));
    expect(missing, `missing locales/${code}/<ns>.json`).toEqual([]);
  });

  it('has no namespace file English lacks', () => {
    const dir = join(LOCALES, code);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')) : [];
    expect(files.filter((f) => !(NAMESPACES as string[]).includes(f))).toEqual([]);
  });

  it.each(NAMESPACES)('%s matches English key for key', (ns) => {
    if (!existsSync(join(LOCALES, code, `${ns}.json`))) throw new Error(`locales/${code}/${ns}.json does not exist`);
    const problems = checkNamespace(ns, resources[ns] as Json, read(code, ns), {
      lang: code,
      sameAsEnglishOk: (en, key) => sameAsEnglishOk(en) || (REVIEWED[code] ?? []).includes(`${ns}:${key}`),
    });
    expect(problems.slice(0, 25), `${problems.length} problem(s)`).toEqual([]);
  });

  if (SCRIPT[code]) {
    it(`is written in its own script (${code})`, () => {
      let total = 0;
      let hit = 0;
      const missing: string[] = [];
      for (const ns of NAMESPACES) {
        if (!existsSync(join(LOCALES, code, `${ns}.json`))) continue;
        const r = scriptCoverage(flatten(read(code, ns)), SCRIPT[code], flatten(resources[ns] as Json));
        total += r.total;
        hit += r.hit;
        missing.push(...r.missing.map((k) => `${ns}:${k}`));
      }
      expect(total, 'no translatable strings found').toBeGreaterThan(0);
      // A few strings are legitimately all-Latin (a brand, a unit); a real gap is far larger.
      expect(hit / total, `untranslated: ${missing.slice(0, 15).join(', ')}`).toBeGreaterThan(0.97);
    });
  }
});
