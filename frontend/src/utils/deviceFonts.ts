/**
 * The fonts already installed on this machine.
 *
 * OpenDraft's registry lists faces it expects an operating system to have —
 * Calibri and Segoe UI on Windows, Avenir and Optima on macOS — and most of
 * them are missing on the other platforms. Offering them all without saying
 * which are real means a writer picks a font, sees Courier, and has no idea
 * why. So availability is measured, and the picker says so.
 *
 * Two ways of finding out, in order of how much they can tell us:
 *
 *  1. `queryLocalFonts()` — Chromium only, needs a permission the writer
 *     grants once. Returns the machine's whole font book, so a font installed
 *     from a foundry shows up without being uploaded anywhere.
 *  2. Measuring — works everywhere, including the WebKit views Tauri uses on
 *     macOS and iOS, but can only answer "is *this* name installed?", so it is
 *     run over a list of faces worth asking about.
 *
 * Neither exists under a test runner, where every probe is answered "yes"
 * rather than pretending the machine has no fonts at all.
 */
import { type FontEntry, FONT_REGISTRY, setDynamicFonts, genericFor } from './fonts';

/** A string with wide and narrow letters, so a substitution shows up in the width. */
const PROBE_TEXT = 'mmmmmmmmmmlliWWM@1234567890';
const PROBE_SIZE = '72px';
/** Measuring against all three catches a face that happens to match one of them. */
const BASE_FAMILIES = ['monospace', 'serif', 'sans-serif'] as const;

let ctx: CanvasRenderingContext2D | null | undefined;
const baseWidths = new Map<string, number>();
const probeCache = new Map<string, boolean>();

