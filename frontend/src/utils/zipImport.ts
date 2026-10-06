/**
 * Zip import — reads an archive written by exportProjectAsZip into a new
 * project. See zipExport.ts for the layout. Version 1 archives (no
 * zip_version, no assets, no color/pinned/sort_order in the meta files) are
 * still accepted.
 */

import JSZip from 'jszip';
import { api, ApiError } from '../services/api';
import type { ProjectInfo, ProjectProperties, ScriptMeta, ScriptResponse } from '../services/api';
import type { AssetIndexEntry } from './zipExport';
import { uuid } from './uuid';

/** The part of `api` the import writes through. */
export interface ZipImportClient {
  createProject: (name: string) => Promise<ProjectInfo>;
  updateProject: (id: string, data: { properties?: Partial<ProjectProperties> }) => Promise<ProjectInfo>;
  deleteProject: (id: string) => Promise<unknown>;
  createScript: (projectId: string, data: { title: string; content?: unknown; format?: string }) => Promise<ScriptResponse>;
  saveScript: (projectId: string, scriptId: string, data: { color?: string; pinned?: boolean; sort_order?: number }) => Promise<ScriptResponse>;
  importAsset?: (projectId: string, asset: { id: string; filename: string; mime_type: string; bytes: Uint8Array }) => Promise<void>;
}

export interface ZipImportResult {
  projectId: string;
  imported: number;
  /** Titles of scripts that could not be imported. */
  failed: string[];
  assetsRestored: number;
  /** The archive was made somewhere that could not read image bytes. */
  assetsOmitted: boolean;
  /** Images the archive carried that could not be written here. */
  assetsFailed: number;
  propertiesRestored: boolean;
}

interface ScriptEntry {
  name: string;
  /** Position in the archive — v1 archives carry no sort_order, but were
   *  written in the project's list order. */
  index: number;
  metaPath?: string;
  contentPath?: string;
}

const META_SUFFIX = '.meta.json';
const CONTENT_SUFFIX = '.json';

/**
 * Pair up `{name}.meta.json` and `{name}.json` files under `prefix`.
 *
 * Suffix matching, not a regex: the old `/(.+)\.(meta\.json|json)$/` let the
 * greedy `.+` swallow ".meta", so every meta file was read as the content of a
 * second script named "{name}.meta" — the "duplicated screenplay" users saw.
 */
export function groupScriptFiles(paths: string[], prefix: string): ScriptEntry[] {
  const byName = new Map<string, ScriptEntry>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    let name: string;
    let isMeta: boolean;
    if (rest.toLowerCase().endsWith(META_SUFFIX)) {
      name = rest.slice(0, -META_SUFFIX.length);
      isMeta = true;
    } else if (rest.toLowerCase().endsWith(CONTENT_SUFFIX)) {
      name = rest.slice(0, -CONTENT_SUFFIX.length);
      isMeta = false;
    } else {
      continue;
    }
    if (!name) continue;
    let entry = byName.get(name);
    if (!entry) {
      entry = { name, index: byName.size };
      byName.set(name, entry);
    }
    if (isMeta) entry.metaPath = path;
    else entry.contentPath = path;
  }
  return Array.from(byName.values());
}

/**
 * Point every reference to an imported image at its new id and the new
 * project: image nodes (`attrs.assetId` + `attrs.projectId`) and character
 * profile portraits. Images are imported under fresh ids because an asset id
 * is unique across the whole local database — importing a project back into
 * the library it came from would otherwise collide with the original's rows.
 * References to images that did not come across are left as they were.
 */
export function remapAssets<T>(content: T, idMap: Map<string, string>, newProjectId: string): T {
  if (idMap.size === 0) return content;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(v);
    }
    const attrs = out.attrs as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object' && typeof attrs.assetId === 'string' && idMap.has(attrs.assetId)) {
      out.attrs = {
        ...attrs,
        assetId: idMap.get(attrs.assetId),
        ...('projectId' in attrs ? { projectId: newProjectId } : {}),
      };
    }
    return out;
  };
  const result = walk(content) as Record<string, unknown>;

  // Portraits: a list of ids, or of { id | assetId, … } (see snapshotAssets).
  const profiles = result && typeof result === 'object' ? result._characterProfiles : undefined;
  if (Array.isArray(profiles)) {
    result._characterProfiles = profiles.map((p) => {
      if (!p || typeof p !== 'object' || !Array.isArray((p as Record<string, unknown>).images)) return p;
      const images = ((p as Record<string, unknown>).images as unknown[]).map((img) => {
        if (typeof img === 'string') return idMap.get(img) ?? img;
        if (img && typeof img === 'object') {
          const rec = { ...(img as Record<string, unknown>) };
          for (const key of ['assetId', 'id']) {
            if (typeof rec[key] === 'string' && idMap.has(rec[key] as string)) rec[key] = idMap.get(rec[key] as string);
          }
          return rec;
        }
        return img;
      });
      return { ...(p as Record<string, unknown>), images };
    });
  }
  return result as T;
}

