/**
 * Reading and writing backup snapshots in the user's chosen folder.
 *
 * Desktop Tauri only. Mobile sandboxes cannot hold a persistent handle to an
 * arbitrary folder (that needs Android SAF tree URIs / iOS security-scoped
 * bookmarks), and writing snapshots into the app sandbox where the user can
 * never retrieve them would be worse than not offering the feature.
 */
import { invoke } from '@tauri-apps/api/core';
import { isDesktopTauri } from './platform';
import { useSettingsStore } from '../stores/settingsStore';
import {
  buildBackupFilename, buildProjectFolderName, parseBackupFilename, selectForPruning,
  type ParsedBackup,
} from '../utils/backupNaming';
import {
  serializeOdraft, parseOdraft, parseOdraftLoose,
  type ParsedOdraft, type BackupKind,
} from '../utils/odraftFormat';
import { collectAssetRefs, packAssets } from './snapshotAssets';
import type { ScriptMeta } from './api';

/** A slow or disconnected network share must not leave a promise pending forever. */
const WRITE_TIMEOUT_MS = 10_000;

export interface BackupEntry {
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

/** True when snapshots can actually be written right now. */
export function backupsAvailable(): boolean {
  if (!isDesktopTauri()) return false;
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
 * The write is atomic (temp file + rename on the Rust side) because a snapshot
 * truncated by a crash or a yanked drive is worse than no snapshot. Pruning is
 * fire-and-forget: failing to delete an old file never deserves the user's
 * attention, and must not fail the backup that just succeeded.
 */
export async function writeSnapshot(opts: WriteSnapshotOptions): Promise<WriteSnapshotResult> {
  const { backupFolder, backupIncludeImages, backupRetentionCount } = useSettingsStore.getState();
  if (!isDesktopTauri()) throw new Error('Backups are only available in the desktop app.');
  if (!backupFolder) throw new Error('No backup folder is configured.');

  // One folder per project inside the chosen folder, so a writer with a dozen
  // projects can find the right script in Finder without reading filenames.
  const projectFolder = buildProjectFolderName(opts.projectTitle);
  const targetDir = joinPath(backupFolder, projectFolder);
  await invoke('ensure_dir', { path: targetDir });

  let assets: Awaited<ReturnType<typeof packAssets>>['assets'] = [];
  let assetsOmitted = false;
  if (backupIncludeImages && opts.projectId) {
    const refs = collectAssetRefs(opts.content);
    if (refs.length > 0) {
      const packed = await packAssets(opts.projectId, refs);
      assets = packed.assets;
      assetsOmitted = packed.truncated;
    }
  } else {
    assetsOmitted = collectAssetRefs(opts.content).length > 0;
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
  const path = joinPath(targetDir, filename);

  await withTimeout(
    invoke('save_text_atomic', { path, contents: text }),
    WRITE_TIMEOUT_MS,
    'Writing the backup',
  );

  void pruneSnapshots(backupRetentionCount).catch((err) =>
    console.warn('[backup] prune failed', err),
  );

  return { path, filename, bytes: text.length, assetsOmitted };
}

/** Every .odraft in the backup folder and its project folders, newest first. */
export async function listSnapshots(): Promise<BackupEntry[]> {
  const { backupFolder } = useSettingsStore.getState();
  if (!isDesktopTauri() || !backupFolder) return [];

  const entries = await collectSnapshotFiles(backupFolder);

  const out: BackupEntry[] = [];
  for (const e of entries) {
    const parsed = parseBackupFilename(e.name);
    if (parsed) {
      out.push({
        path: e.path, name: e.name, title: parsed.title, scriptKey: parsed.scriptKey,
        date: parsed.timestamp, kind: parsed.kind, sizeBytes: e.size, project: e.project,
      });
    } else {
      // An .odraft the user put here themselves (an export, a copy). Listed so
      // it can be recovered, tagged 'external' so it is never pruned.
      out.push({
        path: e.path, name: e.name, title: e.name.replace(/\.odraft$/i, ''),
        scriptKey: 'external',
        date: new Date(e.modified_ms || 0), kind: 'external', sizeBytes: e.size,
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
  if (!isDesktopTauri() || !state.backupFolder || limit <= 0) return 0;

  const entries = await collectSnapshotFiles(state.backupFolder);

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
      await invoke('delete_file', { path: f.path });
      removed++;
    } catch (err) {
      console.warn('[backup] could not delete', f.path, err);
    }
  }
  return removed;
}

/** Read and parse one snapshot. Accepts legacy envelope-less backups. */
export async function readSnapshot(path: string): Promise<ParsedOdraft> {
  const text = await invoke<string>('read_text_file', { path });
  try {
    return parseOdraft(text);
  } catch {
    // Older builds wrote crash backups with no envelope; recover them anyway.
    return parseOdraftLoose(text);
  }
}

export async function deleteSnapshot(path: string): Promise<void> {
  await invoke('delete_file', { path });
}

export async function revealSnapshot(path: string): Promise<void> {
  await invoke('reveal_path', { path });
}

export interface PathProbe {
  exists: boolean;
  is_dir: boolean;
  writable: boolean;
  error: string | null;
}

export async function probeBackupFolder(path: string): Promise<PathProbe> {
  return invoke<PathProbe>('probe_directory', { path });
}