function getContext(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d');
    // jsdom returns a context whose measureText always reports 0 — useless for
    // a comparison, and indistinguishable from "no font at all".
    ctx = c && typeof c.measureText === 'function' && c.measureText('m').width > 0 ? c : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

function widthIn(family: string): number {
  const c = getContext();
  if (!c) return 0;
  c.font = `${PROBE_SIZE} ${family}`;
  return c.measureText(PROBE_TEXT).width;
}

function cssName(name: string): string {
  return JSON.stringify(name);
}

/**
 * Whether this machine can actually render the named family.
 *
 * True when the browser cannot be asked — an unmeasurable environment must not
 * report the writer's fonts as missing.
 */
export function isFontInstalled(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;
  if (!getContext()) return true;

  let installed = false;
  for (const base of BASE_FAMILIES) {
    if (!baseWidths.has(base)) baseWidths.set(base, widthIn(base));
    const baseline = baseWidths.get(base)!;
    if (widthIn(`${cssName(name)}, ${base}`) !== baseline) {
      installed = true;
      break;
    }
  }
  probeCache.set(key, installed);
  return installed;
}

/**
 * Faces worth asking about, beyond the ones the registry already names.
 *
 * Deliberately a list of things a writer might reach for — the fonts Word and
 * Final Draft users know — rather than everything an OS ships. The full font
 * book is what `requestLocalFonts` is for.
 */
const PROBE_CANDIDATES = [
  // macOS
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Arial Black', 'Arial Narrow',
  'Arial Rounded MT Bold', 'Avenir Next', 'Baskerville', 'Big Caslon', 'Bodoni 72',
  'Brush Script MT', 'Chalkboard', 'Chalkduster', 'Cochin', 'Copperplate', 'Didot',
  'Geneva', 'Hoefler Text', 'Iowan Old Style', 'Lucida Grande', 'Marker Felt',
  'Menlo', 'Noteworthy', 'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'Savoye LET',
  'SignPainter', 'Skia', 'Snell Roundhand', 'Superclarendon', 'Times', 'Trattatello',
  'Zapfino',
  // Windows
  'Arial Unicode MS', 'Bahnschrift', 'Bell MT', 'Bookman Old Style', 'Bradley Hand',
  'Britannic Bold', 'Broadway', 'Calisto MT', 'Castellar', 'Centaur', 'Century',
  'Century Schoolbook', 'Comic Sans MS', 'Consolas', 'Constantia', 'Cooper Black',
  'Copperplate Gothic Bold', 'Curlz MT', 'Ebrima', 'Engravers MT', 'Eras Bold ITC',
  'Footlight MT Light', 'Garamond', 'Gabriola', 'Georgia Pro', 'Gigi', 'Gloucester MT Extra Condensed',
  'Goudy Old Style', 'Haettenschweiler', 'Harrington', 'High Tower Text', 'Impact',
  'Imprint MT Shadow', 'Informal Roman', 'Ink Free', 'Javanese Text', 'Jokerman',
  'Juice ITC', 'Kristen ITC', 'Leelawadee UI', 'Lucida Bright', 'Lucida Calligraphy',
  'Lucida Handwriting', 'Lucida Sans Unicode', 'Magneto', 'Maiandra GD', 'Malgun Gothic',
  'Matura MT Script Capitals', 'Microsoft Sans Serif', 'Modern No. 20', 'Mongolian Baiti',
  'Monotype Corsiva', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Niagara Solid',
  'Nirmala UI', 'OCR A Extended', 'Old English Text MT', 'Onyx', 'Palace Script MT',
  'Papyrus', 'Parchment', 'Perpetua', 'Playbill', 'Poor Richard', 'Pristina',
  'Rage Italic', 'Ravie', 'Rockwell Extra Bold', 'Script MT Bold', 'Segoe Print',
  'Segoe Script', 'Segoe UI Emoji', 'Showcard Gothic', 'SimSun', 'Sitka Text',
  'Snap ITC', 'Stencil', 'Sylfaen', 'Tempus Sans ITC', 'Tw Cen MT', 'Viner Hand ITC',
  'Vivaldi', 'Vladimir Script', 'Wide Latin', 'Yu Gothic',
  // Screenplay faces installed by other apps
  'Courier Final Draft', 'Courier Screenplay', 'Courier Prime Sans', 'Courier Prime Code',
  'Prestige Elite Std', 'Letter Gothic Std', 'Nimbus Mono PS',
  // Linux / free desktops
  'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Mono',
  'Liberation Sans', 'Liberation Serif', 'Nimbus Roman', 'Nimbus Sans', 'Ubuntu',
  'URW Bookman', 'FreeSerif', 'Noto Color Emoji',
];

function toDeviceEntry(name: string): FontEntry {
  return {
    name,
    category: 'On This Device',
    scripts: ['latin'],
    source: 'device',
    direction: 'ltr',
    generic: genericFor(name),
  };
}

let detected = false;

/**
 * Fill the "On This Device" group by measuring, and record which of the
 * registry's system faces are really here.
 *
 * Cheap enough to run at startup — a few hundred canvas measurements — but
 * idempotent, so repeated calls cost nothing.
 */
export function detectDeviceFonts(): FontEntry[] {
  if (detected) return [];
  detected = true;
  // Nothing can be measured here, and `isFontInstalled` answers "yes" to
  // everything so the picker stays usable. Listing all of it as found would
  // fill the picker with fonts this machine hasn't got.
  if (!getContext()) return [];

  // Warm the availability cache for the registry's own system faces, so the
  // picker can grey out the ones this platform hasn't got.
  for (const entry of FONT_REGISTRY) {
    if (entry.source === 'system') isFontInstalled(entry.name);
  }

  const known = new Set(FONT_REGISTRY.map((f) => f.name.toLowerCase()));
  const found = PROBE_CANDIDATES
    .filter((name) => !known.has(name.toLowerCase()) && isFontInstalled(name))
    .sort((a, b) => a.localeCompare(b))
    .map(toDeviceEntry);

  setDynamicFonts('device', found);
  return found;
}

interface LocalFontData { family: string; fullName?: string; style?: string }

/** Chromium's local font access API, which no type library declares yet. */
type FontAccessWindow = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> };

/** Whether the browser can hand over the machine's full font book on request. */
export function canQueryLocalFonts(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as FontAccessWindow).queryLocalFonts === 'function';
}

/**
 * Ask the browser for every font installed, which needs the writer's
 * permission and so must be called from a click.
 *
 * Returns the number of families added, or throws with a message worth showing
 * — a refused permission is a normal outcome, not a bug.
 */
export async function requestLocalFonts(): Promise<number> {
  if (!canQueryLocalFonts()) {
    throw new Error('This platform cannot list installed fonts. Add font files instead.');
  }
  let fonts: LocalFontData[];
  try {
    fonts = await (window as FontAccessWindow).queryLocalFonts!();
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'SecurityError' || name === 'NotAllowedError') {
      throw new Error('Permission to read installed fonts was declined.');
    }
    throw new Error(`Could not read installed fonts: ${(err as Error)?.message || String(err)}`);
  }

  const known = new Set(FONT_REGISTRY.map((f) => f.name.toLowerCase()));
  const families = new Map<string, string>();
  for (const font of fonts) {
    const family = (font.family || '').trim();
    if (!family) continue;
    const key = family.toLowerCase();
    if (known.has(key) || families.has(key)) continue;
    families.set(key, family);
    probeCache.set(key, true);
  }

  const entries = [...families.values()].sort((a, b) => a.localeCompare(b)).map(toDeviceEntry);
  setDynamicFonts('device', entries);
  detected = true;
  return entries.length;
}
