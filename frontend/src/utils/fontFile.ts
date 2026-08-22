/**
 * Reading a font file well enough to name it.
 *
 * A writer who installs `HelveticaNeue-CondensedBold.otf` has to end up with
 * "Helvetica Neue" in the picker, not the filename — because the family name is
 * what gets written into the document, and it is the only thing another machine
 * has to go on when the font itself isn't there. Getting it from the file, the
 * way every other application does, is what makes a script portable.
 *
 * Enough of the sfnt container is parsed to read the `name` table: the four
 * bytes of tag directory, then the records. WOFF and WOFF2 are compressed, so
 * their names cannot be read this way — those fall back to the filename, which
 * a browser can still render because `FontFace` decodes them itself.
 */

export interface FontFileInfo {
  /** The family a document should record — "Courier Prime", not "CourierPrime-Bold". */
  family: string;
  /** "Bold Italic", "Regular", … as the file describes itself. */
  subfamily: string;
  weight: number;
  italic: boolean;
  /** Whether the family name was read from the file or guessed from its name. */
  fromFile: boolean;
}

const SFNT_TTF = 0x00010000;
const SFNT_OTTO = 0x4f54544f; // 'OTTO'
const SFNT_TRUE = 0x74727565; // 'true'
const SFNT_TTCF = 0x74746366; // 'ttcf'

/** Name table IDs, in the order we would rather have them. */
const NAME_TYPOGRAPHIC_FAMILY = 16;
const NAME_FAMILY = 1;
const NAME_TYPOGRAPHIC_SUBFAMILY = 17;
const NAME_SUBFAMILY = 2;

export class FontFileError extends Error {}

function decodeName(view: DataView, offset: number, length: number, platformId: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  // Platform 3 (Windows) and platform 0 (Unicode) store UTF-16BE; platform 1
  // (Macintosh) stores single bytes, which are ASCII for every name we read.
  if (platformId === 1) {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out.trim();
  }
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return out.trim();
}

const LANG_WINDOWS_EN_US = 0x0409;
const LANG_MAC_ENGLISH = 0;

/**
 * How much we want a particular name record, lowest first.
 *
 * The language matters as much as the platform. A `name` table carries the same
 * nameID once per language the foundry translated it into, and macOS ships
 * fonts whose first Windows record is Spanish: `Times New Roman Bold.ttf` calls
 * its subfamily "Negreta", and reading that one left every bold weight in the
 * system font folder recorded as regular. English records are the ones
 * `styleFromSubfamily` can read.
 */
function preference(platformId: number, languageId: number): number {
  if (platformId === 3) return languageId === LANG_WINDOWS_EN_US ? 0 : 3;
  if (platformId === 1) return languageId === LANG_MAC_ENGLISH ? 1 : 4;
  if (platformId === 0) return 2; // Unicode: no platform-specific language ids
  return 5;
}

/**
 * Read the `name` table entries we care about, in English where the font has
 * an English name at all — falling back through the other languages rather
 * than reporting nothing.
 */
function readNameTable(view: DataView, tableOffset: number): Map<number, string> {
  const names = new Map<number, string>();
  const best = new Map<number, number>(); // nameID -> preference of what we took

  const count = view.getUint16(tableOffset + 2);
  const stringOffset = tableOffset + view.getUint16(tableOffset + 4);
  const recordsStart = tableOffset + 6;

  for (let i = 0; i < count; i++) {
    const record = recordsStart + i * 12;
    if (record + 12 > view.byteLength) break;
    const platformId = view.getUint16(record);
    const languageId = view.getUint16(record + 4);
    const nameId = view.getUint16(record + 6);
    const length = view.getUint16(record + 8);
    const offset = stringOffset + view.getUint16(record + 10);
    if (offset + length > view.byteLength) continue;

    const rank = preference(platformId, languageId);
    const previous = best.get(nameId);
    if (previous !== undefined && previous <= rank) continue;

    const value = decodeName(view, offset, length, platformId);
    if (!value) continue;
    names.set(nameId, value);
    best.set(nameId, rank);
  }
  return names;
}

