/**
 * Integrity checks for a translated namespace against its English source.
 *
 * Pure functions over plain objects, so they are tested with fixtures
 * (localeCheck.test.ts) and then applied to the real files
 * (locales.test.ts). Everything here is about the *shape* of a translation —
 * a human still judges whether it reads well.
 */

export type Json = string | { [key: string]: Json };
export type Flat = Record<string, string>;

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const PLURAL_RE = new RegExp(`^(.*)_(${PLURAL_SUFFIXES.join('|')})$`);

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`. Throws on anything but strings and objects. */
export function flatten(obj: Json, prefix = '', out: Flat = {}): Flat {
  if (typeof obj === 'string') {
    out[prefix] = obj;
    return out;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`"${prefix}" must be a string or an object, found ${Array.isArray(obj) ? 'an array' : typeof obj}`);
  }
  for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

export interface KeyShape {
  /** keys that are not plural forms */
  plain: Set<string>;
  /** base key → the plural suffixes present */
  plural: Map<string, Set<string>>;
}

export function shapeOf(flat: Flat): KeyShape {
  const plain = new Set<string>();
  const plural = new Map<string, Set<string>>();
  for (const key of Object.keys(flat)) {
    const m = PLURAL_RE.exec(key);
    if (m) {
      if (!plural.has(m[1])) plural.set(m[1], new Set());
      plural.get(m[1])!.add(m[2]);
    } else {
      plain.add(key);
    }
  }
  return { plain, plural };
}

/** `{{name}}` / `{{name, format}}` → name. */
export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1]);
}

/** `<b>`, `</b>`, `<0>`, `<br/>` → b, b, 0, br. */
export function tags(value: string): string[] {
  return [...value.matchAll(/<\/?\s*([A-Za-z0-9]+)[^>]*>/g)].map((m) => m[1]);
}

const sortedJoin = (xs: string[]) => [...xs].sort().join('|');

/** Plural categories a language needs, from the engine's own CLDR data. */
export function pluralCategories(lang: string): string[] {
  return new Intl.PluralRules(lang).resolvedOptions().pluralCategories as string[];
}

export interface CheckOptions {
  lang: string;
  /** Strings that may legitimately equal the English (brand names, units, …). */
  sameAsEnglishOk?: (en: string, key: string) => boolean;
}

/** Everything wrong with `target` as a translation of `source`, as readable lines. */
export function checkNamespace(ns: string, source: Json, target: Json, opts: CheckOptions): string[] {
  const problems: string[] = [];
  const p = (msg: string) => problems.push(`${opts.lang}/${ns}: ${msg}`);

  let en: Flat;
  let tr: Flat;
  try {
    en = flatten(source);
    tr = flatten(target);
  } catch (err) {
    return [`${opts.lang}/${ns}: ${(err as Error).message}`];
  }

  const enShape = shapeOf(en);
  const trShape = shapeOf(tr);
  const needed = pluralCategories(opts.lang);

  // Plain keys: exactly the same set.
  for (const k of enShape.plain) if (!trShape.plain.has(k)) p(`missing key "${k}"`);
  for (const k of trShape.plain) if (!enShape.plain.has(k)) p(`extra key "${k}" (not in English)`);

  // Plural keys: same base keys, and every form this language needs.
  for (const base of enShape.plural.keys()) {
    const forms = trShape.plural.get(base);
    if (!forms) {
      p(`missing plural key "${base}"`);
      continue;
    }
    for (const cat of needed) if (!forms.has(cat)) p(`"${base}" lacks the "${cat}" plural form ${opts.lang} needs`);
    for (const f of forms) if (!needed.includes(f)) p(`"${base}_${f}" is not a plural form of ${opts.lang}`);
  }
  for (const base of trShape.plural.keys()) if (!enShape.plural.has(base)) p(`extra plural key "${base}" (not in English)`);

  // Value checks.
  for (const [key, value] of Object.entries(tr)) {
    const m = PLURAL_RE.exec(key);
    const base = m ? m[1] : key;
    const enValue = m ? en[`${base}_other`] ?? en[`${base}_one`] : en[key];
    if (enValue === undefined) continue; // already reported as extra

    if (value.trim() === '') {
      p(`"${key}" is empty`);
      continue;
    }
    if (value === key) p(`"${key}" shows its own key`);

    // Placeholders ({{x}}): every form needs the English ones, except that
    // `count` may be dropped from a form that is written without a number.
    const enAll = m
      ? [...new Set(PLURAL_SUFFIXES.flatMap((s) => placeholders(en[`${base}_${s}`] ?? '')))]
      : placeholders(enValue);
    const enRequired = new Set(placeholders(enValue).filter((x) => x !== 'count'));
    const got = new Set(placeholders(value));
    for (const x of enRequired) if (!got.has(x)) p(`"${key}" lost the placeholder {{${x}}}`);
    for (const x of got) if (!enAll.includes(x)) p(`"${key}" has an unknown placeholder {{${x}}}`);
    if (/\{\{[^}]*$|^[^{]*\}\}/.test(value) || (value.match(/\{\{/g) || []).length !== (value.match(/\}\}/g) || []).length) {
      p(`"${key}" has unbalanced {{ }}`);
    }

    // Markup (<b>…</b>, <0>…</0>): the same tags, so <Trans> still matches.
    if (sortedJoin(tags(enValue)) !== sortedJoin(tags(value))) {
      p(`"${key}" changed its markup: English ${JSON.stringify(tags(enValue))}, translation ${JSON.stringify(tags(value))}`);
    }
  }

  // Typography.
  for (const [key, value] of Object.entries(tr)) {
    for (const issue of typographyIssues(opts.lang, value)) p(`"${key}" ${issue}`);
  }

  // Untranslated text: a string with real words that still equals the English.
  if (opts.lang !== 'en') {
    for (const [key, value] of Object.entries(tr)) {
      const m = PLURAL_RE.exec(key);
      const base = m ? m[1] : key;
      const enValue = m ? en[`${base}_other`] : en[key];
      if (enValue === undefined || value !== enValue) continue;
      // Symbols, numbers, units — and the names inside {{placeholders}} and <tags>, which are not words.
      const words = enValue.replace(/\{\{[^}]*\}\}/g, ' ').replace(/<[^>]+>/g, ' ');
      if ((words.match(/\p{L}{3,}/gu) || []).length === 0) continue;
      if (opts.sameAsEnglishOk?.(enValue, key)) continue;
      p(`"${key}" is still English: ${JSON.stringify(enValue.slice(0, 60))}`);
    }
  }

  return problems;
}

/**
 * Typography a speaker would call wrong, per language. Returns readable issues
 * for one translated value (see docs/i18n-glossary.md).
 */
export function typographyIssues(lang: string, value: string): string[] {
  const out: string[] = [];
  const plain = value.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '');
  if (lang === 'fa') {
    if (/[\u064A\u0643]/.test(plain)) out.push('uses Arabic ي/ك — Persian needs ی (U+06CC) and ک (U+06A9)');
  }
  if (lang === 'ur') {
    if (/[\u064A\u0643]/.test(plain)) out.push('uses Arabic ي/ك — Urdu needs ی (U+06CC) and ک (U+06A9)');
  }
  if (lang === 'ar') {
    if (/[\u06CC\u06A9\u200C]/.test(plain)) out.push('uses Persian ی/ک or a half-space — Arabic needs ي (U+064A) and ك (U+0643)');
  }
  if (lang === 'fr') {
    // A plain space before : ; ! ? » (or after «) breaks a line in the wrong place.
    if (/\S ([:;!?»])/.test(plain) && !/https?:/.test(plain)) out.push('French needs a no-break space (U+00A0) before : ; ! ? »');
    if (/« /.test(plain)) out.push('French needs a no-break space (U+00A0) after «');
  }
  if (lang === 'es') {
    const open = (plain.match(/[¿¡]/g) || []).length;
    const close = (plain.match(/[?!]/g) || []).length;
    if (close > open) out.push('Spanish needs an opening ¿ or ¡ for every ? or !');
  }
  return out;
}

/** Share of strings that actually contain letters of the language's script. */
export function scriptCoverage(flat: Flat, script: RegExp, en: Flat): { total: number; hit: number; missing: string[] } {
  let total = 0;
  let hit = 0;
  const missing: string[] = [];
  for (const [key, value] of Object.entries(flat)) {
    const enValue = en[key] ?? en[key.replace(/_(zero|one|two|few|many|other)$/, '_other')];
    // Only strings that were real words in English.
    if (!enValue || (enValue.match(/\p{Script=Latin}{3,}/gu) || []).length === 0) continue;
    // Strip placeholders and tags before looking at the letters.
    const stripped = value.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '');
    total++;
    if (script.test(stripped)) hit++;
    else missing.push(key);
  }
  return { total, hit, missing };
}
