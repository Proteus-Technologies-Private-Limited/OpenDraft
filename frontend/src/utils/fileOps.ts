/**
 * Cross-platform file operations.
 *
 * On desktop Tauri: uses native OS dialogs (via @tauri-apps/plugin-dialog)
 * and custom Tauri commands for reading/writing outside the fs scope.
 *
 * On iOS Tauri: uses the native share sheet for export (save dialog doesn't
 * work reliably on iOS), and browser-style file input for import.
 *
 * On Android Tauri: uses the native share intent for export, and
 * browser-style file input for import.
 *
 * On web / mobile browser: falls back to standard browser APIs
 * (anchor download for save, <input type="file"> for open).
 */
import { isTauri, getOS } from '../services/platform';

interface FileFilter {
  name: string;
  extensions: string[];
}

/** True when running inside Tauri on iOS. */
function isIOSTauri(): boolean {
  return isTauri() && getOS() === 'ios';
}

/** True when running inside Tauri on Android. */
function isAndroidTauri(): boolean {
  return isTauri() && getOS() === 'android';
}

/** True when running on a mobile Tauri platform (iOS or Android). */
function isMobileTauri(): boolean {
  return isIOSTauri() || isAndroidTauri();
}

// ── Save ────────────────────────────────────────────────────────────────────

/**
 * Save data to a file.
 * Desktop Tauri → native "Save As" dialog.
 * iOS Tauri → share sheet (write to temp + present share).
 * Android Tauri → share intent (write to cache + present chooser).
 * Web → browser download to Downloads folder.
 * Returns true if saved, false if user cancelled.
 */
export async function saveFile(
  data: Uint8Array | string,
  defaultFilename: string,
  filters?: FileFilter[],
): Promise<boolean> {
  if (isIOSTauri()) {
    return saveFileIOS(data, defaultFilename);
  }
  if (isAndroidTauri()) {
    return saveFileAndroid(data, defaultFilename);
  }
  if (isTauri()) {
    return saveFileTauri(data, defaultFilename, filters);
  }
  return saveFileBrowser(data, defaultFilename);
}

async function saveFileTauri(
  data: Uint8Array | string,
  defaultFilename: string,
  filters?: FileFilter[],
): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  const path = await save({ defaultPath: defaultFilename, filters });
  if (!path) return false;

  if (typeof data === 'string') {
    await invoke('save_text_to_path', { path, contents: data });
  } else {
    await invoke('save_binary_to_path', { path, contents: Array.from(data) });
  }
  return true;
}

/**
 * iOS Tauri: write to temp + present native share sheet.
 * The iOS save dialog doesn't work reliably — the share sheet lets the user
 * save to Files, AirDrop, or share via any installed app.
 */
async function saveFileIOS(
  data: Uint8Array | string,
  defaultFilename: string,
): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  if (typeof data === 'string') {
    await invoke('ios_save_and_share', { filename: defaultFilename, contents: data });
  } else {
    await invoke('ios_save_and_share_binary', {
      filename: defaultFilename,
      contents: Array.from(data),
    });
  }
  return true;
}

/**
 * Android Tauri: write to cache + present native share intent.
 * The Tauri save dialog doesn't work reliably on Android — the share chooser
 * lets the user save to Files, Drive, or share via any installed app.
 */
async function saveFileAndroid(
  data: Uint8Array | string,
  defaultFilename: string,
): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  if (typeof data === 'string') {
    await invoke('android_save_and_share', { filename: defaultFilename, contents: data });
  } else {
    await invoke('android_save_and_share_binary', {
      filename: defaultFilename,
      contents: Array.from(data),
    });
  }
  return true;
}

