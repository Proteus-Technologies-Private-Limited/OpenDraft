/**
 * Recovery path: when SQLite is reachable again after a session in
 * file-fallback mode, copy any data from the fallback index/files into
 * SQLite.  Never overwrites — if a project or script with the same title
 * already exists, the imported one is renamed with a `(recovered)` suffix
 * so both copies survive.
 *
 * Triggered from `initStorage` after a successful SQLite init.  No-op when
 * the fallback index is empty.
 */

import {
  readTextFile,
  readFile,
  writeFile,
  exists,
  remove,
  mkdir,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import type { ProjectInfo, ScriptMeta, ScriptResponse } from './api';

const INDEX_KEY = 'opendraft:file-fallback:index';
const ROOT_DIR = 'file-fallback';
const SCRIPTS_DIR = `${ROOT_DIR}/scripts`;
const ASSETS_DIR = `${ROOT_DIR}/assets`;

interface AssetMeta {
  id: string;
  project_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  tags: string[];
  created_at: string;
}

interface IndexShape {
  projects: Record<string, ProjectInfo>;
  scripts: Record<string, { meta: ScriptMeta; project_id: string }>;
  assets: Record<string, AssetMeta>;
  templates: Record<string, any>;
}

export interface RecoveryResult {
  projects: number;
  scripts: number;
  assets: number;
  templates: number;
  /** Errors encountered for individual items.  Non-empty means the index was
   *  preserved for retry on next launch. */
  errors: string[];
}

/**
 * Pick a name not already in `taken`.  Tries `<name> (recovered)` first, then
 * `<name> (recovered 2)`, `<name> (recovered 3)`, ...
 */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const base = `${name} (recovered)`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name} (recovered ${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fall back to a timestamp suffix in the (statistically impossible) case.
  return `${name} (recovered ${Date.now()})`;
}

function loadIndex(): IndexShape | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      projects: parsed.projects || {},
      scripts: parsed.scripts || {},
      assets: parsed.assets || {},
      templates: parsed.templates || {},
    };
  } catch {
    return null;
  }
}

function isEmpty(idx: IndexShape): boolean {
  return (
    Object.keys(idx.projects).length === 0 &&
    Object.keys(idx.scripts).length === 0 &&
    Object.keys(idx.assets).length === 0 &&
    Object.keys(idx.templates).length === 0
  );
}

