/**
 * Scripts saved to files the writer keeps on disk (issue #135).
 *
 * A writer who keeps everything on a RAID or network drive wants their scripts
 * *there*, not inside the app. The library database cannot simply be moved:
 * SQLite in WAL mode needs shared memory that network filesystems do not
 * provide reliably, so a movable database would corrupt itself on exactly the
 * drives this is for. Instead:
 *
 *   - Any library script can be **linked** to a file. Every save writes the
 *     file as well as the library, which stays on local disk as the working
 *     copy — versions, notes, assets and the project list keep working.
 *   - A project can be linked to a **folder**: each of its scripts is linked to
 *     a file in it, new scripts get one, renames rename it, and files dropped
 *     into the folder join the project.
 *   - Opening a linked script checks the file first. A change made by
 *     something else (another machine, another app) is loaded — or, if the
 *     library also has changes the file has not received, the writer is asked
 *     which to keep. Nothing is ever overwritten silently.
 *   - A file write that fails — the drive went away — never fails the save.
 *     The library copy is safe, the link is marked pending, and it is retried.
 *
 * Desktop only: iOS and Android hand out per-file handles from their pickers,
 * not folder paths, and their single files are covered by Open from Files.
 *
 * The local storage layer (services/local-storage) calls the `after…` hooks
 * below, so every path that writes a script — editor saves, renames, version
 * restores, duplicates — reaches the file without each caller knowing.
 */
import { api } from './api';
import type { ProjectInfo, ScriptMeta } from './api';
import { isDesktopTauri } from './platform';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLinkedFileStore, type LinkedFileState } from '../stores/linkedFileStore';
import {
  extensionOfPath, isLinkableExtension, normalizeLinkedFormat, formatForScript,
  linkedFileName, uniqueFileName, serializeContentForFormat, parseLinkedFileText, projectFolderName,
  type LinkedFileFormat,
} from '../utils/linkedFileFormat';
import { SAVE_METADATA_KEYS } from '../utils/saveContent';

// ── Platform ────────────────────────────────────────────────────────────────

/** Whether scripts can be linked to files here. */
export function linkingSupported(): boolean {
  return isDesktopTauri();
}

/** A slow or disconnected network share must not leave a save waiting forever. */
const FILE_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out — is the drive connected?`)), FILE_TIMEOUT_MS);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

interface PathStat { exists: boolean; is_dir: boolean; size: number; modified_ms: number }
interface DirEntry { name: string; path: string; is_dir: boolean; size: number; modified_ms: number }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function statPath(path: string): Promise<PathStat> {
  return withTimeout(invoke<PathStat>('stat_path', { path }), `Checking ${basenameOf(path)}`);
}

async function readText(path: string): Promise<string> {
  return withTimeout(invoke<string>('read_text_path', { path }), `Reading ${basenameOf(path)}`);
}

async function writeTextAtomic(path: string, contents: string): Promise<void> {
  await withTimeout(invoke('save_text_atomic', { path, contents }), `Saving ${basenameOf(path)}`);
}

async function listDir(path: string): Promise<DirEntry[]> {
  return withTimeout(invoke<DirEntry[]>('list_dir_entries', { path, extension: null }), 'Reading the folder');
}

/** Open the file manager at a file or folder. */
export async function revealPath(path: string): Promise<void> {
  await invoke('reveal_path', { path });
}

// ── Paths ───────────────────────────────────────────────────────────────────

function separatorFor(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[/\\]+$/, '')}${separatorFor(dir)}${name}`;
}

export function basenameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
}

/** Folder names that say what is inside, not which film it is. */
const GENERIC_FOLDER_NAMES = new Set([
  'script', 'scripts', 'screenplay', 'screenplays', 'draft', 'drafts', 'writing',
]);

/**
 * A name for a project opened from a folder. A writer's scripts often live in
 * `MyFilm/scripts` (issue #135's own example), and a project called "scripts"
 * says nothing — so a generic folder name gives way to its parent's.
 */
export function projectNameForFolder(folder: string): string {
  const parts = folder.split(/[/\\]/).filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  if (GENERIC_FOLDER_NAMES.has(name.toLowerCase()) && parent && !/^[A-Za-z]:$/.test(parent)) return parent;
  return name || 'Untitled Project';
}

