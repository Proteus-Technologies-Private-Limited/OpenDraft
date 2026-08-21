/**
 * Reading and writing backup snapshots in the user's chosen folder.
 *
 * Every Tauri platform, which means the folder is named three different ways:
 *
 *   - **Desktop** — an absolute path, and each snapshot is a path too.
 *   - **iOS/iPadOS** — a security-scoped bookmark for the folder, and each
 *     snapshot is a path *relative* to it. An absolute path is unreadable once
 *     the scope grant that came with it is gone, so the bookmark is re-resolved
 *     on every call.
 *   - **Android** — a persisted SAF tree URI, and each snapshot is a
 *     `content://` document URI.
 *
 * That is the whole of the platform difference: filenames, retention, the
 * project subfolders and the .odraft payload are identical everywhere, so the
 * Recover dialog can open a backup written on a Mac from an iPad.
 *
 * Not available in the browser, where there is nothing that survives a reload.
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri, isDesktopTauri, getOS } from './platform';
import { useSettingsStore } from '../stores/settingsStore';
import {
  buildBackupFilename, buildProjectFolderName, parseBackupFilename, selectForPruning,
  type ParsedBackup,
} from '../utils/backupNaming';
import {
  serializeOdraft, parseOdraft, parseOdraftLoose,
  type ParsedOdraft, type BackupKind,
} from '../utils/odraftFormat';
import { collectAssetRefs, packAssets, packScratchAssets } from './snapshotAssets';
import { collectScratchIds } from '../utils/scratchRefs';
import type { ScriptMeta } from './api';

/** A slow or disconnected network share must not leave a promise pending forever. */
const WRITE_TIMEOUT_MS = 10_000;

/** The mobile pickers run as a separate view controller, so they are polled. */
const PICK_POLL_INTERVAL_MS = 400;
const PICK_TIMEOUT_MS = 120_000;

export interface BackupEntry {
  /** How this platform names the file: a path, a relative path, or a URI. */
  path: string;
  name: string;
  title: string;
  scriptKey: string;
  date: Date;
  /** 'external' = an .odraft file in the folder that OpenDraft did not write. */
  kind: 'auto' | 'manual' | 'external';
  sizeBytes: number;
  /**
   * Project folder the snapshot sits in, relative to the backup folder. Empty
   * for the flat files older builds wrote straight into the root.
   */
  project: string;
}

interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_ms: number;
}

/** What the mobile listing commands return, before filenames are parsed. */
interface MobileBackupEntry {
  name: string;
  path: string;
  project: string;
  size: number;
  modified_ms: number;
}

/** A file in the backup folder, however this platform happens to name it. */
interface RawBackupFile {
  name: string;
  path: string;
  project: string;
  sizeBytes: number;
  modifiedMs: number;
}

type BackupPlatform = 'desktop' | 'ios' | 'android' | 'none';

function backupPlatform(): BackupPlatform {
  if (!isTauri()) return 'none';
  if (isDesktopTauri()) return 'desktop';
  return getOS() === 'android' ? 'android' : 'ios';
}

/** True where a backup folder can be chosen at all — every app build. */
export function backupsSupported(): boolean {
  return backupPlatform() !== 'none';
}

/**
 * True where a snapshot can be shown to the user in a file manager. Desktop
 * only: neither mobile platform lets an app reveal a file in Files, and the
 * writer can reach the folder there themselves anyway.
 */
export function supportsRevealBackup(): boolean {
  return backupPlatform() === 'desktop';
}