function saveFileBrowser(
  data: Uint8Array | string,
  defaultFilename: string,
): boolean {
  const blob =
    typeof data === 'string'
      ? new Blob([data], { type: 'text/plain' })
      : new Blob([data] as BlobPart[]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// ── Open (text) ─────────────────────────────────────────────────────────────

/**
 * Open a text file.
 * Desktop Tauri → native "Open" dialog.
 * Mobile Tauri (iOS/Android) → browser-style file input (no filters).
 * Web → <input type="file"> picker.
 * Returns { name, content } or null if user cancelled.
 */
export async function openTextFile(
  filters?: FileFilter[],
): Promise<{ name: string; content: string } | null> {
  // Android Tauri: use native file picker via JNI (ACTION_OPEN_DOCUMENT).
  // The WebView's <input type="file"> doesn't work reliably on Android.
  if (isAndroidTauri()) {
    return openTextFileAndroid();
  }
  // iOS Tauri: use browser-style file input — the Tauri dialog plugin's
  // open() doesn't reliably present the document picker on iOS, but
  // the WebView's <input type="file"> works and gives us a readable copy.
  // Don't pass filters — mobile document pickers only understand MIME types
  // and would hide .fdx/.fountain files.
  if (isIOSTauri()) {
    return openTextFileBrowser();
  }
  if (isTauri()) {
    return openTextFileTauri(filters);
  }
  return openTextFileBrowser(filters);
}

async function openTextFileTauri(
  filters?: FileFilter[],
): Promise<{ name: string; content: string } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  const selected = await open({ multiple: false, filters });
  if (!selected) return null;

  const path = selected as string;
  const content: string = await invoke('read_text_file', { path });
  const name = path.split(/[/\\]/).pop() || 'file';
  return { name, content };
}

function openTextFileBrowser(
  filters?: FileFilter[],
): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (filters) {
      input.accept = filters
        .flatMap((f) => f.extensions.map((e) => `.${e}`))
        .join(',');
    }
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ name: file.name, content: reader.result as string });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

/**
 * Android Tauri: launch native document picker via JNI, then read the
 * selected file through ContentResolver.  The picker result is delivered
 * asynchronously via MainActivity.onActivityResult(), so we poll for it.
 */
async function openTextFileAndroid(): Promise<{ name: string; content: string; uri: string } | null> {
  const { invoke } = await import('@tauri-apps/api/core');

  // Launch the native file picker
  await invoke('android_pick_file');

  // Wait for the result — the picker runs as a separate Activity
  const uri = await waitForAndroidPickResult(invoke);
  if (!uri) return null;

  // Read the file via ContentResolver
  const result = await invoke<{ content: string; filename: string }>('read_content_uri', { uri });
  // The URI is returned as well as the text: with a persisted grant it is the
  // handle open-in-place saves back through.
  return { name: result.filename, content: result.content, uri };
}

/**
 * Poll for the file picker result.  MainActivity.onActivityResult() stores
 * the chosen URI in a companion-object field; an empty string means the
 * user cancelled; null means the picker hasn't returned yet.
 */
function waitForAndroidPickResult(
  invoke: (cmd: string) => Promise<string | null>,
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;

    const finish = (uri: string | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(uri);
    };

    const check = async () => {
      if (resolved) return;
      try {
        const uri = await invoke('android_get_picked_file');
        if (uri !== null && uri !== undefined) {
          // Empty string = user cancelled, non-empty = valid URI
          finish(uri || null);
        }
      } catch (_) { /* picker hasn't returned yet */ }
    };

    // When app returns to foreground after the picker closes
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(check, 200);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // Poll as fallback (some devices don't fully background the app)
    const timer = setInterval(() => {
      if (resolved) return;
      check();
    }, 400);

    // Timeout after 2 minutes
    const timeout = setTimeout(() => finish(null), 120_000);

    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
      clearTimeout(timeout);
    };
  });
}

/**
 * Android: launch the document picker and read the chosen file as raw bytes.
 *
 * Separate from {@link openTextFileAndroid}, which reads through a UTF-8
 * decoder and is still the right thing for the callers that only ever handle
 * text.
 */