/** Case-insensitive on Windows and macOS, where that is how the filesystem compares. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+/g, '/').replace(/\/+$/, '');
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

function isInside(path: string, folder: string): boolean {
  return samePath(dirnameOf(path), folder);
}

// ── Hashing ─────────────────────────────────────────────────────────────────

async function hashText(text: string): Promise<string> {
  const { simpleHash } = await import('./db');
  return simpleHash(text);
}

// ── Links (SQLite) ──────────────────────────────────────────────────────────

export interface ScriptFileLink {
  scriptId: string;
  projectId: string;
  path: string;
  format: LinkedFileFormat;
  syncedHash: string;
  syncedMtime: number;
  pending: boolean;
  lastError: string;
}

interface LinkRow {
  script_id: string;
  project_id: string;
  path: string;
  format: string;
  synced_hash: string;
  synced_mtime: number;
  pending: number;
  last_error: string;
}

function rowToLink(r: LinkRow): ScriptFileLink {
  return {
    scriptId: r.script_id,
    projectId: r.project_id,
    path: r.path,
    format: normalizeLinkedFormat(r.format),
    syncedHash: r.synced_hash || '',
    syncedMtime: Number(r.synced_mtime) || 0,
    pending: Number(r.pending) === 1,
    lastError: r.last_error || '',
  };
}

async function db() {
  const mod = await import('./db');
  return mod.getDb();
}

export async function getLink(scriptId: string): Promise<ScriptFileLink | null> {
  if (!linkingSupported()) return null;
  const rows = await (await db()).select<LinkRow[]>('SELECT * FROM script_files WHERE script_id = $1', [scriptId]);
  return rows.length ? rowToLink(rows[0]) : null;
}

export async function listProjectLinks(projectId: string): Promise<ScriptFileLink[]> {
  if (!linkingSupported()) return [];
  const rows = await (await db()).select<LinkRow[]>('SELECT * FROM script_files WHERE project_id = $1', [projectId]);
  return rows.map(rowToLink);
}

/** The script linked to a file, if any — so opening that file can open the script instead. */
export async function findLinkByPath(path: string): Promise<ScriptFileLink | null> {
  if (!linkingSupported()) return null;
  const rows = await (await db()).select<LinkRow[]>('SELECT * FROM script_files');
  const hit = rows.find((r) => samePath(r.path, path));
  return hit ? rowToLink(hit) : null;
}

async function saveLink(link: ScriptFileLink): Promise<void> {
  await (await db()).execute(
    `INSERT INTO script_files (script_id, project_id, path, format, synced_hash, synced_mtime, pending, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(script_id) DO UPDATE SET
       project_id = excluded.project_id, path = excluded.path, format = excluded.format,
       synced_hash = excluded.synced_hash, synced_mtime = excluded.synced_mtime,
       pending = excluded.pending, last_error = excluded.last_error`,
    [link.scriptId, link.projectId, link.path, link.format, link.syncedHash,
      link.syncedMtime, link.pending ? 1 : 0, link.lastError],
  );
}

async function deleteLink(scriptId: string): Promise<void> {
  await (await db()).execute('DELETE FROM script_files WHERE script_id = $1', [scriptId]);
  useLinkedFileStore.getState().setStatus(scriptId, null);
}

async function addIgnore(projectId: string, name: string): Promise<void> {
  await (await db()).execute(
    'INSERT OR IGNORE INTO project_folder_ignores (project_id, name) VALUES ($1, $2)',
    [projectId, name.toLowerCase()],
  );
}

async function removeIgnore(projectId: string, name: string): Promise<void> {
  await (await db()).execute(
    'DELETE FROM project_folder_ignores WHERE project_id = $1 AND name = $2',
    [projectId, name.toLowerCase()],
  );
}

async function listIgnores(projectId: string): Promise<Set<string>> {
  const rows = await (await db()).select<Array<{ name: string }>>(
    'SELECT name FROM project_folder_ignores WHERE project_id = $1', [projectId],
  );
  return new Set(rows.map((r) => r.name));
}

function publish(link: ScriptFileLink, state?: LinkedFileState): void {
  useLinkedFileStore.getState().setStatus(link.scriptId, {
    path: link.path,
    state: state ?? (link.pending ? 'pending' : 'synced'),
    error: link.lastError || undefined,
  });
}

// ── Per-script serialisation ────────────────────────────────────────────────
// An auto-save and a metadata save can land on the same script within a few
// milliseconds. Two concurrent atomic writes share one temp file name, so they
// are queued per script instead.

const locks = new Map<string, Promise<unknown>>();