async function readJson(zip: JSZip, path: string): Promise<unknown> {
  const file = zip.file(path);
  if (!file) throw new Error(`missing ${path}`);
  const text = await file.async('string');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Import a zip file as a new project. */
export async function importProjectFromZip(
  input: File | ArrayBuffer,
  fileName = '',
  client: ZipImportClient = api as unknown as ZipImportClient,
): Promise<ZipImportResult> {
  const isFile = typeof File !== 'undefined' && input instanceof File;
  const buf = isFile ? await (input as File).arrayBuffer() : (input as ArrayBuffer);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    console.error('[zipImport] not a readable zip', err);
    throw new Error('This file is not a valid zip archive');
  }

  const paths: string[] = [];
  zip.forEach((path, entry) => { if (!entry.dir) paths.push(path); });

  if (!zip.file('project.json')) {
    // A single-script archive puts its pair at the root. Say so, rather than
    // the bare "missing project.json" that told the writer nothing.
    if (groupScriptFiles(paths, '').length > 0) {
      throw new Error('This zip holds a single script, not a project. Import it from inside a project instead.');
    }
    throw new Error('Invalid project archive: missing project.json');
  }

  const projectRaw = await readJson(zip, 'project.json');
  const projectData = isRecord(projectRaw) ? projectRaw : {};
  const fallbackName = (isFile ? (input as File).name : fileName).replace(/\.zip$/i, '');
  const baseName = (typeof projectData.name === 'string' && projectData.name.trim())
    || fallbackName || 'Imported Project';

  let project: ProjectInfo;
  try {
    project = await client.createProject(baseName);
  } catch (err) {
    // Only a name clash (the web backend's project ids are name slugs) is
    // worth a retry; anything else is a real failure the writer should see.
    if (!(err instanceof ApiError && err.status === 409)) throw err;
    project = await client.createProject(`${baseName} (${new Date().toLocaleString()})`);
  }

  try {
    // ── Properties ── logline, author, WGA, the project dictionary…
    let propertiesRestored = true;
    if (isRecord(projectData.properties)) {
      try {
        await client.updateProject(project.id, { properties: projectData.properties as Partial<ProjectProperties> });
      } catch (err) {
        console.error('[zipImport] could not restore project properties', err);
        propertiesRestored = false;
      }
    }

    // ── Assets ── under fresh ids; the scripts are rewritten to match below.
    const idMap = new Map<string, string>();
    let assetsFailed = 0;
    if (zip.file('assets/index.json')) {
      const indexRaw = await readJson(zip, 'assets/index.json');
      const index = Array.isArray(indexRaw) ? (indexRaw as AssetIndexEntry[]) : [];
      for (const asset of index) {
        const file = typeof asset?.path === 'string' ? zip.file(asset.path) : null;
        if (!file || typeof asset.id !== 'string' || typeof asset.filename !== 'string') {
          assetsFailed++;
          continue;
        }
        if (typeof client.importAsset !== 'function') {
          assetsFailed++;
          continue;
        }
        try {
          const newId = uuid();
          await client.importAsset(project.id, {
            id: newId,
            // Files live in a per-project folder, so the name can stay.
            filename: asset.filename,
            mime_type: asset.mime_type || 'application/octet-stream',
            bytes: await file.async('uint8array'),
          });
          idMap.set(asset.id, newId);
        } catch (err) {
          console.warn('[zipImport] could not restore asset', asset.id, err);
          assetsFailed++;
        }
      }
    }

    // ── Scripts ── read every pair first, so order can be settled before any
    // is created; then create one at a time, which keeps that order.
    const entries = groupScriptFiles(paths, 'scripts/');
    const failed: string[] = [];
    const prepared: Array<{ title: string; meta: Partial<ScriptMeta>; content: Record<string, unknown> }> = [];
    const order: Array<{ sortOrder: number; index: number }> = [];

    for (const entry of entries) {
      try {
        const metaRaw = entry.metaPath ? await readJson(zip, entry.metaPath) : {};
        const meta = (isRecord(metaRaw) ? metaRaw : {}) as Partial<ScriptMeta>;
        const contentRaw = entry.contentPath ? await readJson(zip, entry.contentPath) : {};
        const content = remapAssets(isRecord(contentRaw) ? contentRaw : {}, idMap, project.id);
        const title = (typeof meta.title === 'string' && meta.title) || entry.name;
        prepared.push({ title, meta, content });
        order.push({
          sortOrder: typeof meta.sort_order === 'number' ? meta.sort_order : Number.MAX_SAFE_INTEGER,
          index: entry.index,
        });
      } catch (err) {
        console.error('[zipImport] could not read script', entry.name, err);
        failed.push(entry.name);
      }
    }

    const sorted = prepared
      .map((p, i) => ({ ...p, ...order[i] }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index);

    let imported = 0;
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      try {
        const created = await client.createScript(project.id, {
          title: s.title,
          content: s.content,
          ...(typeof s.meta.format === 'string' ? { format: s.meta.format } : {}),
        });
        imported++;
        // createScript takes none of these. sort_order is renumbered rather
        // than copied: scripts that were never reordered all carry 0, and
        // creation order alone is not a stable sort key.
        try {
          await client.saveScript(project.id, created.meta.id, {
            sort_order: i,
            ...(typeof s.meta.color === 'string' ? { color: s.meta.color } : {}),
            ...(typeof s.meta.pinned === 'boolean' ? { pinned: s.meta.pinned } : {}),
          });
        } catch (err) {
          console.warn('[zipImport] could not restore color/pin/order for', s.title, err);
        }
      } catch (err) {
        console.error('[zipImport] could not create script', s.title, err);
        failed.push(s.title);
      }
    }

    if (imported === 0 && failed.length > 0) {
      throw new Error(`None of the ${failed.length} scripts could be imported`);
    }

    return {
      projectId: project.id,
      imported,
      failed,
      assetsRestored: idMap.size,
      assetsOmitted: projectData.assets_omitted === true,
      assetsFailed,
      propertiesRestored,
    };
  } catch (err) {
    // Don't leave an empty husk of a project behind a failed import.
    try {
      await client.deleteProject(project.id);
    } catch (cleanupErr) {
      console.warn('[zipImport] could not remove the half-imported project', cleanupErr);
    }
    throw err;
  }
}