async function readScriptContent(scriptId: string): Promise<any | null> {
  const path = `${SCRIPTS_DIR}/${scriptId}.json`;
  if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return null;
  const text = await readTextFile(path, { baseDir: BaseDirectory.AppData });
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Copy a fallback asset file into the SQLite-managed `assets/` tree.
 * Asset IDs are preserved (they are UUIDs and content references inside
 * scripts use them) so script content stays valid post-migration.
 */
async function copyAssetFile(
  oldProjectId: string,
  newProjectId: string,
  filename: string,
): Promise<void> {
  const src = `${ASSETS_DIR}/${oldProjectId}/${filename}`;
  const destDir = `assets/${newProjectId}`;
  const dest = `${destDir}/${filename}`;
  if (!(await exists(src, { baseDir: BaseDirectory.AppData }))) {
    throw new Error(`Source asset missing: ${src}`);
  }
  if (!(await exists(destDir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(destDir, { baseDir: BaseDirectory.AppData, recursive: true });
  }
  const bytes = await readFile(src, { baseDir: BaseDirectory.AppData });
  await writeFile(dest, bytes, { baseDir: BaseDirectory.AppData });
}

/**
 * Best-effort cleanup of fallback files and the localStorage index after a
 * fully successful migration.  Skipped if `errors` is non-empty so the user
 * can retry next launch.
 */
async function cleanupAfterSuccess(idx: IndexShape): Promise<void> {
  for (const sid of Object.keys(idx.scripts)) {
    const path = `${SCRIPTS_DIR}/${sid}.json`;
    try {
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        await remove(path, { baseDir: BaseDirectory.AppData });
      }
    } catch (e) {
      console.warn(`[recovery] could not remove ${path}`, e);
    }
  }
  for (const a of Object.values(idx.assets)) {
    const path = `${ASSETS_DIR}/${a.project_id}/${a.filename}`;
    try {
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        await remove(path, { baseDir: BaseDirectory.AppData });
      }
    } catch (e) {
      console.warn(`[recovery] could not remove asset ${path}`, e);
    }
  }
  // Mark migration complete — we keep a timestamp so support can confirm
  // the recovery actually fired, but drop the bulk index immediately.
  localStorage.setItem(`${INDEX_KEY}:migrated`, new Date().toISOString());
  localStorage.removeItem(INDEX_KEY);
}

/**
 * Run the recovery against a working SQLite-backed `api` object.  The shape
 * of `sqliteApi` matches the methods exposed by `local-storage.ts` (createProject,
 * updateProject, listScripts, createScript, listFormattingTemplates, etc.).
 */
export async function migrateFileFallbackToSqlite(
  sqliteApi: any,
): Promise<RecoveryResult | null> {
  const idx = loadIndex();
  if (!idx || isEmpty(idx)) return null;

  const result: RecoveryResult = {
    projects: 0,
    scripts: 0,
    assets: 0,
    templates: 0,
    errors: [],
  };

  // ── Projects ──────────────────────────────────────────────────────────────
  // Build a name set from existing SQLite projects so we can rename collisions.
  let existingProjects: ProjectInfo[];
  try {
    existingProjects = await sqliteApi.listProjects();
  } catch (e) {
    result.errors.push(`listProjects: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  const takenProjectNames = new Set(existingProjects.map((p) => p.name));
  const oldToNewProjectId: Record<string, string> = {};

  for (const [oldPid, project] of Object.entries(idx.projects)) {
    try {
      const name = uniqueName(project.name, takenProjectNames);
      const created = await sqliteApi.createProject(name);
      // createProject only sets the name; carry over properties + presentation.
      await sqliteApi.updateProject(created.id, {
        properties: project.properties,
        color: project.color,
        pinned: project.pinned,
        sort_order: project.sort_order,
      });
      oldToNewProjectId[oldPid] = created.id;
      takenProjectNames.add(name);
      result.projects += 1;
    } catch (e) {
      result.errors.push(
        `project "${project.name}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Scripts ───────────────────────────────────────────────────────────────
  for (const [oldSid, entry] of Object.entries(idx.scripts)) {
    const newProjectId = oldToNewProjectId[entry.project_id];
    if (!newProjectId) {
      result.errors.push(
        `script "${entry.meta.title}": parent project missing`,
      );
      continue;
    }
    try {
      const content = await readScriptContent(oldSid);
      // Build a name set from the (just-created) project's existing scripts.
      const existingInProj: ScriptMeta[] = await sqliteApi.listScripts(newProjectId);
      const takenTitles = new Set(existingInProj.map((s) => s.title));
      const title = uniqueName(entry.meta.title, takenTitles);
      const created: ScriptResponse = await sqliteApi.createScript(newProjectId, {
        title,
        content,
      });
      // Carry presentation fields the createScript signature doesn't accept.
      await sqliteApi.saveScript(newProjectId, created.meta.id, {
        color: entry.meta.color,
        pinned: entry.meta.pinned,
        sort_order: entry.meta.sort_order,
      });
      result.scripts += 1;
    } catch (e) {
      result.errors.push(
        `script "${entry.meta.title}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  // Need to copy file + insert SQLite row.  We use the local-storage `db`
  // handle indirectly: createScript / saveScript don't accept asset rows, so
  // we go through a dedicated path on `sqliteApi` if it exists.  When no such
  // method exists (older builds), we fall back to skipping assets — the
  // localStorage index entries stay so the user can retry later.
  if (Object.keys(idx.assets).length > 0 && typeof sqliteApi._registerImportedAsset === 'function') {
    for (const [aid, a] of Object.entries(idx.assets)) {
      const newProjectId = oldToNewProjectId[a.project_id];
      if (!newProjectId) {
        result.errors.push(`asset "${a.original_name}": parent project missing`);
        continue;
      }
      try {
        await copyAssetFile(a.project_id, newProjectId, a.filename);
        await sqliteApi._registerImportedAsset({
          id: aid,
          project_id: newProjectId,
          filename: a.filename,
          original_name: a.original_name,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          tags: a.tags,
          created_at: a.created_at,
        });
        result.assets += 1;
      } catch (e) {
        result.errors.push(
          `asset "${a.original_name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } else if (Object.keys(idx.assets).length > 0) {
    result.errors.push(
      `${Object.keys(idx.assets).length} asset(s) skipped — SQLite layer missing _registerImportedAsset hook`,
    );
  }

  // ── Templates ─────────────────────────────────────────────────────────────
  if (Object.keys(idx.templates).length > 0) {
    let existingTemplates: any[] = [];
    try {
      existingTemplates = await sqliteApi.listFormattingTemplates();
    } catch (e) {
      result.errors.push(
        `listFormattingTemplates: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const takenTplNames = new Set(existingTemplates.map((t) => t.name));
    for (const [, tpl] of Object.entries(idx.templates)) {
      try {
        const name = uniqueName(tpl.name || 'Template', takenTplNames);
        await sqliteApi.createFormattingTemplate({ ...tpl, name });
        takenTplNames.add(name);
        result.templates += 1;
      } catch (e) {
        result.errors.push(
          `template "${tpl.name || 'Template'}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Only nuke the fallback files/index when everything succeeded.  Otherwise
  // leave them in place so the next launch retries the failures (and the
  // already-imported items become visible duplicates we can dedupe later).
  if (result.errors.length === 0) {
    await cleanupAfterSuccess(idx);
  } else {
    console.warn('[recovery] migration finished with errors, fallback index preserved:', result.errors);
  }

  return result;
}