function withScriptLock<T>(scriptId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(scriptId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(scriptId, next);
  next.finally(() => { if (locks.get(scriptId) === next) locks.delete(scriptId); }).catch(() => undefined);
  return next;
}

// ── Projects ────────────────────────────────────────────────────────────────

/** The folder a project is linked to, or null for a library-only project. */
export function projectFolder(project: Pick<ProjectInfo, 'properties'> | null | undefined): string | null {
  const path = project?.properties?.folder_path;
  return typeof path === 'string' && path.trim() ? path : null;
}

export function projectFileFormat(project: Pick<ProjectInfo, 'properties'> | null | undefined): LinkedFileFormat {
  return normalizeLinkedFormat(project?.properties?.file_format ?? useSettingsStore.getState().defaultFileFormat);
}

async function loadProject(projectId: string): Promise<ProjectInfo | null> {
  try {
    return await api.getProject(projectId);
  } catch (err) {
    console.warn('[linked-files] could not read project', projectId, err);
    return null;
  }
}

// ── Writing ─────────────────────────────────────────────────────────────────

function serializeFor(link: ScriptFileLink, title: string, content: Record<string, unknown>, meta?: Partial<ScriptMeta>): string {
  const s = useEditorStore.getState();
  return serializeContentForFormat(link.format, content, title, {
    font: { family: s.fontFamily, size: s.fontSize },
    meta,
  });
}

export type WriteOutcome = 'written' | 'pending' | 'conflict';

/**
 * Write a script's library content to its linked file.
 *
 * Never throws: the library save that triggered this already succeeded, and a
 * file that could not be written is recorded as pending and retried. Refuses
 * to overwrite a file that was changed by something else since OpenDraft last
 * wrote or read it unless `force` is set — that is the writer's work too, and
 * only they can say which copy wins.
 */
async function writeLinkedFile(
  link: ScriptFileLink,
  title: string,
  content: Record<string, unknown>,
  options: { force?: boolean; meta?: Partial<ScriptMeta> } = {},
): Promise<WriteOutcome> {
  try {
    if (!options.force && link.syncedHash) {
      const stat = await statPath(link.path);
      if (stat.exists && stat.modified_ms !== link.syncedMtime) {
        const onDisk = await readText(link.path);
        if (await hashText(onDisk) !== link.syncedHash) {
          link.pending = true;
          link.lastError = 'The file was changed outside OpenDraft';
          await saveLink(link);
          publish(link, 'conflict');
          return 'conflict';
        }
      }
    }

    const text = serializeFor(link, title, content, options.meta);
    if (!options.force && await fileAlreadySays(link, title, text, options.meta)) {
      if (link.pending || link.lastError) {
        link.pending = false;
        link.lastError = '';
        await saveLink(link);
      }
      publish(link);
      return 'written';
    }
    await writeTextAtomic(link.path, text);
    const stat = await statPath(link.path);
    link.syncedHash = await hashText(text);
    link.syncedMtime = stat.modified_ms;
    link.pending = false;
    link.lastError = '';
    await saveLink(link);
    publish(link);
    return 'written';
  } catch (err) {
    console.error('[linked-files] could not write', link.path, err);
    link.pending = true;
    link.lastError = errorText(err);
    try { await saveLink(link); } catch (dbErr) { console.error('[linked-files] could not record the failure', dbErr); }
    publish(link);
    return 'pending';
  }
}

/**
 * Whether the file, as it is, already holds `text` — word for word, or once it
 * is read back and written out the way OpenDraft writes it.
 *
 * Opening a script stores the editor's normalised copy of it, and the first
 * save after that differs from what the import stored without the writer
 * having changed a thing. Rewriting the file then would reformat it in
 * OpenDraft's own style — a Fountain file gains a credit line and blank lines —
 * so merely opening a script would modify a file other apps, other machines
 * and version control are watching. Only a file still in step with the last
 * sync is compared; any failure here just lets the write go ahead.
 */
async function fileAlreadySays(
  link: ScriptFileLink,
  title: string,
  text: string,
  meta?: Partial<ScriptMeta>,
): Promise<boolean> {
  try {
    if (!link.syncedHash) return false;
    const stat = await statPath(link.path);
    if (!stat.exists) return false;
    const onDisk = await readText(link.path);
    if (onDisk === text) return true;
    if (await hashText(onDisk) !== link.syncedHash) return false;
    const parsed = await parseLinkedFileText(basenameOf(link.path), onDisk);
    return serializeFor(link, title, parsed.content as Record<string, unknown>, meta) === text;
  } catch (err) {
    console.warn('[linked-files] could not compare with', link.path, err);
    return false;
  }
}

/** Write the script's current library copy to its file. */
async function writeFromLibrary(link: ScriptFileLink, options: { force?: boolean } = {}): Promise<WriteOutcome> {
  const script = await api.getScript(link.projectId, link.scriptId);
  return writeLinkedFile(link, script.meta.title, (script.content ?? {}) as Record<string, unknown>, {
    force: options.force,
    meta: script.meta,
  });
}

/** Pick an unused path in `folder` for a script titled `title`. */
async function freePathIn(folder: string, title: string, format: LinkedFileFormat, exceptPath?: string): Promise<string> {
  let names = new Set<string>();
  try {
    names = new Set((await listDir(folder)).map((e) => e.name.toLowerCase()));
  } catch {
    // The folder may not exist yet; any name is free in that case.
  }
  // Names held by other scripts' links count as taken even before their files
  // exist — two new scripts with one title must not be given one file.
  const rows = await (await db()).select<Array<{ path: string }>>('SELECT path FROM script_files');
  for (const r of rows) if (isInside(r.path, folder)) names.add(basenameOf(r.path).toLowerCase());
  if (exceptPath) names.delete(basenameOf(exceptPath).toLowerCase());
  const name = uniqueFileName(linkedFileName(title, format), (c) => names.has(c.toLowerCase()));
  return joinPath(folder, name);
}

// ── Hooks called by the local storage layer ─────────────────────────────────

/**
 * A script was created. In a folder-linked project it gets a file of its own.
 */
export async function afterScriptCreated(
  projectId: string,
  script: { id: string; title: string; format?: string; content: Record<string, unknown> | null },
): Promise<void> {
  if (!linkingSupported()) return;
  try {
    const project = await loadProject(projectId);
    const folder = projectFolder(project);
    if (!folder) return;
    const content = script.content ?? {};
    const format = formatForScript(projectFileFormat(project), script.format, content);
    await withScriptLock(script.id, async () => {
      const path = await freePathIn(folder, script.title, format);
      const link: ScriptFileLink = {
        scriptId: script.id, projectId, path, format,
        syncedHash: '', syncedMtime: 0, pending: true, lastError: '',
      };
      await saveLink(link);
      await writeLinkedFile(link, script.title, content);
    });
  } catch (err) {
    console.error('[linked-files] could not give the new script a file', err);
  }
}

/**
 * A script was saved. Renames its file when its title changed in a folder
 * project, and writes the file when anything it holds changed.
 */
export async function afterScriptSaved(
  projectId: string,
  scriptId: string,
  change: { title: string; titleChanged: boolean; contentChanged: boolean; content: Record<string, unknown> | null; meta?: Partial<ScriptMeta> },
): Promise<void> {
  if (!linkingSupported()) return;
  try {
    await withScriptLock(scriptId, async () => {
      const link = await getLink(scriptId);
      if (!link || link.projectId !== projectId) return;

      if (change.titleChanged) await renameForTitle(link, change.title);
      if (change.contentChanged || change.titleChanged) {
        await writeLinkedFile(link, change.title, change.content ?? {}, { meta: change.meta });
      }
    });
  } catch (err) {
    console.error('[linked-files] could not update the linked file', err);
  }
}

/** In a folder project the file is named after the script, so it follows a rename. */
async function renameForTitle(link: ScriptFileLink, title: string): Promise<void> {
  const project = await loadProject(link.projectId);
  const folder = projectFolder(project);
  if (!folder || !isInside(link.path, folder)) return;
  const target = await freePathIn(folder, title, link.format, link.path);
  if (target === link.path) return;
  try {
    const stat = await statPath(link.path);
    if (stat.exists) await withTimeout(invoke('rename_path', { from: link.path, to: target }), 'Renaming the file');
    link.path = target;
    await saveLink(link);
    publish(link);
  } catch (err) {
    // Keep the old name rather than lose the link; the content still saves.
    console.warn('[linked-files] could not rename', link.path, 'to', target, err);
  }
}

/**
 * A script was deleted. The file stays — it is the writer's — but a file kept
 * in a linked folder is remembered so the next scan does not add it back.
 */
export async function afterScriptDeleted(projectId: string, scriptId: string): Promise<void> {
  if (!linkingSupported()) return;
  try {
    const link = await getLink(scriptId);
    if (!link) return;
    const folder = projectFolder(await loadProject(projectId));
    if (folder && isInside(link.path, folder)) {
      try {
        const stat = await statPath(link.path);
        if (stat.exists) await addIgnore(projectId, basenameOf(link.path));
      } catch {
        // Unreachable drive: remember it anyway, a re-import would be worse.
        await addIgnore(projectId, basenameOf(link.path));
      }
    }
    await deleteLink(scriptId);
  } catch (err) {
    console.error('[linked-files] could not clean up the link of a deleted script', err);
  }
}

/** A project was deleted. Its files stay on disk; only the links go. */
export async function afterProjectDeleted(projectId: string): Promise<void> {
  if (!linkingSupported()) return;
  try {
    const links = await listProjectLinks(projectId);
    const conn = await db();
    await conn.execute('DELETE FROM script_files WHERE project_id = $1', [projectId]);
    await conn.execute('DELETE FROM project_folder_ignores WHERE project_id = $1', [projectId]);
    for (const l of links) useLinkedFileStore.getState().setStatus(l.scriptId, null);
  } catch (err) {
    console.error('[linked-files] could not clean up the links of a deleted project', err);
  }
}

/**
 * A version was restored, which replaces every script in the project. Each
 * linked file is brought up to date with it, links of scripts the version
 * does not have are dropped, and in a folder project a script that came back
 * gets a file again. The restore is something the writer chose, so files are
 * overwritten even if they were changed elsewhere.
 */
export async function afterVersionRestored(projectId: string): Promise<void> {
  if (!linkingSupported()) return;
  try {
    const scripts = await api.listScripts(projectId);
    const ids = new Set(scripts.map((s) => s.id));
    for (const link of await listProjectLinks(projectId)) {
      if (!ids.has(link.scriptId)) await deleteLink(link.scriptId);
    }
    const project = await loadProject(projectId);
    const folder = projectFolder(project);
    for (const s of scripts) {
      await withScriptLock(s.id, async () => {
        const link = await getLink(s.id);
        if (link) {
          await writeFromLibrary(link, { force: true });
        } else if (folder) {
          const full = await api.getScript(projectId, s.id);
          const content = (full.content ?? {}) as Record<string, unknown>;
          const format = formatForScript(projectFileFormat(project), s.format, content);
          const fresh: ScriptFileLink = {
            scriptId: s.id, projectId, path: await freePathIn(folder, s.title, format), format,
            syncedHash: '', syncedMtime: 0, pending: true, lastError: '',
          };
          await saveLink(fresh);
          await writeLinkedFile(fresh, s.title, content, { meta: full.meta });
        }
      });
    }
  } catch (err) {
    console.error('[linked-files] could not bring linked files up to date after a restore', err);
  }
}

// ── Opening a linked script ─────────────────────────────────────────────────

export type OpenSyncResult =
  /** Not linked, or linking is not available here. */
  | { kind: 'none' }
  /** The file and the library agree (a due write may just have been made). */
  | { kind: 'synced'; path: string }
  /** The file was changed elsewhere and its version is now in the library. */
  | { kind: 'loaded-from-file'; path: string }
  /**
   * Both changed and the writer kept the library's version, now written to
   * the file. The file's own version was saved beside it as `preservedAs`.
   */
  | { kind: 'kept-library'; path: string; preservedAs: string | null; unsavedStored?: boolean }
  /** The file is not there. Saving recreates it. */
  | { kind: 'missing'; path: string }
  /** The drive could not be reached; the library copy opens and the file is retried later. */
  | { kind: 'unreachable'; path: string; error: string };

type FileCheck =
  | { kind: 'same' }
  | { kind: 'missing' }
  | { kind: 'changed'; text: string; hash: string; mtime: number }
  | { kind: 'unreachable'; error: string };

async function inspectFile(link: ScriptFileLink): Promise<FileCheck> {
  try {
    const stat = await statPath(link.path);
    if (!stat.exists) return { kind: 'missing' };
    if (link.syncedHash && stat.modified_ms === link.syncedMtime) return { kind: 'same' };
    const text = await readText(link.path);
    const hash = await hashText(text);
    if (hash === link.syncedHash) {
      // Touched but not changed (a sync client, a backup tool). Remember the
      // new time so the file is not re-read on every open.
      link.syncedMtime = stat.modified_ms;
      await saveLink(link);
      return { kind: 'same' };
    }
    return { kind: 'changed', text, hash, mtime: stat.modified_ms };
  } catch (err) {
    return { kind: 'unreachable', error: errorText(err) };
  }
}

/**
 * The file's content, with every piece of OpenDraft state it does not carry
 * taken from the library's copy instead.
 */
export function mergeKeptMetadata(
  fromFile: Record<string, unknown>,
  library: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...fromFile };
  for (const key of SAVE_METADATA_KEYS) {
    if (merged[key] === undefined && library[key] !== undefined) merged[key] = library[key];
  }
  return merged;
}

