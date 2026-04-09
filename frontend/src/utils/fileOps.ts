/**
 * Cross-platform file operations.
 *
 * On desktop Tauri: uses native OS dialogs (via @tauri-apps/plugin-dialog)
 * and custom Tauri commands for reading/writing outside the fs scope.
 *
 * On iOS Tauri: uses the native share sheet for export (save dialog doesn't
 * work reliably on iOS), and Tauri dialog for import with security-scoped
 * fallback in the Rust backend.
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

// ── Save ────────────────────────────────────────────────────────────────────

/**
 * Save data to a file.
 * Desktop Tauri → native "Save As" dialog.
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
 * Web → <input type="file"> picker.
 * Returns { name, content } or null if user cancelled.
 */
export async function openTextFile(
  filters?: FileFilter[],
): Promise<{ name: string; content: string } | null> {
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

// ── Open (binary) ───────────────────────────────────────────────────────────

/**
 * Open a binary file.
 * Desktop Tauri → native "Open" dialog.
 * Web → <input type="file"> picker.
 * Returns { name, content: ArrayBuffer } or null if user cancelled.
 */
export async function openBinaryFile(
  filters?: FileFilter[],
): Promise<{ name: string; content: ArrayBuffer } | null> {
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
