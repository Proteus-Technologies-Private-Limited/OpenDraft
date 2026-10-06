/**
 * Zip export for a whole project.
 *
 * Layout (zip_version 2):
 *   project.json             project name, properties, zip_version, assets_omitted?
 *   scripts/{name}.meta.json title, format, color, pinned, sort_order, …
 *   scripts/{name}.json      the full save payload (document + _notes, _tags, …)
 *   assets/index.json        [{ id, filename, mime_type, path }]
 *   assets/{id}__{filename}  raw image bytes
 *
 * Version 1 archives had no zip_version, no assets, and stripped color, pinned
 * and sort_order from the meta files; zipImport still reads them.
 */

import JSZip from 'jszip';
import { api } from '../services/api';
import type { ProjectInfo, ScriptMeta, ScriptResponse } from '../services/api';
import { assetBytesReader, collectAssetRefs, mimeFor } from '../services/snapshotAssets';

export const ZIP_VERSION = 2;

/** The part of `api` / `cloudApi` the export reads from. */
export interface ZipExportClient {
  getProject: (id: string) => Promise<ProjectInfo>;
  listScripts: (projectId: string) => Promise<ScriptMeta[]>;
  getScript: (projectId: string, scriptId: string) => Promise<ScriptResponse>;
}

export interface AssetIndexEntry {
  id: string;
  filename: string;
  mime_type: string;
  path: string;
}

/** Sanitize a string for use as a filename. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled';
}

function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/** De-duplicate filenames by appending (2), (3), etc. */
function dedup(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((n) => {
    const lower = n.toLowerCase();
    const count = (counts.get(lower) || 0) + 1;
    counts.set(lower, count);
    return count > 1 ? `${n} (${count})` : n;
  });
}

/**
 * Build the project archive in memory.
 *
 * Throws if any script cannot be read: an archive that silently leaves a
 * script out looks complete and is not, which is worse than no archive.
 * Images that cannot be read are reported in `missingAssets` instead — a
 * missing picture should not cost the writer their whole backup.
 */
export async function buildProjectZip(
  projectId: string,
  client: ZipExportClient = api,
): Promise<{ data: Uint8Array; projectName: string; assetsOmitted: boolean; missingAssets: string[] }> {
  const project = await client.getProject(projectId);
  const scriptMetas = await client.listScripts(projectId);

  const results = await Promise.allSettled(
    scriptMetas.map((m) => client.getScript(projectId, m.id)),
  );
  const unreadable = scriptMetas
    .filter((_, i) => results[i].status === 'rejected')
    .map((m) => m.title || 'Untitled');
  if (unreadable.length > 0) {
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error('[zipExport] could not read script', scriptMetas[i].id, r.reason);
    });
    throw new Error(`Could not read ${unreadable.length === 1 ? 'script' : 'scripts'}: ${unreadable.join(', ')}`);
  }
  const scripts = results.map((r) => (r as PromiseFulfilledResult<ScriptResponse>).value);

  const zip = new JSZip();

  // ── Assets ── only local storage can hand back raw bytes.
  const readBytes = assetBytesReader(client);
  const refs = new Map<string, { id: string; filename: string }>();
  for (const s of scripts) {
    for (const ref of collectAssetRefs(s.content)) {
      if (!refs.has(ref.id)) refs.set(ref.id, ref);
    }
  }
  const assetsOmitted = refs.size > 0 && !readBytes;
  const missingAssets: string[] = [];
  const assetIndex: AssetIndexEntry[] = [];
  if (readBytes) {
    for (const ref of refs.values()) {
      try {
        const bytes = await readBytes(projectId, ref.id);
        const path = `assets/${ref.id}__${sanitizeFilename(ref.filename)}`;
        zip.file(path, bytes);
        assetIndex.push({ id: ref.id, filename: ref.filename, mime_type: mimeFor(ref.filename), path });
      } catch (err) {
        console.warn('[zipExport] could not read asset', ref.id, err);
        missingAssets.push(ref.filename);
      }
    }
    if (assetIndex.length > 0) {
      zip.file('assets/index.json', JSON.stringify(assetIndex, null, 2));
    }
  }

  // ── Project ── color/pinned/sort_order are about this machine's project list.
  zip.file('project.json', JSON.stringify({
    ...omit(project, ['color', 'pinned', 'sort_order']),
    zip_version: ZIP_VERSION,
    ...(assetsOmitted ? { assets_omitted: true } : {}),
  }, null, 2));

  // ── Scripts ──
  if (scripts.length > 0) {
    const scriptsFolder = zip.folder('scripts')!;
    const fileNames = dedup(scripts.map((s) => sanitizeFilename(s.meta.title || 'Untitled')));
    scripts.forEach((resp, i) => {
      // The id belongs to this machine; the size is recomputed on save.
      const metaClean = omit(resp.meta, ['id', 'size_bytes']);
      scriptsFolder.file(`${fileNames[i]}.meta.json`, JSON.stringify(metaClean, null, 2));
      scriptsFolder.file(`${fileNames[i]}.json`, JSON.stringify(resp.content || {}, null, 2));
    });
  }

  const data = await zip.generateAsync({ type: 'uint8array' });
  return { data, projectName: sanitizeFilename(project.name || 'project'), assetsOmitted, missingAssets };
}

/**
 * Export an entire project as a zip and hand it to the save dialog.
 * `saved` is false when the user cancelled the save dialog.
 */
export async function exportProjectAsZip(
  projectId: string,
  client: ZipExportClient = api,
): Promise<{ saved: boolean; assetsOmitted: boolean; missingAssets: string[] }> {
  const { data, projectName, assetsOmitted, missingAssets } = await buildProjectZip(projectId, client);
  const { saveFile } = await import('./fileOps');
  const saved = await saveFile(data, `${projectName}.zip`, [{ name: 'ZIP Archive', extensions: ['zip'] }]);
  return { saved, assetsOmitted, missingAssets };
}