/** Today's date and time as `2026-10-07 1432`, for naming preserved copies. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Save the file's version next to it before OpenDraft's replaces it. In a
 * folder project the copy is picked up as a script of its own on the next
 * scan, which is where the writer will look for it. Null when it could not
 * be written — the caller still proceeds, as the writer chose.
 */
async function preserveFileVersion(link: ScriptFileLink, text: string): Promise<string | null> {
  try {
    const dir = dirnameOf(link.path);
    const base = basenameOf(link.path);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    const names = new Set((await listDir(dir)).map((e) => e.name.toLowerCase()));
    const name = uniqueFileName(`${stem} (changed outside OpenDraft ${stamp()})${ext}`, (c) => names.has(c.toLowerCase()));
    const path = joinPath(dir, name);
    await writeTextAtomic(path, text);
    return path;
  } catch (err) {
    console.error('[linked-files] could not keep a copy of the file before overwriting it', err);
    return null;
  }
}

/** Check the project in, so the library's version stays in Version History. */
async function preserveLibraryVersion(link: ScriptFileLink): Promise<void> {
  try {
    await api.checkin(link.projectId, `Before loading ${basenameOf(link.path)}, changed outside OpenDraft`);
  } catch (err) {
    console.error('[linked-files] could not record a version before loading the file', err);
  }
}

