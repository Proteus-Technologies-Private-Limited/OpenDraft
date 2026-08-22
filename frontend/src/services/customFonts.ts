/**
 * Fonts the writer installs themselves.
 *
 * A TTF or OTF dropped in here is decoded, kept in IndexedDB, and registered
 * with the page through `FontFace`, so it behaves like any other font in the
 * picker — and, because the bytes are ours, it can also be embedded in an
 * exported PDF, which no Google-hosted face can be.
 *
 * IndexedDB rather than the project store, for the same reasons `scratchAssets`
 * and the spellchecker use it: fonts belong to the machine, not to a document
 * or a project, and they have to be there before the first document is opened.
 *
 * What a document records is only the family name. That is deliberate: a script
 * written in an installed font opens anywhere, showing that font where it is
 * installed and the right kind of fallback where it isn't (see `fontStack`).
 */
import { uuid } from '../utils/uuid';
import { readFontFileInfo, FontFileError } from '../utils/fontFile';
import { setDynamicFonts, genericFor, type FontEntry, type FontGeneric } from '../utils/fonts';

const IDB_NAME = 'opendraft-fonts';
const IDB_STORE = 'fonts';
const IDB_VERSION = 1;

/** Above this a font is almost certainly a CJK collection, and not what a picker wants. */
export const MAX_FONT_BYTES = 20 * 1024 * 1024;

export interface CustomFont {
  id: string;
  family: string;
  subfamily: string;
  weight: number;
  italic: boolean;
  fileName: string;
  size: number;
  addedAt: number;
}

interface StoredFont extends CustomFont {
  bytes: ArrayBuffer;
}

/** Installed fonts, in memory, so exports and the picker need no await. */
const installed = new Map<string, StoredFont>();

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error('This browser has no local storage for fonts.'));
      return;
    }
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the font store.'));
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Font store request failed.'));
  });
}

async function readAll(): Promise<StoredFont[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(IDB_STORE, 'readonly');
    return await runRequest(tx.objectStore(IDB_STORE).getAll() as IDBRequest<StoredFont[]>);
  } finally {
    db.close();
  }
}

async function writeOne(record: StoredFont): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    await runRequest(tx.objectStore(IDB_STORE).put(record) as IDBRequest);
  } finally {
    db.close();
  }
}

async function deleteOne(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    await runRequest(tx.objectStore(IDB_STORE).delete(id) as IDBRequest);
  } finally {
    db.close();
  }
}

// ── Registering with the page ───────────────────────────────────────────────

const registered = new Map<string, FontFace>();

async function register(record: StoredFont): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  if (registered.has(record.id)) return;
  // FontFace takes ownership of the buffer in some engines, so it gets a copy —
  // the original stays available for PDF embedding.
  const face = new FontFace(record.family, record.bytes.slice(0), {
    weight: String(record.weight),
    style: record.italic ? 'italic' : 'normal',
  });
  await face.load();
  document.fonts.add(face);
  registered.set(record.id, face);
}

function unregister(id: string): void {
  const face = registered.get(id);
  if (!face) return;
  try {
    document.fonts.delete(face);
  } catch (err) {
    console.warn('[customFonts] could not unregister face', err);
  }
  registered.delete(id);
}

/**
 * What kind of face this is, asked of the browser now that it is loaded.
 *
 * It decides the fallback a document written in this font gets on a machine
 * that hasn't got it, so getting it wrong is the difference between a title
 * page reading as a display face and reading as Courier.
 *
 * Measuring settles the one question a name cannot: whether every glyph is on
 * the same cell. Beyond that we are down to the family name, and there its
 * default of `monospace` is wrong — that default exists for fonts named in an
 * imported screenplay, where Courier is the right guess. A font the writer
 * installed and the browser has just told us is proportional is not a Courier,
 * so it falls back with the other proportional faces instead.
 */
function detectGeneric(family: string): FontGeneric {
  let proportional = false;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.measureText !== 'function') return genericFor(family);
    ctx.font = `72px ${JSON.stringify(family)}, monospace`;
    const narrow = ctx.measureText('i').width;
    const wide = ctx.measureText('W').width;
    if (narrow > 0 && Math.abs(narrow - wide) < 0.5) return 'monospace';
    proportional = narrow > 0;
  } catch {
    // Nothing measurable — the name is all we have.
    return genericFor(family);
  }
  const named = genericFor(family);
  if (proportional && named === 'monospace') return 'sans-serif';
  return named;
}

function publish(): void {
  const families = new Map<string, FontEntry>();
  for (const record of installed.values()) {
    const key = record.family.toLowerCase();
    if (families.has(key)) continue;
    families.set(key, {
      name: record.family,
      category: 'Custom Fonts',
      scripts: ['latin'],
      source: 'custom',
      direction: 'ltr',
      generic: detectGeneric(record.family),
    });
  }
  setDynamicFonts('custom', [...families.values()].sort((a, b) => a.name.localeCompare(b.name)));
}

// ── Public API ──────────────────────────────────────────────────────────────

let initialised: Promise<void> | null = null;