async function pickAndroidFileBytes(): Promise<{ name: string; bytes: ArrayBuffer } | null> {
  const { invoke } = await import('@tauri-apps/api/core');

  await invoke('android_pick_file');
  const uri = await waitForAndroidPickResult(invoke);
  if (!uri) return null;

  const result = await invoke<{ bytes: number[]; filename: string }>(
    'read_content_uri_bytes',
    { uri },
  );
  return { name: result.filename, bytes: new Uint8Array(result.bytes).buffer };
}

// ── Open (text or binary, chosen by extension) ──────────────────────────────

export interface OpenedFile {
  name: string;
  /** Set for text formats. */
  text: string | null;
  /** Set for the formats listed in `binaryExtensions` (archives). */
  bytes: ArrayBuffer | null;
}

function extensionOf(name: string): string {
  const match = /\.([^.\\/]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Open a file whose reading mode depends on its extension.
 *
 * Screenplay import accepts both plain-text formats (.fountain, .fdx) and
 * archives (.fadein), but which one the user picks isn't known until the
 * dialog closes — so the read mode has to be decided from the chosen name.
 *
 * Note: on Android Tauri the native picker reads through ContentResolver as
 * text only, so archives come back with `bytes: null`; callers should report
 * that rather than trying to parse the string.
 */
export async function openTextOrBinaryFile(
  filters: FileFilter[] | undefined,
  binaryExtensions: string[],
): Promise<OpenedFile | null> {
  const isBinary = (name: string) => binaryExtensions.includes(extensionOf(name));

  if (isAndroidTauri()) {
    // Read bytes, not text. The text path decodes as UTF-8, which destroys an
    // archive — .fadein is a zip, and reading it as text is why it could never
    // be imported on Android. Text formats are decoded from the same bytes
    // below, so one read serves both.
    const picked = await pickAndroidFileBytes();
    if (!picked) return null;
    if (isBinary(picked.name)) {
      return { name: picked.name, text: null, bytes: picked.bytes };
    }
    return {
      name: picked.name,
      text: new TextDecoder('utf-8').decode(picked.bytes),
      bytes: null,
    };
  }

  // iOS passes no filters for the same reason openTextFile() doesn't:
  // mobile document pickers only understand MIME types.
  if (isTauri() && !isIOSTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');

    const selected = await open({ multiple: false, filters });
    if (!selected) return null;

    const path = selected as string;
    const name = path.split(/[/\\]/).pop() || 'file';
    if (isBinary(name)) {
      const data: number[] = await invoke('read_binary_file', { path });
      return { name, text: null, bytes: new Uint8Array(data).buffer };
    }
    const text: string = await invoke('read_text_file', { path });
    return { name, text, bytes: null };
  }

  return openTextOrBinaryFileBrowser(isIOSTauri() ? undefined : filters, isBinary);
}

function openTextOrBinaryFileBrowser(
  filters: FileFilter[] | undefined,
  isBinary: (name: string) => boolean,
): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (filters) {
      input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    }
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      const binary = isBinary(file.name);
      reader.onload = () =>
        resolve(
          binary
            ? { name: file.name, text: null, bytes: reader.result as ArrayBuffer }
            : { name: file.name, text: reader.result as string, bytes: null },
        );
      reader.onerror = () => resolve(null);
      if (binary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    };
    input.click();
  });
}

// ── Open (font files) ───────────────────────────────────────────────────────

export interface PickedFontFile {
  name: string;
  bytes: ArrayBuffer;
}

/** The font containers a writer can install. */
export const FONT_FILE_EXTENSIONS = ['ttf', 'otf', 'ttc', 'woff', 'woff2'];

