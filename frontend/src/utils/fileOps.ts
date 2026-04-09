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
async function openTextFileAndroid(): Promise<{ name: string; content: string } | null> {
  const { invoke } = await import('@tauri-apps/api/core');

  // Launch the native file picker
  await invoke('android_pick_file');

  // Wait for the result — the picker runs as a separate Activity
  const uri = await waitForAndroidPickResult(invoke);
  if (!uri) return null;

  // Read the file via ContentResolver
  const result = await invoke<{ content: string; filename: string }>('read_content_uri', { uri });
  return { name: result.filename, content: result.content };
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
