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

/**
 * The shape a face belongs to — what a reader on another machine should get
 * when the font itself isn't there.
 *
 * This is the whole of OpenDraft's cross-platform story for fonts: a document
 * records the family it was written in, and every renderer here turns that name
 * into a stack ending in the right generic. A script set in Bebas Neue opened
 * offline is still a display-weight title page, not Courier.
 */
export type FontGeneric = 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy';

export interface FontEntry {
  name: string;
  category: string;
  scripts: string[];
  /**
   * Where the bytes come from:
   *  - `local`   bundled with the app, always present
   *  - `system`  expected from the OS; may be missing on another platform
   *  - `google`  fetched from Google Fonts on first use
   *  - `device`  found installed on this machine (see utils/deviceFonts)
   *  - `custom`  a TTF/OTF the writer installed (see services/customFonts)
   */
  source: 'local' | 'system' | 'google' | 'device' | 'custom';
  direction: 'ltr' | 'rtl';
  generic: FontGeneric;
  /**
   * Google Fonts css2 axis spec, for families that ship real bold and italic
   * cuts rather than leaving the browser to synthesise them. A wrong guess is
   * harmless — `loadFont` retries without it if the stylesheet 404s.
   */
  axes?: string;
  googleUrl?: string;
}

export const FONT_CATEGORIES = [
  'Custom Fonts',
  'Screenplay Standard',
  'Typewriter',
  'Serif',
  'Sans Serif',
  'Monospace',
  'Display & Titles',
  'Handwriting',
  'Latin Extended',
  'Indian / Indic',
  'Arabic & Hebrew',
  'CJK',
  'Other',
  'On This Device',
] as const;

/** Families with regular, bold, italic and bold-italic cuts on Google Fonts. */
const ROMAN_AND_ITALIC = 'ital,wght@0,400;0,700;1,400;1,700';
/** Families with weights but no italic. */
const BOLD_ONLY = 'wght@400;700';

type EntryOpts = Partial<Pick<FontEntry, 'scripts' | 'direction' | 'axes'>>;

function make(
  source: FontEntry['source'],
  name: string,
  category: string,
  generic: FontGeneric,
  opts: EntryOpts = {},
): FontEntry {
  return {
    name,
    category,
    generic,
    source,
    scripts: opts.scripts ?? ['latin'],
    direction: opts.direction ?? 'ltr',
    ...(opts.axes ? { axes: opts.axes } : {}),
  };
}

/** Shipped in `public/fonts` — present whether or not there is a network. */
const bundled = (n: string, c: string, g: FontGeneric, o?: EntryOpts) => make('local', n, c, g, o);
/** Expected from the operating system. Availability is checked, not assumed. */
const os = (n: string, c: string, g: FontGeneric, o?: EntryOpts) => make('system', n, c, g, o);
/** Fetched from Google Fonts the first time it is used. */
const web = (n: string, c: string, g: FontGeneric, o?: EntryOpts) => make('google', n, c, g, o);