/**
 * Bring every installed font back after a restart.
 *
 * Called once at startup. A font that fails to load is skipped and logged
 * rather than taking the others down with it — a corrupted file must not stop
 * the app opening.
 */
export function initCustomFonts(): Promise<void> {
  if (initialised) return initialised;
  initialised = (async () => {
    if (!idbAvailable()) return;
    let records: StoredFont[];
    try {
      records = await readAll();
    } catch (err) {
      console.warn('[customFonts] could not read the font store:', err);
      return;
    }
    for (const record of records) {
      installed.set(record.id, record);
      try {
        await register(record);
      } catch (err) {
        console.warn(`[customFonts] "${record.family}" could not be loaded:`, err);
      }
    }
    if (installed.size > 0) publish();
  })();
  return initialised;
}

/** The record without its bytes — what the UI shows and what callers hold on to. */
function toMeta(record: StoredFont): CustomFont {
  return {
    id: record.id,
    family: record.family,
    subfamily: record.subfamily,
    weight: record.weight,
    italic: record.italic,
    fileName: record.fileName,
    size: record.size,
    addedAt: record.addedAt,
  };
}

export function listCustomFonts(): CustomFont[] {
  return [...installed.values()]
    .map(toMeta)
    .sort((a, b) => a.family.localeCompare(b.family) || a.subfamily.localeCompare(b.subfamily));
}

export function isCustomFamily(family: string | null | undefined): boolean {
  if (!family) return false;
  const key = family.trim().toLowerCase();
  for (const record of installed.values()) {
    if (record.family.toLowerCase() === key) return true;
  }
  return false;
}

/**
 * The bytes of an installed font, for embedding in an export.
 *
 * Falls back through the styles a family has rather than returning nothing: a
 * family with only a regular cut still draws its bold text, in that cut, which
 * is what the screen does too.
 */
export function getCustomFontBytes(
  family: string,
  style: { bold?: boolean; italic?: boolean } = {},
): ArrayBuffer | null {
  const key = family.trim().toLowerCase();
  const candidates = [...installed.values()].filter((r) => r.family.toLowerCase() === key);
  if (candidates.length === 0) return null;

  const wantWeight = style.bold ? 700 : 400;
  const wantItalic = !!style.italic;
  const exact = candidates.find((r) => r.italic === wantItalic && r.weight === wantWeight);
  if (exact) return exact.bytes;
  const sameSlant = candidates.find((r) => r.italic === wantItalic);
  if (sameSlant) return sameSlant.bytes;
  const upright = candidates.find((r) => !r.italic && r.weight === 400);
  return (upright || candidates[0]).bytes;
}

export interface InstallResult {
  installed: CustomFont[];
  errors: { fileName: string; message: string }[];
}

/**
 * A font file to install, already read.
 *
 * Bytes rather than a `File` because only two of the five platforms hand the
 * app a `File` at all: the desktop dialog and Android's ContentResolver both
 * produce bytes and a name, and nothing is gained by wrapping those back up
 * (see utils/fileOps `pickFontFiles`).
 */
export interface FontSource {
  name: string;
  bytes: ArrayBuffer;
}

/**
 * Add font files.
 *
 * Every file is attempted; one bad file reports its own error and the rest are
 * still installed, because a writer selecting a folder of weights should not
 * lose the lot to a stray README.
 */
export async function installFontFiles(sources: FontSource[]): Promise<InstallResult> {
  const result: InstallResult = { installed: [], errors: [] };
  for (const source of sources) {
    const file = { name: source.name, size: source.bytes.byteLength };
    try {
      if (file.size > MAX_FONT_BYTES) {
        throw new FontFileError(`Too large — fonts must be under ${Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB.`);
      }
      if (file.size === 0) throw new FontFileError('That file is empty.');

      const bytes = source.bytes;
      const info = readFontFileInfo(bytes, file.name);

      const duplicate = [...installed.values()].find(
        (r) => r.family.toLowerCase() === info.family.toLowerCase()
          && r.weight === info.weight && r.italic === info.italic,
      );

      const record: StoredFont = {
        id: duplicate?.id || uuid(),
        family: info.family,
        subfamily: info.subfamily,
        weight: info.weight,
        italic: info.italic,
        fileName: file.name,
        size: file.size,
        addedAt: Date.now(),
        bytes,
      };

      if (duplicate) unregister(duplicate.id);
      await register(record);
      await writeOne(record);
      installed.set(record.id, record);
      result.installed.push(toMeta(record));
    } catch (err) {
      const message = err instanceof FontFileError
        ? err.message
        : `Could not install this font: ${(err as Error)?.message || String(err)}`;
      result.errors.push({ fileName: file.name, message });
      console.warn(`[customFonts] ${file.name}:`, err);
    }
  }
  if (result.installed.length > 0) publish();
  return result;
}

export async function removeCustomFont(id: string): Promise<void> {
  unregister(id);
  installed.delete(id);
  try {
    await deleteOne(id);
  } catch (err) {
    console.warn('[customFonts] could not delete from the font store:', err);
    throw new Error('The font was removed from this session but could not be deleted from storage.');
  } finally {
    publish();
  }
}