function familyFromFilename(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/\s*(regular|book|roman|bold|italic|oblique|light|medium|black|thin|semibold|extrabold|condensed)\b/gi, '')
    .trim() || stem;
}

function styleFromSubfamily(subfamily: string): { weight: number; italic: boolean } {
  const s = subfamily.toLowerCase();
  const italic = /italic|oblique/.test(s);
  let weight = 400;
  if (/\bthin\b|hairline/.test(s)) weight = 100;
  else if (/extralight|ultralight/.test(s)) weight = 200;
  else if (/\blight\b/.test(s)) weight = 300;
  else if (/\bmedium\b/.test(s)) weight = 500;
  else if (/semibold|demibold/.test(s)) weight = 600;
  else if (/extrabold|ultrabold/.test(s)) weight = 800;
  else if (/black|heavy/.test(s)) weight = 900;
  else if (/\bbold\b/.test(s)) weight = 700;
  return { weight, italic };
}

/**
 * What a font file calls itself.
 *
 * Never throws for a readable file that simply isn't an sfnt — a WOFF the
 * browser can render still gets a usable name from its filename. It throws only
 * when the bytes are not a font at all, which is worth telling the writer.
 */
export function readFontFileInfo(bytes: ArrayBuffer, fileName: string): FontFileInfo {
  const fallback = (): FontFileInfo => {
    const family = familyFromFilename(fileName);
    const { weight, italic } = styleFromSubfamily(fileName);
    return { family, subfamily: italic || weight !== 400 ? 'Derived' : 'Regular', weight, italic, fromFile: false };
  };

  if (bytes.byteLength < 12) throw new FontFileError('That file is too small to be a font.');
  const view = new DataView(bytes);
  const tag = view.getUint32(0);

  // wOFF / wOF2 — compressed, so the name table is out of reach here.
  if (tag === 0x774f4646 || tag === 0x774f4632) return fallback();
  if (tag !== SFNT_TTF && tag !== SFNT_OTTO && tag !== SFNT_TRUE && tag !== SFNT_TTCF) {
    throw new FontFileError('That file is not a TrueType or OpenType font.');
  }

  try {
    // A TrueType collection holds several fonts in one file, sharing glyphs.
    // Its header is a list of offsets to ordinary table directories, so reading
    // the first one gives the family — macOS ships 79 of these in its font
    // folder, and guessing all of their names from filenames threw away the
    // weight and slant of every one.
    let directory = 0;
    if (tag === SFNT_TTCF) {
      if (view.byteLength < 16 || view.getUint32(8) === 0) return fallback();
      directory = view.getUint32(12);
      if (directory + 12 > view.byteLength) return fallback();
    }

    const numTables = view.getUint16(directory + 4);
    let nameOffset = 0;
    for (let i = 0; i < numTables; i++) {
      const record = directory + 12 + i * 16;
      if (record + 16 > view.byteLength) break;
      const tableTag = view.getUint32(record);
      if (tableTag === 0x6e616d65) { // 'name'
        nameOffset = view.getUint32(record + 8);
        break;
      }
    }
    if (!nameOffset || nameOffset + 6 > view.byteLength) return fallback();

    const names = readNameTable(view, nameOffset);
    const family = names.get(NAME_TYPOGRAPHIC_FAMILY) || names.get(NAME_FAMILY);
    if (!family) return fallback();
    const subfamily = names.get(NAME_TYPOGRAPHIC_SUBFAMILY) || names.get(NAME_SUBFAMILY) || 'Regular';
    const { weight, italic } = styleFromSubfamily(subfamily);
    return { family, subfamily, weight, italic, fromFile: true };
  } catch {
    // A malformed table is not worth refusing the file over — the browser may
    // still render it, and the filename gives us something to call it.
    return fallback();
  }
}