/**
 * Pick one or more font files to install.
 *
 * Every platform reaches its picker a different way, and a plain
 * `<input type="file">` is only right on two of them:
 *
 *   desktop  the native dialog, because WKWebView and WebView2 do not give a
 *            file input a usable panel from a `tauri://` page — the same
 *            reason `openTextOrBinaryFile` uses the dialog plugin.
 *   Android  the ContentResolver picker, whose bytes come back through a Tauri
 *            command. One file at a time; that is what the intent offers.
 *   iOS      a file input with NO `accept`, because iOS maps `accept` through
 *            UTIs and an extension list leaves everything greyed out.
 *   web      a file input, filtered.
 */
export async function pickFontFiles(): Promise<PickedFontFile[]> {
  if (isAndroidTauri()) {
    const picked = await pickAndroidFileBytes();
    return picked ? [picked] : [];
  }

  if (isTauri() && !isIOSTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Fonts', extensions: FONT_FILE_EXTENSIONS }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected as string];
    const out: PickedFontFile[] = [];
    for (const path of paths) {
      const name = path.split(/[/\\]/).pop() || 'font';
      const data: number[] = await invoke('read_binary_file', { path });
      out.push({ name, bytes: new Uint8Array(data).buffer });
    }
    return out;
  }

  return pickFontFilesBrowser(isIOSTauri());
}

function pickFontFilesBrowser(unfiltered: boolean): Promise<PickedFontFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (!unfiltered) input.accept = FONT_FILE_EXTENSIONS.map((e) => `.${e}`).join(',');
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      try {
        resolve(await Promise.all(files.map(async (file) => ({
          name: file.name,
          bytes: await file.arrayBuffer(),
        }))));
      } catch {
        resolve([]);
      }
    };
    input.click();
  });
}

// ── Open in place ───────────────────────────────────────────────────────────

/**
 * A document being edited where it lives, rather than as an imported copy.
 *
 * `bookmark` is an opaque handle, never something to show a person — each
 * platform has its own idea of "a file I am still allowed to touch tomorrow":
 *
 *   iOS      a security-scoped bookmark. A picker path is readable only while
 *            its scope grant is held, and the grant dies with the process.
 *   Android  a `content://` URI with a persisted read/write grant taken via
 *            takePersistableUriPermission().
 *   Desktop  the path. There is no sandbox to satisfy, and a path is already
 *            durable, so the same model costs nothing here.
 *
 * All three survive a relaunch, which is what lets the same Dropbox file be
 * opened on Monday and saved on Tuesday (issue #62).
 */
export interface InPlaceDocument {
  name: string;
  /** Set for the text formats. */
  text: string | null;
  /** Set for the archive formats — .fadein is a zip. */
  bytes: ArrayBuffer | null;
  bookmark: string;
}

/**
 * What came back from the picker.
 *
 * `unsupported` is a real outcome rather than an error: the picker cannot
 * filter by extension on iOS (a .fdx has no system-declared type, so filtering
 * would hide exactly the files this is for), which means the check has to
 * happen after the choice — and it has to happen *before* the read, or an
 * unsupported file surfaces as "could not open the file", which reads as if it
 * were missing rather than simply not a screenplay.
 */
export type OpenInPlaceOutcome =
  | { status: 'cancelled' }
  | { status: 'unsupported'; name: string; extension: string }
  | { status: 'opened'; document: InPlaceDocument };

/**
 * What the desktop dialog offers. Mobile pickers cannot filter this way — iOS
 * matches on declared system types, and .fdx and .fountain have none — so this
 * is the one platform where the wrong file can be kept out of reach rather than
 * refused after the fact.
 */
const SCREENPLAY_IN_PLACE_FILTERS: FileFilter[] = [
  { name: 'Screenplay', extensions: ['odraft', 'fdx', 'fountain', 'fadein', 'osf', 'txt'] },
];

/** True where {@link openDocumentInPlace} can be used — everywhere but the web. */
export function supportsOpenInPlace(): boolean {
  return isTauri();
}

/** The picker runs as a separate view controller, so its result is polled. */
const PICK_POLL_INTERVAL_MS = 400;
const PICK_TIMEOUT_MS = 120_000;

