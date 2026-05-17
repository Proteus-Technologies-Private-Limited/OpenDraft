/** Catalog of languages users can install. Entries come from two sources:
 *
 *  - jsdelivr (wooorm/dictionaries): most European languages.
 *  - LibreOffice/dictionaries (raw.githubusercontent.com): the Indian language
 *    set (Hindi, Tamil, Telugu, etc.), Arabic, and a few others not in wooorm.
 *
 *  The installer also accepts arbitrary URLs via a "Custom URL…" entry. */

export interface CatalogLanguage {
  /** Internal code (becomes the spell-checker language id). */
  code: string;
  /** User-facing label, e.g. "Hindi (हिन्दी)". */
  label: string;
  /** Native script sample (for the picker). */
  sample?: string;
  /** Where to download from. */
  source:
    | { kind: 'jsdelivr'; npm: string }
    | { kind: 'libreoffice'; folder: string; baseName?: string }
    /** Hunspell files committed to this repo under `dictionaries-extra/<path>/`
     *  and served via jsDelivr's GitHub CDN. Used for languages where the
     *  upstream LibreOffice / wooorm dictionary is too small or unavailable
     *  (e.g. Odia — LibreOffice ships 1k words; we ship a 320k-word list
     *  derived from the MPL-2.0 Odia Spelling Checker Firefox add-on). */
    | { kind: 'opendraft-extra'; path: string };
}

/** Built-in language always available; not downloadable. */
export const BUILTIN: CatalogLanguage = {
  code: 'en_US',
  label: 'English (US)',
  source: { kind: 'jsdelivr', npm: 'dictionary-en-us' },
  sample: 'Aa',
};

/** Languages the user can install. */
export const CATALOG: CatalogLanguage[] = [
  // English variants (wooorm)
  { code: 'en_GB', label: 'English (UK)', source: { kind: 'jsdelivr', npm: 'dictionary-en-gb' }, sample: 'Aa' },
  { code: 'en_AU', label: 'English (Australia)', source: { kind: 'jsdelivr', npm: 'dictionary-en-au' }, sample: 'Aa' },
  { code: 'en_CA', label: 'English (Canada)', source: { kind: 'jsdelivr', npm: 'dictionary-en-ca' }, sample: 'Aa' },

  // Indic languages (LibreOffice)
  { code: 'hi_IN', label: 'Hindi (हिन्दी)', source: { kind: 'libreoffice', folder: 'hi_IN' }, sample: 'क ख' },
  { code: 'mr_IN', label: 'Marathi (मराठी)', source: { kind: 'libreoffice', folder: 'mr_IN' }, sample: 'क ख' },
  { code: 'gu_IN', label: 'Gujarati (ગુજરાતી)', source: { kind: 'libreoffice', folder: 'gu_IN' }, sample: 'ક ખ' },
  { code: 'bn_BD', label: 'Bengali (বাংলা)', source: { kind: 'libreoffice', folder: 'bn_BD' }, sample: 'ক খ' },
  { code: 'ta_IN', label: 'Tamil (தமிழ்)', source: { kind: 'libreoffice', folder: 'ta_IN' }, sample: 'அ ஆ' },
  { code: 'te_IN', label: 'Telugu (తెలుగు)', source: { kind: 'libreoffice', folder: 'te_IN' }, sample: 'అ ఆ' },
  { code: 'kn_IN', label: 'Kannada (ಕನ್ನಡ)', source: { kind: 'libreoffice', folder: 'kn_IN' }, sample: 'ಅ ಆ' },
  { code: 'pa_IN', label: 'Punjabi (ਪੰਜਾਬੀ)', source: { kind: 'libreoffice', folder: 'pa_IN' }, sample: 'ੳ ਅ' },
  // LibreOffice's or_IN ships only ~1k words, so basic Odia gets flagged as
  // misspelled. We use a 320k-word list derived from the Odia Wikipedians'
  // Firefox add-on (MPL-2.0). See dictionaries-extra/or_IN/NOTICE.md.
  { code: 'or_IN', label: 'Odia (ଓଡ଼ିଆ)', source: { kind: 'opendraft-extra', path: 'or_IN' }, sample: 'ଅ ଆ' },
  { code: 'as_IN', label: 'Assamese (অসমীয়া)', source: { kind: 'libreoffice', folder: 'as_IN' }, sample: 'অ আ' },
  { code: 'ne_NP', label: 'Nepali (नेपाली)', source: { kind: 'libreoffice', folder: 'ne_NP' }, sample: 'क ख' },
  { code: 'si_LK', label: 'Sinhala (සිංහල)', source: { kind: 'libreoffice', folder: 'si_LK' }, sample: 'අ ආ' },

  // European (wooorm)
  { code: 'fr', label: 'French (Français)', source: { kind: 'jsdelivr', npm: 'dictionary-fr' }, sample: 'Àà' },
  { code: 'de', label: 'German (Deutsch)', source: { kind: 'jsdelivr', npm: 'dictionary-de' }, sample: 'Ää' },
  { code: 'es', label: 'Spanish (Español)', source: { kind: 'jsdelivr', npm: 'dictionary-es' }, sample: 'Ññ' },
  { code: 'it', label: 'Italian (Italiano)', source: { kind: 'jsdelivr', npm: 'dictionary-it' }, sample: 'Èè' },
  { code: 'pt', label: 'Portuguese', source: { kind: 'jsdelivr', npm: 'dictionary-pt' }, sample: 'Ãã' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)', source: { kind: 'jsdelivr', npm: 'dictionary-pt-br' }, sample: 'Ãã' },
  { code: 'pt_PT', label: 'Portuguese (Portugal)', source: { kind: 'jsdelivr', npm: 'dictionary-pt-pt' }, sample: 'Ãã' },
  { code: 'nl', label: 'Dutch (Nederlands)', source: { kind: 'jsdelivr', npm: 'dictionary-nl' }, sample: 'Ïï' },
  { code: 'ru', label: 'Russian (Русский)', source: { kind: 'jsdelivr', npm: 'dictionary-ru' }, sample: 'Аа' },
  { code: 'pl', label: 'Polish (Polski)', source: { kind: 'jsdelivr', npm: 'dictionary-pl' }, sample: 'Łł' },
  { code: 'tr', label: 'Turkish (Türkçe)', source: { kind: 'jsdelivr', npm: 'dictionary-tr' }, sample: 'Şş' },

  // Other (LibreOffice for Arabic; wooorm for the rest)
  { code: 'ar', label: 'Arabic (العربية)', source: { kind: 'libreoffice', folder: 'ar' }, sample: 'ا ب' },
  { code: 'fa', label: 'Persian (فارسی)', source: { kind: 'jsdelivr', npm: 'dictionary-fa' }, sample: 'ا ب' },
  { code: 'he', label: 'Hebrew (עברית)', source: { kind: 'jsdelivr', npm: 'dictionary-he' }, sample: 'א ב' },
];