/** True when snapshots can actually be written right now. */
export function backupsAvailable(): boolean {
  if (!backupsSupported()) return false;
  return Boolean(useSettingsStore.getState().backupFolder);
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[/\\]+$/, '')}${sep}${name}`;
}

/**
 * Every `.odraft` under the backup folder: the project subfolders, plus the
 * root itself for snapshots written before backups were grouped by project.
 *
 * Descends exactly one level. The folder belongs to the user, who may well have
 * a deep tree of their own in there, and walking it on every listing would cost
 * far more than it finds.
 */
async function collectSnapshotFiles(
  root: string,
): Promise<Array<DirEntryInfo & { project: string }>> {
  const top = await invoke<DirEntryInfo[]>('list_dir_entries', {
    path: root,
    extension: null,
  });

  const out: Array<DirEntryInfo & { project: string }> = [];
  for (const e of top) {
    if (!e.is_dir) {
      if (/\.odraft$/i.test(e.name)) out.push({ ...e, project: '' });
      continue;
    }
    try {
      const inner = await invoke<DirEntryInfo[]>('list_dir_entries', {
        path: e.path,
        extension: 'odraft',
      });
      for (const f of inner) {
        if (!f.is_dir) out.push({ ...f, project: e.name });
      }
    } catch (err) {
      // An unreadable subfolder must not make the rest of the backups vanish.
      console.warn('[backup] could not read', e.path, err);
    }
  }
  return out;
}

/** The backup folder's contents, in the one shape the rest of this file uses. */
async function listBackupFiles(): Promise<RawBackupFile[]> {
  const folder = useSettingsStore.getState().backupFolder;
  if (!folder) return [];

  const platform = backupPlatform();
  if (platform === 'none') return [];

  if (platform === 'desktop') {
    const entries = await collectSnapshotFiles(folder);
    return entries.map((e) => ({
      name: e.name, path: e.path, project: e.project,
      sizeBytes: e.size, modifiedMs: e.modified_ms,
    }));
  }

  const entries = platform === 'ios'
    ? await invoke<MobileBackupEntry[]>('ios_backup_list', { bookmark: folder })
    : await invoke<MobileBackupEntry[]>('android_backup_list', { treeUri: folder });
  return entries.map((e) => ({
    name: e.name, path: e.path, project: e.project,
    sizeBytes: e.size, modifiedMs: e.modified_ms,
  }));
}

/** Write one file into `<backup folder>/<project>/<filename>`. */
async function writeBackupFile(
  folder: string,
  project: string,
  filename: string,
  contents: string,
): Promise<string> {
  switch (backupPlatform()) {
    case 'desktop': {
      const targetDir = joinPath(folder, project);
      await invoke('ensure_dir', { path: targetDir });
      const path = joinPath(targetDir, filename);
      await withTimeout(
        invoke('save_text_atomic', { path, contents }),
        WRITE_TIMEOUT_MS,
        'Writing the backup',
      );
      return path;
    }
    case 'ios':
      return withTimeout(
        invoke<string>('ios_backup_write', { bookmark: folder, folder: project, filename, contents }),
        WRITE_TIMEOUT_MS,
        'Writing the backup',
      );
    case 'android':
      return withTimeout(
        invoke<string>('android_backup_write', { treeUri: folder, folder: project, filename, contents }),
        WRITE_TIMEOUT_MS,
        'Writing the backup',
      );
    default:
      throw new Error('Backups are not available in the browser.');
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

export interface WriteSnapshotOptions {
  content: Record<string, unknown>;
  title: string;
  projectId?: string | null;
  scriptId?: string | null;
  projectTitle?: string;
  kind: 'auto' | 'manual';
  /** Injectable for tests. */
  now?: Date;
}

export interface WriteSnapshotResult {
  path: string;
  filename: string;
  bytes: number;
  assetsOmitted: boolean;
}

/**
 * Write one snapshot, then prune old ones.
 *
 * The write is atomic (temp file + rename on desktop, an atomic replace through
 * the file coordinator on iOS) because a snapshot truncated by a crash or a
 * yanked drive is worse than no snapshot. Pruning is fire-and-forget: failing
 * to delete an old file never deserves the user's attention, and must not fail
 * the backup that just succeeded.
 */
export async function writeSnapshot(opts: WriteSnapshotOptions): Promise<WriteSnapshotResult> {
  const { backupFolder, backupIncludeImages, backupRetentionCount } = useSettingsStore.getState();
  if (!backupsSupported()) throw new Error('Backups are only available in the OpenDraft app.');
  if (!backupFolder) throw new Error('No backup folder is configured.');

  // One folder per project inside the chosen folder, so a writer with a dozen
  // projects can find the right script in Finder without reading filenames.
  const projectFolder = buildProjectFolderName(opts.projectTitle);

  // Images live in one of two places: a project's asset store once the script
  // has been saved into one, and the scratch store before that. A backup used to
  // pack only the first, which was harmless while project-less documents carried
  // their images inline — and would now silently drop every picture from a
  // backup of an unsaved screenplay, which is exactly the document with no other
  // copy anywhere.
  let assets: Awaited<ReturnType<typeof packAssets>>['assets'] = [];
  let assetsOmitted = false;
  const projectRefs = collectAssetRefs(opts.content);
  const scratchIds = collectScratchIds(opts.content);
  if (backupIncludeImages) {
    if (opts.projectId && projectRefs.length > 0) {
      const packed = await packAssets(opts.projectId, projectRefs);
      assets = packed.assets;
      assetsOmitted = packed.truncated;
    } else if (projectRefs.length > 0) {
      // References into a project we cannot read from — nothing to pack.
      assetsOmitted = true;
    }
    if (scratchIds.size > 0) {
      const packed = await packScratchAssets(opts.content);
      assets = assets.concat(packed.assets);
      assetsOmitted = assetsOmitted || packed.truncated;
    }
  } else {
    assetsOmitted = projectRefs.length > 0 || scratchIds.size > 0;
  }

  const meta: ScriptMeta = {
    id: opts.scriptId || '', title: opts.title, author: '', format: 'json',
    created_at: '', updated_at: '', page_count: 0,
    size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
  } as ScriptMeta;

  const text = serializeOdraft(meta, opts.content, {
    assets,
    assetsOmitted,
    backupKind: opts.kind as BackupKind,
    projectId: opts.projectId ?? null,
    scriptId: opts.scriptId ?? null,
    projectTitle: opts.projectTitle,
  });

  const filename = buildBackupFilename({
    title: opts.title,
    scriptId: opts.scriptId,
    date: opts.now || new Date(),
    kind: opts.kind,
  });

  const path = await writeBackupFile(backupFolder, projectFolder, filename, text);

  void pruneSnapshots(backupRetentionCount).catch((err) =>
    console.warn('[backup] prune failed', err),
  );

  return { path, filename, bytes: text.length, assetsOmitted };
}

/** Every .odraft in the backup folder and its project folders, newest first. */
export async function listSnapshots(): Promise<BackupEntry[]> {
  if (!backupsAvailable()) return [];

  const entries = await listBackupFiles();

  const out: BackupEntry[] = [];
  for (const e of entries) {
    const parsed = parseBackupFilename(e.name);
    if (parsed) {
      out.push({
        path: e.path, name: e.name, title: parsed.title, scriptKey: parsed.scriptKey,
        date: parsed.timestamp, kind: parsed.kind, sizeBytes: e.sizeBytes, project: e.project,
      });
    } else {
      // An .odraft the user put here themselves (an export, a copy). Listed so
      // it can be recovered, tagged 'external' so it is never pruned.
      out.push({
        path: e.path, name: e.name, title: e.name.replace(/\.odraft$/i, ''),
        scriptKey: 'external',
        date: new Date(e.modifiedMs || 0), kind: 'external', sizeBytes: e.sizeBytes,
        project: e.project,
      });
    }
  }
  out.sort((a, b) => b.date.getTime() - a.date.getTime());
  return out;
}

/**
 * Delete automatic snapshots beyond the retention limit.
 * Returns how many were removed.
 */
export async function pruneSnapshots(keep?: number): Promise<number> {
  const state = useSettingsStore.getState();
  const limit = keep ?? state.backupRetentionCount;
  if (!backupsAvailable() || limit <= 0) return 0;

  const entries = await listBackupFiles();

  // Only files this module's naming scheme recognizes are candidates — a user
  // who points the setting at their Documents folder can never lose anything.
  const parsed: Array<ParsedBackup & { path: string }> = [];
  for (const e of entries) {
    const p = parseBackupFilename(e.name);
    if (p) parsed.push({ ...p, path: e.path });
  }

  const doomed = selectForPruning(parsed, limit) as Array<ParsedBackup & { path: string }>;
  let removed = 0;
  for (const f of doomed) {
    try {
      await deleteSnapshot(f.path);
      removed++;
    } catch (err) {
      console.warn('[backup] could not delete', f.path, err);
    }
  }
  return removed;
}

/** Read and parse one snapshot. Accepts legacy envelope-less backups. */
export async function readSnapshot(path: string): Promise<ParsedOdraft> {
  const folder = useSettingsStore.getState().backupFolder;
  let text: string;
  switch (backupPlatform()) {
    case 'ios':
      text = await invoke<string>('ios_backup_read', { bookmark: folder, path });
      break;
    case 'android': {
      // The path is a document URI, which the Android reader takes directly —
      // the backup folder is not involved.
      const result = await invoke<{ content: string; filename: string }>('read_content_uri', {
        uri: path,
      });
      text = result.content;
      break;
    }
    default:
      text = await invoke<string>('read_text_file', { path });
  }

  try {
    return parseOdraft(text);
  } catch {
    // Older builds wrote crash backups with no envelope; recover them anyway.
    return parseOdraftLoose(text);
  }
}

export async function deleteSnapshot(path: string): Promise<void> {
  const folder = useSettingsStore.getState().backupFolder;
  switch (backupPlatform()) {
    case 'ios':
      await invoke('ios_backup_delete', { bookmark: folder, path });
      return;
    case 'android':
      await invoke('android_backup_delete', { docUri: path });
      return;
    default:
      await invoke('delete_file', { path });
  }
}

export async function revealSnapshot(path: string): Promise<void> {
  if (!supportsRevealBackup()) {
    throw new Error('Showing a backup in a file manager is only available on the desktop.');
  }
  await invoke('reveal_path', { path });
}

export interface PathProbe {
  exists: boolean;
  is_dir: boolean;
  writable: boolean;
  error: string | null;
  /** The folder's display name, where the handle itself is not readable. */
  name?: string | null;
}

export async function probeBackupFolder(handle: string): Promise<PathProbe> {
  switch (backupPlatform()) {
    case 'ios':
      return invoke<PathProbe>('ios_backup_probe', { bookmark: handle });
    case 'android':
      return invoke<PathProbe>('android_backup_probe', { treeUri: handle });
    default:
      return invoke<PathProbe>('probe_directory', { path: handle });
  }
}

/**
 * The backup folder as the writer chose it.
 *
 * `handle` is what every command above takes; `label` is the only part fit to
 * show, since a bookmark is base64 and a tree URI is a provider's internal id.
 */
export interface PickedBackupFolder {
  handle: string;
  label: string;
}

/** Present the platform's folder picker. Null when the user cancelled. */
export async function pickBackupFolder(current?: string): Promise<PickedBackupFolder | null> {
  switch (backupPlatform()) {
    case 'desktop': {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false, defaultPath: current || undefined });
      if (typeof picked !== 'string' || !picked) return null;
      return { handle: picked, label: picked };
    }

    case 'ios': {
      await invoke('ios_start_folder_pick');
      const picked = await pollForPick(() =>
        invoke<{ status: string; bookmark?: string; name?: string }>('ios_poll_document_pick'),
      );
      if (!picked?.bookmark) return null;
      return { handle: picked.bookmark, label: picked.name || 'Backup folder' };
    }

    case 'android': {
      await invoke('android_pick_backup_folder');
      const uri = await pollForPick(async () => {
        const result = await invoke<string | null>('android_get_picked_backup_folder');
        // null = still open, '' = cancelled, anything else = the tree URI.
        if (result === null || result === undefined) return { status: 'pending' };
        return result === '' ? { status: 'cancelled' } : { status: 'picked', bookmark: result };
      });
      if (!uri?.bookmark) return null;
      // The tree URI says nothing a writer would recognize, so the folder's own
      // display name is asked for; the URI's last segment is the fallback.
      let label = '';
      try {
        const probe = await probeBackupFolder(uri.bookmark);
        label = probe.name || '';
      } catch (err) {
        console.warn('[backup] could not read the folder name', err);
      }
      return { handle: uri.bookmark, label: label || describeTreeUri(uri.bookmark) };
    }

    default:
      throw new Error('Choosing a backup folder is not available in the browser.');
  }
}

/** A readable-ish name for a SAF tree URI, when the provider gave none. */
function describeTreeUri(uri: string): string {
  try {
    const encoded = uri.split('/tree/').pop() || uri;
    const decoded = decodeURIComponent(encoded);
    // "primary:Documents/Backups" — the part after the volume is the folder.
    const afterVolume = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
    return afterVolume.split('/').filter(Boolean).pop() || 'Backup folder';
  } catch {
    return 'Backup folder';
  }
}

interface PollResult {
  status: string;
  bookmark?: string;
  name?: string;
}

/**
 * Poll a picker that runs as a separate view controller.
 *
 * Resolves null on cancellation and on timeout: a picker the writer walked away
 * from must not leave a timer running for the life of the app.
 */
function pollForPick(check: () => Promise<PollResult>): Promise<PollResult | null> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const result = await check();
        if (result.status === 'pending') {
          if (Date.now() - started > PICK_TIMEOUT_MS) {
            clearInterval(timer);
            resolve(null);
          }
          return;
        }
        clearInterval(timer);
        resolve(result.status === 'picked' ? result : null);
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, PICK_POLL_INTERVAL_MS);
  });
}