interface PickResult {
  status: 'pending' | 'cancelled' | 'picked';
  bookmark?: string;
  name?: string;
}

/**
 * Present the platform's document picker and open the chosen file in place.
 *
 * The chosen file is validated before it is read: `editable` lists what the
 * caller can write back, `binary` says which of those are containers rather
 * than text. Throws with a user-facing message when a supported file could not
 * be read — a provider like Dropbox may be offline, or the document may have
 * been moved since.
 */
export async function openDocumentInPlace(
  editable: string[],
  binary: string[] = [],
): Promise<OpenInPlaceOutcome> {
  const picked = await pickInPlaceDocument();
  if (!picked) return { status: 'cancelled' };

  const extension = extensionOf(picked.name);
  if (!editable.includes(extension)) {
    return { status: 'unsupported', name: picked.name, extension };
  }

  const document = await readInPlaceDocument(picked, binary.includes(extension));
  return { status: 'opened', document };
}

interface PickedFile {
  name: string;
  bookmark: string;
}

/** The picker, per platform. Returns null when the writer cancelled. */
async function pickInPlaceDocument(): Promise<PickedFile | null> {
  if (isAndroidTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('android_pick_file');
    const uri = await waitForAndroidPickResult(invoke);
    if (!uri) return null;
    // The display name only arrives with the content, so it is read here and
    // the bytes are read again below — cheap next to a round trip through the
    // picker, and it keeps the validation in one place.
    const result = await invoke<{ bytes: number[]; filename: string }>(
      'read_content_uri_bytes',
      { uri },
    );
    return { name: result.filename, bookmark: uri };
  }

  if (isIOSTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ios_start_document_pick');
    const picked = await pollForPick(invoke);
    return picked ? { name: picked.name, bookmark: picked.bookmark } : null;
  }

  if (isTauri()) {
    // Desktop: the path is the handle, and the native dialog can filter by
    // extension properly, so an unsupported file is hard to pick in the first
    // place — the check still runs, for a path typed by hand.
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: false, filters: SCREENPLAY_IN_PLACE_FILTERS });
    if (!selected) return null;
    const path = selected as string;
    return { name: path.split(/[/\\]/).pop() || 'Untitled', bookmark: path };
  }

  throw new Error('Opening a file in place is not available in the browser.');
}

/** Read a picked file, as bytes for the archive formats and text otherwise. */
async function readInPlaceDocument(
  picked: PickedFile,
  asBytes: boolean,
): Promise<InPlaceDocument> {
  const { invoke } = await import('@tauri-apps/api/core');

  if (isAndroidTauri()) {
    const result = await invoke<{ bytes: number[]; filename: string }>(
      'read_content_uri_bytes',
      { uri: picked.bookmark },
    );
    const buffer = new Uint8Array(result.bytes).buffer;
    return asBytes
      ? { name: picked.name, text: null, bytes: buffer, bookmark: picked.bookmark }
      : {
          name: picked.name,
          text: new TextDecoder('utf-8').decode(buffer),
          bytes: null,
          bookmark: picked.bookmark,
        };
  }

  if (isIOSTauri()) {
    if (asBytes) {
      const data = await invoke<number[]>('ios_read_in_place_bytes', {
        bookmark: picked.bookmark,
      });
      return {
        name: picked.name,
        text: null,
        bytes: new Uint8Array(data).buffer,
        bookmark: picked.bookmark,
      };
    }
    const text = await invoke<string>('ios_read_in_place', { bookmark: picked.bookmark });
    return { name: picked.name, text, bytes: null, bookmark: picked.bookmark };
  }

  // Desktop
  if (asBytes) {
    const data = await invoke<number[]>('read_binary_file', { path: picked.bookmark });
    return {
      name: picked.name,
      text: null,
      bytes: new Uint8Array(data).buffer,
      bookmark: picked.bookmark,
    };
  }
  const text = await invoke<string>('read_text_file', { path: picked.bookmark });
  return { name: picked.name, text, bytes: null, bookmark: picked.bookmark };
}

