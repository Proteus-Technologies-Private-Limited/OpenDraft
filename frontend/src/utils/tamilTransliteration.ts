import sanscript from '@indic-transliteration/sanscript';

export type TransliterationScheme = 'itrans_dravidian' | 'optitrans_dravidian' | 'tamil' | 'phonetic';

/**
 * Normalizes intuitive conversational Tamil phonetic spellings before passing to Sanscript.
 *
 * Examples:
 * - 'kaatchi' -> 'kATchi' -> காட்சி
 * - 'vanakkam' -> 'vaNakkam' -> வணக்கம்
 * - 'tamil' / 'thamizh' -> 'tamizh' -> தமிழ்
 * - 'nandri' -> 'nan2Ri' -> நன்றி
 */
export function normalizeTamilPhonetics(rawInput: string): string {
  let s = rawInput;

  // Direct word dictionary for conversational words
  const wordMap: Record<string, string> = {
    vanakkam: 'vaNakkam',
    vanakam: 'vaNakkam',
    nandri: 'nan2Ri',
    nanri: 'nan2Ri',
    tamil: 'tamizh',
    thamizh: 'tamizh',
    thamiz: 'tamizh',
    thamil: 'tamizh',
    eppadi: 'eppaDi',
    irukkeenga: 'irukkiGga',
    irukinga: 'irukkiGga',
    aamaam: 'AmAm',
    kaatchi: 'kATchi',
    katchi: 'kATchi',
  };

  const lower = s.toLowerCase();
  if (wordMap[lower]) {
    return wordMap[lower];
  }

  // Common pattern replacements:
  // 'tch' -> 'Tch' so it maps to retroflex ட் + ச்/சி (e.g. காட்சி)
  s = s.replace(/tch/gi, 'Tch');

  // 'ndr' -> 'n2R' (as in நன்றி / சென்று)
  s = s.replace(/ndr/gi, 'n2R');

  return s;
}

/**
 * Transliterates text into Tamil Unicode using Sanscript with intuitive phonetic normalization.
 *
 * @param text The input text (e.g. "vaNakkam", "ammaa", "kaatchi")
 * @param fromScheme The source encoding scheme ('itrans_dravidian' | 'optitrans_dravidian')
 * @returns The converted Tamil string
 */
export function transliterateToTamil(
  text: string,
  fromScheme: 'itrans_dravidian' | 'optitrans_dravidian' = 'itrans_dravidian'
): string {
  if (!text || text.trim() === '') {
    return text;
  }

  const normalized = normalizeTamilPhonetics(text);
  try {
    return sanscript.t(normalized, fromScheme, 'tamil');
  } catch (err) {
    console.error('Failed to transliterate to Tamil:', err);
    return text;
  }
}

/**
 * Returns multiple candidate suggestions for a given input word.
 */
export function getTamilSuggestions(rawWord: string): string[] {
  if (!rawWord || rawWord.trim() === '') return [];

  const candidates = new Set<string>();

  // 1. Normalized itrans_dravidian
  const primary = transliterateToTamil(rawWord, 'itrans_dravidian');
  if (primary) candidates.add(primary);

  // 2. Direct itrans_dravidian without normalization
  try {
    const directItrans = sanscript.t(rawWord, 'itrans_dravidian', 'tamil');
    if (directItrans) candidates.add(directItrans);
  } catch {
    // ignore
  }

  // 3. Direct optitrans_dravidian
  try {
    const directOptitrans = sanscript.t(rawWord, 'optitrans_dravidian', 'tamil');
    if (directOptitrans) candidates.add(directOptitrans);
  } catch {
    // ignore
  }

  return Array.from(candidates);
}

export default {
  normalizeTamilPhonetics,
  transliterateToTamil,
  getTamilSuggestions,
};