/** Replace the library copy with the file's, without writing the file back. */
async function loadFileIntoLibrary(link: ScriptFileLink, text: string, hash: string, mtime: number): Promise<void> {
  const parsed = await parseLinkedFileText(basenameOf(link.path), text);
  // A .fountain or .fdx file has nowhere to keep notes, tags, beats or
  // character profiles, so reading one back must not wipe them from the
  // library: whatever the file does not say, the library's copy keeps.
  let current: Record<string, unknown> = {};
  try {
    current = ((await api.getScript(link.projectId, link.scriptId)).content ?? {}) as Record<string, unknown>;
  } catch (err) {
    console.warn('[linked-files] could not read the library copy to keep its notes', err);
  }
  const content = mergeKeptMetadata(parsed.content, current);
  await api.saveScript(link.projectId, link.scriptId, {
    content,
    allowEmptyBody: true,
    skipFileSync: true,
  });
  link.syncedHash = hash;
  link.syncedMtime = mtime;
  link.pending = false;
  link.lastError = '';
  await saveLink(link);
  publish(link);
}

/**
 * Bring the library copy and the file into agreement before a script opens.
 *
 * `hasUnsavedEdits` is for a script already on screen (a focus re-check): edits
 * only the editor holds count as library changes the file does not have.
 */