function pollForPick(
  invoke: <T>(cmd: string) => Promise<T>,
): Promise<{ bookmark: string; name: string } | null> {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const timer = setInterval(async () => {
      try {
        const result = await invoke<PickResult>('ios_poll_document_pick');
        if (result.status === 'pending') {
          if (Date.now() - started > PICK_TIMEOUT_MS) {
            clearInterval(timer);
            resolve(null);
          }
          return;
        }
        clearInterval(timer);
        if (result.status === 'cancelled' || !result.bookmark) {
          resolve(null);
        } else {
          resolve({ bookmark: result.bookmark, name: result.name || 'Untitled' });
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, PICK_POLL_INTERVAL_MS);
  });
}

/**
 * Write text back over the document the user opened.
 *
 * Throws with a user-facing message on failure. Callers must treat that as
 * "not saved" and keep the editor dirty — silently swallowing it would tell
 * the writer their work is safe on a file that never received it.
 */
export async function saveDocumentInPlace(
  bookmark: string,
  contents: string | Uint8Array,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  // Tauri's IPC carries a byte array as a plain number array.
  const bytes = typeof contents === 'string' ? null : Array.from(contents);

  if (isAndroidTauri()) {
    // On Android the bookmark is the content:// URI the picker returned.
    if (bytes) {
      await invoke('write_content_uri_bytes', { uri: bookmark, contents: bytes });
    } else {
      await invoke('write_content_uri', { uri: bookmark, contents });
    }
    return;
  }
  if (isIOSTauri()) {
    if (bytes) {
      await invoke('ios_write_in_place_bytes', { bookmark, contents: bytes });
    } else {
      await invoke('ios_write_in_place', { bookmark, contents });
    }
    return;
  }
  if (!isTauri()) {
    throw new Error('Saving a file in place is not available in the browser.');
  }

  // Desktop: the bookmark is the path. save_text_atomic writes through a
  // temporary file, which is what keeps a half-written screenplay from
  // replacing a whole one if the machine gives up mid-save.
  if (bytes) {
    await invoke('save_binary_to_path', { path: bookmark, contents: bytes });
  } else {
    await invoke('save_text_atomic', { path: bookmark, contents });
  }
}

// ── Open (binary) ───────────────────────────────────────────────────────────

/**
 * Open a binary file.
 * Desktop Tauri → native "Open" dialog.
 * Mobile Tauri (iOS/Android) → browser-style file input (no filters).
 * Web → <input type="file"> picker.
 * Returns { name, content: ArrayBuffer } or null if user cancelled.
 */
export async function openBinaryFile(
  filters?: FileFilter[],
): Promise<{ name: string; content: ArrayBuffer } | null> {
  // Android: native picker doesn't support binary reads yet — fall through
  // to browser-style input which handles ArrayBuffer natively.
  if (isMobileTauri()) {
    return openBinaryFileBrowser();
  }
  if (isTauri()) {
    return openBinaryFileTauri(filters);
  }
  return openBinaryFileBrowser(filters);
}

async function openBinaryFileTauri(
  filters?: FileFilter[],
): Promise<{ name: string; content: ArrayBuffer } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  const selected = await open({ multiple: false, filters });
  if (!selected) return null;

  const path = selected as string;
  const data: number[] = await invoke('read_binary_file', { path });
  const name = path.split(/[/\\]/).pop() || 'file';
  return { name, content: new Uint8Array(data).buffer };
}

function openBinaryFileBrowser(
  filters?: FileFilter[],
): Promise<{ name: string; content: ArrayBuffer } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (filters) {
      input.accept = filters
        .flatMap((f) => f.extensions.map((e) => `.${e}`))
        .join(',');
    }
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ name: file.name, content: reader.result as ArrayBuffer });
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(file);
    };
    input.click();
  });
}