export const FONT_REGISTRY: FontEntry[] = [
  // ── Screenplay Standard ───────────────────────────────────────────────────
  // Courier 12pt is what a screenplay is. Courier Prime is bundled so it is
  // the one face that renders identically on every platform, online or not.
  bundled('Courier Prime', 'Screenplay Standard', 'monospace'),
  os('Courier New', 'Screenplay Standard', 'monospace'),
  os('Courier', 'Screenplay Standard', 'monospace'),
  os('Courier Final Draft', 'Screenplay Standard', 'monospace'),
  os('Courier Screenplay', 'Screenplay Standard', 'monospace'),
  os('Arial', 'Screenplay Standard', 'sans-serif'),

  // ── Typewriter ────────────────────────────────────────────────────────────
  // Faces with the character of a typed page, for scripts and title pages that
  // want more than Courier. All fall back to Courier when unavailable.
  web('Special Elite', 'Typewriter', 'monospace'),
  web('Cutive Mono', 'Typewriter', 'monospace'),
  web('Xanh Mono', 'Typewriter', 'monospace'),
  web('Nova Mono', 'Typewriter', 'monospace'),
  web('Share Tech Mono', 'Typewriter', 'monospace'),
  web('Syne Mono', 'Typewriter', 'monospace'),
  web('VT323', 'Typewriter', 'monospace'),

  // ── Serif ─────────────────────────────────────────────────────────────────
  os('Times New Roman', 'Serif', 'serif'),
  os('Georgia', 'Serif', 'serif'),
  os('Garamond', 'Serif', 'serif'),
  os('Cambria', 'Serif', 'serif'),
  os('Palatino Linotype', 'Serif', 'serif'),
  os('Book Antiqua', 'Serif', 'serif'),
  os('Baskerville', 'Serif', 'serif'),
  web('EB Garamond', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Libre Baskerville', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Merriweather', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Lora', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('PT Serif', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Playfair Display', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Crimson Text', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Source Serif 4', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Spectral', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Vollkorn', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Bitter', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Zilla Slab', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Alegreya', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Cormorant Garamond', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Literata', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Arvo', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Cardo', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
  web('Domine', 'Serif', 'serif', { axes: BOLD_ONLY }),
  web('Bree Serif', 'Serif', 'serif'),

  // ── Sans Serif ────────────────────────────────────────────────────────────
  os('Helvetica', 'Sans Serif', 'sans-serif'),
  os('Helvetica Neue', 'Sans Serif', 'sans-serif'),
  os('Verdana', 'Sans Serif', 'sans-serif'),
  os('Tahoma', 'Sans Serif', 'sans-serif'),
  os('Trebuchet MS', 'Sans Serif', 'sans-serif'),
  os('Calibri', 'Sans Serif', 'sans-serif'),
  os('Segoe UI', 'Sans Serif', 'sans-serif'),
  os('Century Gothic', 'Sans Serif', 'sans-serif'),
  os('Franklin Gothic Medium', 'Sans Serif', 'sans-serif'),
  os('Gill Sans', 'Sans Serif', 'sans-serif'),
  os('Futura', 'Sans Serif', 'sans-serif'),
  os('Optima', 'Sans Serif', 'sans-serif'),
  os('Avenir', 'Sans Serif', 'sans-serif'),
  os('Candara', 'Sans Serif', 'sans-serif'),
  os('Corbel', 'Sans Serif', 'sans-serif'),
  web('Open Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Lato', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Montserrat', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Source Sans 3', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Nunito', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Nunito Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Raleway', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Poppins', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Work Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Inter', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Rubik', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Karla', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Mulish', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Fira Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('PT Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Barlow', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Cabin', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Josefin Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Archivo', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Public Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('DM Sans', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Figtree', 'Sans Serif', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Manrope', 'Sans Serif', 'sans-serif', { axes: BOLD_ONLY }),
  web('Quicksand', 'Sans Serif', 'sans-serif', { axes: BOLD_ONLY }),
  web('Outfit', 'Sans Serif', 'sans-serif', { axes: BOLD_ONLY }),
  web('Oswald', 'Sans Serif', 'sans-serif', { axes: BOLD_ONLY }),

  // ── Monospace ─────────────────────────────────────────────────────────────
  os('Consolas', 'Monospace', 'monospace'),
  os('Menlo', 'Monospace', 'monospace'),
  os('Monaco', 'Monospace', 'monospace'),
  os('Lucida Console', 'Monospace', 'monospace'),
  os('Andale Mono', 'Monospace', 'monospace'),
  web('Roboto Mono', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('IBM Plex Mono', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('JetBrains Mono', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('Source Code Pro', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('Space Mono', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('Anonymous Pro', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('Ubuntu Mono', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('DM Mono', 'Monospace', 'monospace'),
  web('Inconsolata', 'Monospace', 'monospace', { axes: BOLD_ONLY }),
  web('Fira Mono', 'Monospace', 'monospace', { axes: BOLD_ONLY }),
  web('PT Mono', 'Monospace', 'monospace'),
  web('Overpass Mono', 'Monospace', 'monospace', { axes: BOLD_ONLY }),
  web('Red Hat Mono', 'Monospace', 'monospace', { axes: ROMAN_AND_ITALIC }),
  web('Nanum Gothic Coding', 'Monospace', 'monospace', { axes: BOLD_ONLY }),

  // ── Display & Titles ──────────────────────────────────────────────────────
  // For title pages and anything outside standard screenplay formatting.
  web('Bebas Neue', 'Display & Titles', 'sans-serif'),
  web('Anton', 'Display & Titles', 'sans-serif'),
  web('Archivo Black', 'Display & Titles', 'sans-serif'),
  web('Fjalla One', 'Display & Titles', 'sans-serif'),
  web('Staatliches', 'Display & Titles', 'sans-serif'),
  web('Teko', 'Display & Titles', 'sans-serif', { axes: BOLD_ONLY }),
  web('Six Caps', 'Display & Titles', 'sans-serif'),
  web('Righteous', 'Display & Titles', 'fantasy'),
  web('Abril Fatface', 'Display & Titles', 'serif'),
  web('Alfa Slab One', 'Display & Titles', 'serif'),
  web('Ultra', 'Display & Titles', 'serif'),
  web('Yeseva One', 'Display & Titles', 'serif'),
  web('Cinzel', 'Display & Titles', 'serif', { axes: BOLD_ONLY }),
  web('Cinzel Decorative', 'Display & Titles', 'serif', { axes: BOLD_ONLY }),
  web('Marcellus', 'Display & Titles', 'serif'),
  web('Philosopher', 'Display & Titles', 'sans-serif', { axes: ROMAN_AND_ITALIC }),
  web('Limelight', 'Display & Titles', 'fantasy'),
  web('Lobster', 'Display & Titles', 'fantasy'),
  web('Monoton', 'Display & Titles', 'fantasy'),
  web('Bungee', 'Display & Titles', 'fantasy'),
  web('Orbitron', 'Display & Titles', 'sans-serif', { axes: BOLD_ONLY }),
  web('Press Start 2P', 'Display & Titles', 'monospace'),
  web('Rye', 'Display & Titles', 'fantasy'),
  web('Creepster', 'Display & Titles', 'fantasy'),
  web('Metal Mania', 'Display & Titles', 'fantasy'),
  web('Bangers', 'Display & Titles', 'fantasy'),

  // ── Handwriting ───────────────────────────────────────────────────────────
  web('Caveat', 'Handwriting', 'cursive', { axes: BOLD_ONLY }),
  web('Dancing Script', 'Handwriting', 'cursive', { axes: BOLD_ONLY }),
  web('Great Vibes', 'Handwriting', 'cursive'),
  web('Pacifico', 'Handwriting', 'cursive'),
  web('Satisfy', 'Handwriting', 'cursive'),
  web('Sacramento', 'Handwriting', 'cursive'),
  web('Permanent Marker', 'Handwriting', 'cursive'),
  web('Shadows Into Light', 'Handwriting', 'cursive'),
  web('Indie Flower', 'Handwriting', 'cursive'),
  web('Amatic SC', 'Handwriting', 'cursive', { axes: BOLD_ONLY }),
  web('Kalam', 'Handwriting', 'cursive', { axes: BOLD_ONLY, scripts: ['latin', 'devanagari'] }),
  web('Patrick Hand', 'Handwriting', 'cursive'),
  web('Architects Daughter', 'Handwriting', 'cursive'),
  web('Rock Salt', 'Handwriting', 'cursive'),
  web('Homemade Apple', 'Handwriting', 'cursive'),
  web('Gloria Hallelujah', 'Handwriting', 'cursive'),

  // ── Latin Extended ────────────────────────────────────────────────────────
  web('Noto Sans', 'Latin Extended', 'sans-serif', { scripts: ['latin', 'cyrillic', 'greek'], axes: ROMAN_AND_ITALIC }),
  web('Noto Serif', 'Latin Extended', 'serif', { scripts: ['latin', 'cyrillic', 'greek'], axes: ROMAN_AND_ITALIC }),
  web('Roboto', 'Latin Extended', 'sans-serif', { scripts: ['latin', 'cyrillic', 'greek'], axes: ROMAN_AND_ITALIC }),
  web('Noto Sans Mono', 'Latin Extended', 'monospace', { scripts: ['latin', 'cyrillic', 'greek'], axes: BOLD_ONLY }),

  // ── Indian / Indic ────────────────────────────────────────────────────────
  web('Noto Sans Devanagari', 'Indian / Indic', 'sans-serif', { scripts: ['devanagari'] }),
  web('Noto Serif Devanagari', 'Indian / Indic', 'serif', { scripts: ['devanagari'] }),
  web('Noto Sans Bengali', 'Indian / Indic', 'sans-serif', { scripts: ['bengali'] }),
  web('Noto Sans Tamil', 'Indian / Indic', 'sans-serif', { scripts: ['tamil'] }),
  web('Noto Sans Telugu', 'Indian / Indic', 'sans-serif', { scripts: ['telugu'] }),
  web('Noto Sans Kannada', 'Indian / Indic', 'sans-serif', { scripts: ['kannada'] }),
  web('Noto Sans Malayalam', 'Indian / Indic', 'sans-serif', { scripts: ['malayalam'] }),
  web('Noto Sans Gujarati', 'Indian / Indic', 'sans-serif', { scripts: ['gujarati'] }),
  web('Noto Sans Gurmukhi', 'Indian / Indic', 'sans-serif', { scripts: ['gurmukhi'] }),
  web('Noto Sans Oriya', 'Indian / Indic', 'sans-serif', { scripts: ['oriya'] }),
  web('Noto Sans Sinhala', 'Indian / Indic', 'sans-serif', { scripts: ['sinhala'] }),

  // ── Arabic & Hebrew ───────────────────────────────────────────────────────
  web('Noto Sans Arabic', 'Arabic & Hebrew', 'sans-serif', { scripts: ['arabic'], direction: 'rtl' }),
  web('Noto Naskh Arabic', 'Arabic & Hebrew', 'serif', { scripts: ['arabic'], direction: 'rtl' }),
  web('Noto Kufi Arabic', 'Arabic & Hebrew', 'sans-serif', { scripts: ['arabic'], direction: 'rtl' }),
  web('Noto Nastaliq Urdu', 'Arabic & Hebrew', 'serif', { scripts: ['arabic'], direction: 'rtl' }),
  web('Noto Sans Hebrew', 'Arabic & Hebrew', 'sans-serif', { scripts: ['hebrew'], direction: 'rtl' }),
  web('Noto Serif Hebrew', 'Arabic & Hebrew', 'serif', { scripts: ['hebrew'], direction: 'rtl' }),

  // ── CJK ───────────────────────────────────────────────────────────────────
  web('Noto Sans JP', 'CJK', 'sans-serif', { scripts: ['cjk-ja'] }),
  web('Noto Serif JP', 'CJK', 'serif', { scripts: ['cjk-ja'] }),
  web('Noto Sans SC', 'CJK', 'sans-serif', { scripts: ['cjk-zh-hans'] }),
  web('Noto Serif SC', 'CJK', 'serif', { scripts: ['cjk-zh-hans'] }),
  web('Noto Sans TC', 'CJK', 'sans-serif', { scripts: ['cjk-zh-hant'] }),
  web('Noto Sans KR', 'CJK', 'sans-serif', { scripts: ['cjk-ko'] }),
  web('Noto Serif KR', 'CJK', 'serif', { scripts: ['cjk-ko'] }),

  // ── Other ─────────────────────────────────────────────────────────────────
  web('Noto Sans Thai', 'Other', 'sans-serif', { scripts: ['thai'] }),
  web('Noto Sans Georgian', 'Other', 'sans-serif', { scripts: ['georgian'] }),
  web('Noto Sans Armenian', 'Other', 'sans-serif', { scripts: ['armenian'] }),
  web('Noto Sans Khmer', 'Other', 'sans-serif', { scripts: ['khmer'] }),
  web('Noto Sans Lao', 'Other', 'sans-serif', { scripts: ['lao'] }),
  web('Noto Sans Myanmar', 'Other', 'sans-serif', { scripts: ['myanmar'] }),
  web('Noto Sans Ethiopic', 'Other', 'sans-serif', { scripts: ['ethiopic'] }),
  web('Noto Sans Greek', 'Other', 'sans-serif', { scripts: ['greek'] }),
];

// ── Fonts discovered at runtime ─────────────────────────────────────────────
//
// Custom TTF/OTF files the writer installed, and faces found on the machine.
// They live outside FONT_REGISTRY because they differ from one device to the
// next; everything that reads the registry reads `getAllFonts()` instead, and
// re-reads it when `subscribeFonts` fires.

type DynamicSource = 'custom' | 'device';

const dynamicFonts: Record<DynamicSource, FontEntry[]> = { custom: [], device: [] };
const fontListeners = new Set<() => void>();
let fontsVersion = 0;

/** Bumped whenever the font list changes, for `useSyncExternalStore` snapshots. */
export function getFontsVersion(): number {
  return fontsVersion;
}

/** Replace the runtime-discovered fonts of one kind, and notify the UI. */
export function setDynamicFonts(source: DynamicSource, entries: FontEntry[]): void {
  dynamicFonts[source] = entries;
  nameIndex = null;
  fontsVersion += 1;
  for (const listener of fontListeners) {
    try {
      listener();
    } catch (err) {
      console.warn('[fonts] listener failed', err);
    }
  }
}

export function subscribeFonts(listener: () => void): () => void {
  fontListeners.add(listener);
  return () => { fontListeners.delete(listener); };
}

/** Built-in fonts plus whatever this device turned out to have. */
export function getAllFonts(): FontEntry[] {
  return [...dynamicFonts.custom, ...FONT_REGISTRY, ...dynamicFonts.device];
}

/**
 * Name → entry, rebuilt only when the runtime font list changes.
 *
 * `genericFor` runs once per formatting rule per stylesheet rebuild, so this is
 * on a hot path — a linear scan of ~180 entries each time was measurable.
 */
let nameIndex: Map<string, FontEntry> | null = null;

function byLowerName(): Map<string, FontEntry> {
  if (nameIndex) return nameIndex;
  const map = new Map<string, FontEntry>();
  for (const entry of getAllFonts()) {
    const key = entry.name.toLowerCase();
    if (!map.has(key)) map.set(key, entry);
  }
  nameIndex = map;
  return map;
}

export function findFont(name: string | null | undefined): FontEntry | undefined {
  if (!name) return undefined;
  return byLowerName().get(name.trim().toLowerCase());
}

// ── Loading ─────────────────────────────────────────────────────────────────

const loadedFonts = new Set<string>();

/**
 * Make a face renderable.
 *
 * Only Google-hosted families need anything done: a stylesheet link, requested
 * with real bold and italic cuts where the family has them. If that spec is
 * wrong for the family Google answers 404, so the link is retried without it
 * rather than leaving the writer with a font that silently never arrives.
 * Bundled, system, device and custom faces are already there.
 */
export function loadFont(entry: FontEntry): void {
  if (entry.source !== 'google' || loadedFonts.has(entry.name)) return;
  if (typeof document === 'undefined') return;
  loadedFonts.add(entry.name);

  const base = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(entry.name)}`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = entry.axes ? `${base}:${entry.axes}&display=swap` : `${base}&display=swap`;
  if (entry.axes) {
    link.addEventListener('error', () => {
      const plain = document.createElement('link');
      plain.rel = 'stylesheet';
      plain.href = `${base}&display=swap`;
      document.head.appendChild(plain);
    }, { once: true });
  }
  document.head.appendChild(link);
}

/** Load by family name — for fonts arriving from a document rather than a picker. */
export function loadFontByName(name: string | null | undefined): void {
  const entry = findFont(name);
  if (entry) loadFont(entry);
}

/** Load every family a document names, so an imported script renders as written. */
export function loadFonts(names: Iterable<string | null | undefined>): void {
  for (const name of names) loadFontByName(name);
}

// ── Fallback stacks ─────────────────────────────────────────────────────────

/**
 * What a browser should reach for when the named family isn't installed.
 *
 * Every stack ends in a CSS generic, so a document written on a machine that
 * had the font still reads correctly on one that doesn't.
 */
const GENERIC_FALLBACKS: Record<FontGeneric, string[]> = {
  monospace: ["'Courier Prime'", "'Courier New'", 'Courier', 'monospace'],
  serif: ["'Times New Roman'", 'Times', 'serif'],
  'sans-serif': ['Arial', 'Helvetica', 'sans-serif'],
  cursive: ["'Segoe Script'", "'Bradley Hand'", 'cursive'],
  fantasy: ['Impact', "'Arial Black'", 'fantasy'],
};

/**
 * Classify a family we have never heard of — an import from Final Draft, Fade
 * In or Word naming a face from someone else's machine.
 *
 * A screenplay is monospace unless it says otherwise, so that is the default:
 * an unrecognised name falls back to Courier, which is how OpenDraft has always
 * rendered it.
 */
function guessGeneric(family: string): FontGeneric {
  const name = family.toLowerCase();
  if (/courier|mono|consol|typewriter|prestige|letter gothic/.test(name)) return 'monospace';
  if (/script|hand|brush|cursive|italic|calligraph|marker/.test(name)) return 'cursive';
  if (/times|roman|serif|georgia|garamond|palatino|book|minion|cambria|baskerville|caslon|bodoni|didot|century schoolbook/.test(name)) {
    return 'serif';
  }
  if (/arial|helvetica|verdana|tahoma|trebuchet|calibri|segoe|futura|gothic|grotesk|sans|avenir|optima|gill|frutiger|myriad|lucida/.test(name)) {
    return 'sans-serif';
  }
  return 'monospace';
}

/** The shape of a family — from the registry when known, guessed when not. */
export function genericFor(family: string | null | undefined): FontGeneric {
  if (!family || !family.trim()) return 'monospace';
  return findFont(family)?.generic ?? guessGeneric(family);
}

function quote(family: string): string {
  return /^[A-Za-z][A-Za-z0-9 ]*$/.test(family) ? `'${family}'` : JSON.stringify(family);
}

/**
 * A CSS `font-family` value for a family name recorded in a document.
 *
 * This is what carries a font choice across platforms: the name first, then the
 * fallbacks for its shape. A title page set in Cinzel opened on a machine with
 * no network still renders as a serif display face rather than as Courier.
 */
export function fontStack(family: string | null | undefined): string {
  const name = (family || '').trim();
  if (!name) return GENERIC_FALLBACKS.monospace.join(', ');
  // A stack that already carries its own fallbacks (pasted from HTML) is left
  // alone apart from being given a generic to land on.
  if (name.includes(',')) {
    const parts = name.split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1]?.toLowerCase();
    const generic = genericFor(parts[0]);
    if (last && ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].includes(last)) {
      return parts.join(', ');
    }
    return [...parts, ...GENERIC_FALLBACKS[generic]].join(', ');
  }
  const tail = GENERIC_FALLBACKS[genericFor(name)].filter((f) => f !== quote(name));
  return [quote(name), ...tail].join(', ');
}

export function getFontsByCategory(): Record<string, FontEntry[]> {
  const result: Record<string, FontEntry[]> = {};
  const all = getAllFonts();
  for (const cat of FONT_CATEGORIES) {
    result[cat] = all.filter((f) => f.category === cat);
  }
  return result;
}