export async function syncScriptWithFile(
  projectId: string,
  scriptId: string,
  options: {
    scriptTitle?: string;
    hasUnsavedEdits?: boolean;
    /**
     * Puts edits that are only on screen into the library, once the writer
     * has answered a conflict. Keeping OpenDraft's version then writes them
     * to the file, not just the last saved copy; taking the file's version
     * records them in Version History before the file's replaces them.
     */
    saveUnsavedEdits?: () => Promise<void>;
  } = {},
): Promise<OpenSyncResult> {
  if (!linkingSupported()) return { kind: 'none' };
  try {
    return await withScriptLock(scriptId, async () => {
      const link = await getLink(scriptId);
      if (!link || link.projectId !== projectId) return { kind: 'none' } as const;

      const check = await inspectFile(link);
      switch (check.kind) {
        case 'same':
          if (link.pending) await writeFromLibrary(link);
          else publish(link);
          return { kind: 'synced', path: link.path } as const;
        case 'missing':
          link.pending = true;
          await saveLink(link);
          publish(link, 'missing');
          return { kind: 'missing', path: link.path } as const;
        case 'unreachable':
          link.lastError = check.error;
          publish(link, 'missing');
          return { kind: 'unreachable', path: link.path, error: check.error } as const;
        case 'changed': {
          const libraryChanged = link.pending || options.hasUnsavedEdits === true;
          if (libraryChanged) {
            const choice = await useLinkedFileStore.getState().askConflict(
              options.scriptTitle || basenameOf(link.path), link.path,
            );
            // Whichever version wins, what is on screen is part of
            // OpenDraft's: into the library with it first.
            let unsavedStored = true;
            try {
              await options.saveUnsavedEdits?.();
            } catch (err) {
              unsavedStored = false;
              console.error('[linked-files] could not store the unsaved edits', err);
            }
            if (choice === 'library') {
              // The file's version is somebody's work too: keep it beside the
              // file before overwriting it.
              const preservedAs = await preserveFileVersion(link, check.text);
              await writeFromLibrary(link, { force: true });
              return { kind: 'kept-library', path: link.path, preservedAs, unsavedStored } as const;
            }
            // The library's version, likewise, goes into Version History
            // before the file's replaces it.
            await preserveLibraryVersion(link);
          }
          await loadFileIntoLibrary(link, check.text, check.hash, check.mtime);
          return { kind: 'loaded-from-file', path: link.path } as const;
        }
      }
    });
  } catch (err) {
    console.error('[linked-files] could not check the linked file', err);
    return { kind: 'unreachable', path: '', error: errorText(err) };
  }
}

// ── Linking and unlinking ───────────────────────────────────────────────────

/**
 * Link a script to `path` and write its current library copy there. Any file
 * already at that path is replaced — the writer picked it in a save dialog,
 * which has already asked them about that.
 */
export async function linkScriptToFile(projectId: string, scriptId: string, path: string): Promise<WriteOutcome> {
  const ext = extensionOfPath(path);
  if (!isLinkableExtension(ext)) {
    throw new Error(`OpenDraft can keep scripts in .odraft, .fountain, .fdx or .osf files, not .${ext || '(none)'}.`);
  }
  return withScriptLock(scriptId, async () => {
    const link: ScriptFileLink = {
      scriptId, projectId, path, format: ext,
      syncedHash: '', syncedMtime: 0, pending: true, lastError: '',
    };
    await saveLink(link);
    // The file it was linked from, if any, belongs to the folder's ignore list
    // no more than it did before; the new one should not be ignored.
    await removeIgnore(projectId, basenameOf(path));
    return writeFromLibrary(link, { force: true });
  });
}