const ALL_BY_CODE = new Map<string, CatalogLanguage>(
  [BUILTIN, ...CATALOG].map((l) => [l.code, l]),
);

export function findLanguage(code: string): CatalogLanguage | undefined {
  return ALL_BY_CODE.get(code);
}

/** GitHub repo that hosts the `dictionaries-extra/` folder consumed by the
 *  `opendraft-extra` source kind. Pinned to `main` — jsDelivr caches a single
 *  ref aggressively, so users won't re-download on every release. */
const OPENDRAFT_EXTRA_BASE =
  'https://cdn.jsdelivr.net/gh/Proteus-Technologies-Private-Limited/OpenDraft@main/dictionaries-extra';

/** Build .aff/.dic download URLs for a catalog entry. */
export function urlsFor(lang: CatalogLanguage): { aff: string; dic: string } {
  if (lang.source.kind === 'jsdelivr') {
    return {
      aff: `https://cdn.jsdelivr.net/npm/${lang.source.npm}/index.aff`,
      dic: `https://cdn.jsdelivr.net/npm/${lang.source.npm}/index.dic`,
    };
  }
  if (lang.source.kind === 'opendraft-extra') {
    const dir = lang.source.path;
    // The on-disk files use the language code as their basename.
    return {
      aff: `${OPENDRAFT_EXTRA_BASE}/${dir}/${lang.code}.aff`,
      dic: `${OPENDRAFT_EXTRA_BASE}/${dir}/${lang.code}.dic`,
    };
  }
  const { folder, baseName } = lang.source;
  const name = baseName || folder;
  const base = `https://raw.githubusercontent.com/LibreOffice/dictionaries/master/${folder}/${name}`;
  return { aff: `${base}.aff`, dic: `${base}.dic` };
}

/** @deprecated use urlsFor(lang) — kept for back-compat with earlier imports. */
export function jsdelivrUrls(npm: string): { aff: string; dic: string } {
  return {
    aff: `https://cdn.jsdelivr.net/npm/${npm}/index.aff`,
    dic: `https://cdn.jsdelivr.net/npm/${npm}/index.dic`,
  };
}
