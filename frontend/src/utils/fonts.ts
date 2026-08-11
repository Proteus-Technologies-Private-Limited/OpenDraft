/**
 * The interchangeable Couriers.
 *
 * A script written in any of these is already what OpenDraft renders — Courier
 * Prime, which is metric-compatible with them — so importers leave the page
 * font alone for these, and exporters keep to the Final Draft Courier path.
 */
export const COURIER_FONTS = [
  'Courier', 'Courier Screenplay', 'Courier Final Draft', 'Courier Prime', 'Courier New',
];

/**
 * Whether a run's font is simply the document's, and so needs no mark of its
 * own.
 *
 * Both Final Draft and Fade In repeat the document font on individual runs, so
 * without this every character of an imported script would carry a redundant
 * textStyle mark — burying the runs that genuinely differ, and pinning text to
 * a face it never chose.  Files that name no font at all fall back to the
 * Courier family, which is what a screenplay is unless it says otherwise.
 */
export function isDocumentFont(font: string | null | undefined, documentFamily: string): boolean {
  if (!font) return true;
  return documentFamily ? font === documentFamily : COURIER_FONTS.includes(font);
}

/** The same, for point size. Screenplays are 12pt unless the file says otherwise. */
export function isDocumentSize(size: string | null | undefined, documentSize: string): boolean {
  if (!size) return true;
  return size === (documentSize || '12');
}

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
  'System',
  'Latin Extended',
  'Indian / Indic',
  'Arabic & Hebrew',
  'CJK',
  'Other',
] as const;

export const FONT_REGISTRY: FontEntry[] = [
  // Screenplay Standard
  { name: 'Courier Prime', category: 'Screenplay Standard', scripts: ['latin'], source: 'local', direction: 'ltr' },
  { name: 'Courier New', category: 'Screenplay Standard', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Arial', category: 'Screenplay Standard', scripts: ['latin'], source: 'system', direction: 'ltr' },

  // System — fonts shipped with Windows/macOS. Listed so writers can pick them
  // outright, rather than only seeing them after importing a file that uses one.
  // Linux and Android may substitute a metric-compatible face.
  { name: 'Times New Roman', category: 'System', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Georgia', category: 'System', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Helvetica', category: 'System', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Verdana', category: 'System', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Tahoma', category: 'System', scripts: ['latin'], source: 'system', direction: 'ltr' },
  { name: 'Trebuchet MS', category: 'System', scripts: ['latin'], source: 'system', direction: 'ltr' },

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
