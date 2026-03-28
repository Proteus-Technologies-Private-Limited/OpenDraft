export interface FontEntry {
  name: string;
  category: string;
  scripts: string[];
  source: 'local' | 'system' | 'google';
  direction: 'ltr' | 'rtl';
  googleUrl?: string;
}

export const FONT_CATEGORIES = [
  'Screenplay Standard',
  'Latin Extended',
  'Indian / Indic',
  'Arabic & Hebrew',
  'CJK',
  'Other',
] as const;

export const FONT_REGISTRY: FontEntry[] = [
  // Screenplay Standard
  { name: 'Courier Final Draft', category: 'Screenplay Standard', scripts: ['latin'], source: 'local', direction: 'ltr' },
  { name: 'Courier New', category: 'Screenplay Standard', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Courier Prime', category: 'Screenplay Standard', scripts: ['latin'], source: 'google', direction: 'ltr' },

  // Latin Extended
  { name: 'Noto Sans', category: 'Latin Extended', scripts: ['latin', 'cyrillic', 'greek'], source: 'google', direction: 'ltr' },
  { name: 'Noto Serif', category: 'Latin Extended', scripts: ['latin', 'cyrillic', 'greek'], source: 'google', direction: 'ltr' },
  { name: 'Roboto', category: 'Latin Extended', scripts: ['latin', 'cyrillic', 'greek'], source: 'google', direction: 'ltr' },

  // Indian / Indic
  { name: 'Noto Sans Devanagari', category: 'Indian / Indic', scripts: ['devanagari'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Bengali', category: 'Indian / Indic', scripts: ['bengali'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Tamil', category: 'Indian / Indic', scripts: ['tamil'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Telugu', category: 'Indian / Indic', scripts: ['telugu'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Kannada', category: 'Indian / Indic', scripts: ['kannada'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Malayalam', category: 'Indian / Indic', scripts: ['malayalam'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Gujarati', category: 'Indian / Indic', scripts: ['gujarati'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Gurmukhi', category: 'Indian / Indic', scripts: ['gurmukhi'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Oriya', category: 'Indian / Indic', scripts: ['oriya'], source: 'google', direction: 'ltr' },

  // Arabic & Hebrew
  { name: 'Noto Sans Arabic', category: 'Arabic & Hebrew', scripts: ['arabic'], source: 'google', direction: 'rtl' },
  { name: 'Noto Naskh Arabic', category: 'Arabic & Hebrew', scripts: ['arabic'], source: 'google', direction: 'rtl' },
  { name: 'Noto Sans Hebrew', category: 'Arabic & Hebrew', scripts: ['hebrew'], source: 'google', direction: 'rtl' },

  // CJK
  { name: 'Noto Sans JP', category: 'CJK', scripts: ['cjk-ja'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans SC', category: 'CJK', scripts: ['cjk-zh-hans'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans TC', category: 'CJK', scripts: ['cjk-zh-hant'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans KR', category: 'CJK', scripts: ['cjk-ko'], source: 'google', direction: 'ltr' },

  // Other
  { name: 'Noto Sans Thai', category: 'Other', scripts: ['thai'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Georgian', category: 'Other', scripts: ['georgian'], source: 'google', direction: 'ltr' },
  { name: 'Noto Sans Armenian', category: 'Other', scripts: ['armenian'], source: 'google', direction: 'ltr' },
];

// Dynamically load a Google Font
const loadedFonts = new Set<string>();
export function loadFont(entry: FontEntry): void {
  if (entry.source !== 'google' || loadedFonts.has(entry.name)) return;
  loadedFonts.add(entry.name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(entry.name)}&display=swap`;
  document.head.appendChild(link);
}

export function getFontsByCategory(): Record<string, FontEntry[]> {
  const result: Record<string, FontEntry[]> = {};
  for (const cat of FONT_CATEGORIES) {
    result[cat] = FONT_REGISTRY.filter(f => f.category === cat);
  }
  return result;
}
