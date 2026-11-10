/**
 * The iOS and macOS apps show no text that names Android.
 *
 * App Review rejects an Apple build that mentions another mobile platform
 * anywhere a user can see it (guideline 2.3.10) — and it reads the release
 * notes in Help → About and the user manual, not only the store listing. Text
 * that has to name Android is written so the Apple apps can leave it out:
 *
 *   - release notes in MenuBar.tsx: inside <NotOnApple>…</NotOnApple>
 *   - the user manual: inside an element with data-platform="android"
 *   - translations: an Apple-only key the code picks with
 *     hidesOtherMobilePlatforms()
 *
 * This fails, quoting the text, when something new names Android outside them.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND_SRC = join(__dirname, '..');
const MANUAL = join(__dirname, '..', '..', '..', 'user-manual');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Text of an HTML page with every data-platform="android" element taken out. */
function textOutsideAndroidBlocks(html: string): string {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const stack: boolean[] = []; // per open element: does it, or an ancestor, belong to Android?
  let out = '';
  let last = 0;
  for (const m of body.matchAll(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g)) {
    if (!stack.some(Boolean)) out += body.slice(last, m.index);
    last = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      stack.pop();
    } else if (!VOID.has(tag) && !m[0].endsWith('/>')) {
      stack.push(/\bdata-platform\s*=\s*"android"/.test(m[0]));
    }
  }
  if (!stack.some(Boolean)) out += body.slice(last);
  return out.replace(/\s+/g, ' ');
}

const mentions = (text: string) => text.match(/.{0,50}android.{0,30}/gi) ?? [];

describe('Help → About release notes', () => {
  it('name Android only inside <NotOnApple>', () => {
    const src = readFileSync(join(FRONTEND_SRC, 'components', 'MenuBar.tsx'), 'utf8');
    const start = src.indexOf('{aboutOpen && (');
    const end = src.indexOf('i18n-ignore-end', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const shown = src
      .slice(start, end)
      .replace(/<NotOnApple(?:\s+apple="([^"]*)")?>[\s\S]*?<\/NotOnApple>/g, (_, apple: string | undefined) => apple ?? '');
    expect(mentions(shown)).toEqual([]);
  });
});

describe('user manual', () => {
  const pages = readdirSync(MANUAL).filter((f) => f.endsWith('.html'));

  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it.each(pages)('%s names Android only inside data-platform="android"', (page) => {
    expect(mentions(textOutsideAndroidBlocks(readFileSync(join(MANUAL, page), 'utf8')))).toEqual([]);
  });
});

describe('Apple-only translations', () => {
  const locales = readdirSync(join(FRONTEND_SRC, 'locales'));

  it.each(locales)('%s Dictation text for Apple does not name Android', (code) => {
    const addons = JSON.parse(readFileSync(join(FRONTEND_SRC, 'locales', code, 'addons.json'), 'utf8'));
    const apple = [addons.dictation.plugin.privacyApple, addons.dictation.privacy.deviceApple];
    for (const text of apple) {
      expect(text).toBeTruthy();
      expect(mentions(text)).toEqual([]);
    }
  });
});