/** Stop saving a script to its file. The file stays where it is. */
export async function unlinkScript(scriptId: string): Promise<void> {
  const link = await getLink(scriptId);
  if (!link) return;
  const folder = projectFolder(await loadProject(link.projectId));
  // A file left in a linked folder would be picked straight back up by the next scan.
  if (folder && isInside(link.path, folder)) await addIgnore(link.projectId, basenameOf(link.path));
  await deleteLink(scriptId);
}

/** Delete a script's linked file from disk (the writer asked for it). */
export async function deleteLinkedFile(scriptId: string): Promise<void> {
  const link = await getLink(scriptId);
  if (!link) return;
  const stat = await statPath(link.path);
  if (stat.exists) await withTimeout(invoke('delete_file', { path: link.path }), 'Deleting the file');
  await deleteLink(scriptId);
}

/** Write every pending link. Returns how many still could not be written. */
export async function retryPendingWrites(): Promise<number> {
  if (!linkingSupported()) return 0;
  let rows: LinkRow[];
  try {
    rows = await (await db()).select<LinkRow[]>('SELECT * FROM script_files WHERE pending = 1');
  } catch (err) {
    console.warn('[linked-files] could not list pending writes', err);
    return 0;
  }
  let failed = 0;
  for (const row of rows) {
    const outcome = await withScriptLock(row.script_id, async () => {
      const link = await getLink(row.script_id);
      if (!link || !link.pending) return 'written' as const;
      try {
        const stat = await statPath(dirnameOf(link.path));
        // The folder itself is gone or offline: nothing to do until it returns.
        if (!stat.exists) return 'pending' as const;
      } catch {
        return 'pending' as const;
      }
      return writeFromLibrary(link);
    }).catch(() => 'pending' as const);
    if (outcome !== 'written') failed += 1;
  }
  return failed;
}

// ── Folder projects ─────────────────────────────────────────────────────────

/** Where a new project named `name` goes when the writer has set a default folder. */
export function defaultFolderFor(name: string): string | null {
  const root = useSettingsStore.getState().defaultProjectFolder;
  if (!linkingSupported() || !root) return null;
  return joinPath(root, projectFolderName(name));
}

export interface ScanResult {
  added: number;
  missing: number;
  failed: string[];
}

/**
 * Link a project to a folder: every script gets a file there, and the files
 * already in it join the project. Used for new projects, for "Save to Folder"
 * on an existing one, and for Open Folder as Project.
 */
export async function attachProjectFolder(
  projectId: string,
  folder: string,
  format: LinkedFileFormat,
): Promise<ScanResult> {
  await withTimeout(invoke('ensure_dir', { path: folder }), 'Creating the folder');
  const probe = await withTimeout(
    invoke<{ exists: boolean; writable: boolean; error?: string | null }>('probe_directory', { path: folder }),
    'Checking the folder',
  );
  if (!probe.exists || !probe.writable) {
    throw new Error(`OpenDraft can't write to ${folder}${probe.error ? ` — ${probe.error}` : ''}`);
  }

  const project = await api.getProject(projectId);
  await api.updateProject(projectId, {
    properties: { ...project.properties, folder_path: folder, file_format: format },
  });

  // Scripts the project already has, written out first so the scan below
  // sees their files as taken rather than importing them a second time.
  const scripts = await api.listScripts(projectId);
  for (const s of scripts) {
    await withScriptLock(s.id, async () => {
      const existing = await getLink(s.id);
      if (existing && isInside(existing.path, folder)) return;
      const full = await api.getScript(projectId, s.id);
      const content = (full.content ?? {}) as Record<string, unknown>;
      const scriptFormat = formatForScript(format, s.format, content);
      const link: ScriptFileLink = {
        scriptId: s.id, projectId, path: await freePathIn(folder, s.title, scriptFormat), format: scriptFormat,
        syncedHash: '', syncedMtime: 0, pending: true, lastError: '',
      };
      await saveLink(link);
      await writeLinkedFile(link, s.title, content, { meta: full.meta, force: true });
    });
  }
  return scanProjectFolder(projectId);
}

/**
 * Add the folder's files that are not in the project yet, and report linked
 * files that are no longer there. Called whenever a folder project is opened.
 */
export async function scanProjectFolder(projectId: string): Promise<ScanResult> {
  const result: ScanResult = { added: 0, missing: 0, failed: [] };
  if (!linkingSupported()) return result;
  const project = await loadProject(projectId);
  const folder = projectFolder(project);
  if (!folder) return result;

  const entries = await listDir(folder);
  const links = await listProjectLinks(projectId);
  const linked = new Set(links.map((l) => basenameOf(l.path).toLowerCase()));
  const ignored = await listIgnores(projectId);
  const present = new Set(entries.map((e) => e.name.toLowerCase()));

  for (const l of links) {
    if (isInside(l.path, folder) && !present.has(basenameOf(l.path).toLowerCase())) {
      result.missing += 1;
      publish(l, 'missing');
    }
  }

  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (entry.is_dir || entry.name.startsWith('.') || linked.has(key) || ignored.has(key)) continue;
    const ext = extensionOfPath(entry.name);
    if (!isLinkableExtension(ext)) continue;
    // Another project may already keep this file; two projects writing one file
    // would overwrite each other.
    if (await findLinkByPath(entry.path)) continue;
    try {
      const text = await readText(entry.path);
      const parsed = await parseLinkedFileText(entry.name, text);
      const title = parsed.title || entry.name.replace(/\.[^.]+$/, '') || 'Untitled';
      const created = await api.createScript(projectId, {
        title,
        content: parsed.content,
        format: parsed.scriptFormat,
        skipFileSync: true,
      });
      const link: ScriptFileLink = {
        scriptId: created.meta.id, projectId, path: entry.path, format: ext,
        syncedHash: await hashText(text), syncedMtime: entry.modified_ms, pending: false, lastError: '',
      };
      await saveLink(link);
      publish(link);
      result.added += 1;
    } catch (err) {
      console.warn('[linked-files] could not add', entry.path, err);
      result.failed.push(entry.name);
    }
  }
  return result;
}

/** Create a project and link it to `folder`, adding whatever files are already there. */
export async function createProjectInFolder(
  name: string,
  folder: string,
  format: LinkedFileFormat,
): Promise<{ project: ProjectInfo; scan: ScanResult }> {
  const project = await api.createProject(name);
  try {
    const scan = await attachProjectFolder(project.id, folder, format);
    return { project: await api.getProject(project.id), scan };
  } catch (err) {
    // A project the writer did not get, sitting in their list, would be a
    // confusing leftover of a failure — remove it and report the failure.
    try { await api.deleteProject(project.id); } catch { /* best-effort */ }
    throw err;
  }
}

/**
 * Stop keeping a project in its folder. The files stay where they are; the
 * library keeps the scripts.
 */
export async function detachProjectFolder(projectId: string): Promise<void> {
  const project = await api.getProject(projectId);
  const folder = projectFolder(project);
  if (folder) {
    for (const l of await listProjectLinks(projectId)) {
      if (isInside(l.path, folder)) await deleteLink(l.scriptId);
    }
  }
  await (await db()).execute('DELETE FROM project_folder_ignores WHERE project_id = $1', [projectId]);
  await api.updateProject(projectId, {
    properties: { ...project.properties, folder_path: '', file_format: project.properties.file_format },
  });
}

/**
 * Move a folder project's files to another folder. Each script is written to
 * the new folder first; its old file is deleted only once the new one is safe.
 */
export async function moveProjectFolder(projectId: string, newFolder: string): Promise<{ moved: number; failed: string[] }> {
  const project = await api.getProject(projectId);
  const oldFolder = projectFolder(project);
  if (!oldFolder) throw new Error('This project is not saved to a folder.');
  if (samePath(oldFolder, newFolder)) return { moved: 0, failed: [] };

  await withTimeout(invoke('ensure_dir', { path: newFolder }), 'Creating the folder');
  const failed: string[] = [];
  let moved = 0;
  for (const l of await listProjectLinks(projectId)) {
    if (!isInside(l.path, oldFolder)) continue;
    await withScriptLock(l.scriptId, async () => {
      const oldPath = l.path;
      const link = { ...l, path: await freePathIn(newFolder, basenameOf(oldPath).replace(/\.[^.]+$/, ''), l.format) };
      const outcome = await writeFromLibrary(link, { force: true });
      if (outcome !== 'written') {
        failed.push(basenameOf(oldPath));
        // Keep the link on the old file, which still holds the script.
        await saveLink({ ...l, pending: true, lastError: link.lastError });
        return;
      }
      moved += 1;
      try {
        const stat = await statPath(oldPath);
        if (stat.exists) await withTimeout(invoke('delete_file', { path: oldPath }), 'Removing the old file');
      } catch (err) {
        console.warn('[linked-files] moved, but could not remove the old file', oldPath, err);
      }
    });
  }
  await (await db()).execute('DELETE FROM project_folder_ignores WHERE project_id = $1', [projectId]);
  await api.updateProject(projectId, { properties: { ...project.properties, folder_path: newFolder } });
  return { moved, failed };
}

/** Change the format new scripts in a folder project are written in. */
export async function setProjectFileFormat(projectId: string, format: LinkedFileFormat): Promise<ProjectInfo> {
  const project = await api.getProject(projectId);
  return api.updateProject(projectId, { properties: { ...project.properties, file_format: format } });
}

/** Ask for a folder. Null when the writer cancelled. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof picked === 'string' ? picked : null;
}
