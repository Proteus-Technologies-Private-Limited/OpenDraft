/** Syncs everything in a device project besides its screenplays: the project's
 * details (name, colour, title-page and production properties), its Location
 * Database, and its pictures and other assets. Runs inside each device-project
 * sync pass (deviceProjectSync.ts), under the same per-project lock.
 *
 * Details and locations are three-way merged against what both sides last
 * agreed on, so a change on either side reaches the other; where both changed
 * the same field or record, this device's version wins and the cloud's is
 * replaced — there is nothing as large as a scene to lose, and asking about a
 * logline in the background would be worse. Assets never change once stored,
 * so they are a union: each side gets what it lacks. Like screenplays, a
 * deletion is not copied: a picture deleted on one side is left on the other,
 * where a document may still show it.
 *
 * A server that predates these routes answers 404 or 405; that part is skipped
 * and the screenplays still sync. */
import { api, ApiError, type LocationEntry, type ProjectInfo, type ProjectProperties } from './api';
import { cloudApi, type CloudRequestScope } from './cloudApi';
import {
  readDeviceLocationsRaw, readProjectSyncBases, rememberProjectSyncBases, writeDeviceLocations,
  type DeviceBinding,
} from './deviceSyncStore';
import { sanitizeLocations } from '../utils/locationData';
import { applyMerge, mergeScripts } from '../utils/scriptMerge';

/** Properties that describe this device's copy, not the project. */
const DEVICE_ONLY = new Set(['folder_path', 'file_format']);
/** The server's own limit for one asset (asset_service.MAX_FILE_SIZE). */
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

type Details = Record<string, unknown>;
type AssetMeta = { id: string; filename: string; original_name?: string; mime_type: string; size_bytes?: number };
type LocalAssets = {
  listAssets: (projectId: string) => Promise<AssetMeta[]>;
  getAssetBytes?: (projectId: string, assetId: string) => Promise<Uint8Array>;
  importAsset?: (projectId: string, asset: { id: string; filename: string; mime_type: string; bytes: Uint8Array }) => Promise<void>;
};

const unsupported = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.status === 405);

/** The fields of a project that sync, flattened so each merges on its own. */
export function projectDetails(project: Pick<ProjectInfo, 'name' | 'color' | 'properties'>): Details {
  const details: Details = { name: project.name, color: project.color ?? '' };
  for (const [key, value] of Object.entries(project.properties ?? {})) {
    if (!DEVICE_ONLY.has(key)) details[`p.${key}`] = value;
  }
  return details;
}

function unflatten(details: Details) {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) if (key.startsWith('p.')) properties[key.slice(2)] = value;
  return { name: String(details.name ?? ''), color: String(details.color ?? ''), properties: properties as Partial<ProjectProperties> };
}

const blank = (value: unknown) => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0);

/** Three-way merge of flat records; where both sides changed a field, this device wins.
 * With no base (the first pass), a field set on only one side is taken from it. */
export function mergeDetails(base: Details | null, device: Details, cloud: Details): Details {
  if (!base) {
    const out: Details = { ...cloud };
    for (const [key, value] of Object.entries(device)) if (!blank(value) || !(key in cloud)) out[key] = value;
    return out;
  }
  const result = mergeScripts(
    { type: 'doc', content: [], ...prefixed(base) },
    { type: 'doc', content: [], ...prefixed(device) },
    { type: 'doc', content: [], ...prefixed(cloud) },
  );
  const merged = applyMerge(result, {}); // unchosen conflicts keep this device's side
  const out: Details = {};
  for (const [key, value] of Object.entries(merged)) if (key.startsWith('_d.')) out[key.slice(3)] = value;
  return out;
}

const prefixed = (details: Details) => Object.fromEntries(Object.entries(details).map(([k, v]) => [`_d.${k}`, v]));

/** Three-way merge of two location lists by id; where both changed one, this device wins. */
export function mergeLocationLists(base: LocationEntry[] | null, device: LocationEntry[], cloud: LocationEntry[]): LocationEntry[] {
  const result = mergeScripts(
    base ? { type: 'doc', content: [], _locations: base } : null,
    { type: 'doc', content: [], _locations: device },
    { type: 'doc', content: [], _locations: cloud },
  );
  const merged = applyMerge(result, {})._locations;
  return Array.isArray(merged) ? merged as LocationEntry[] : [];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function syncDetails(binding: DeviceBinding, scope: CloudRequestScope, remoteId: string,
  project: ProjectInfo, baseRaw: string | null): Promise<void> {
  const cloud = await cloudApi.getProject(remoteId, scope);
  const device = projectDetails(project);
  const remote = projectDetails(cloud);
  const merged = mergeDetails(parse<Details | null>(baseRaw, null), device, remote);
  const next = unflatten(merged);
  if (!same(merged, remote)) await cloudApi.updateProject(remoteId, next, scope);
  if (!same(merged, device)) {
    // Keep this device's own properties (a linked folder) alongside the synced ones.
    const own = Object.fromEntries(Object.entries(project.properties ?? {}).filter(([key]) => DEVICE_ONLY.has(key)));
    await api.updateProject(project.id, { ...next, properties: { ...next.properties, ...own } });
  }
  await rememberProjectSyncBases(binding, { details_base: JSON.stringify(merged) });
}

async function syncLocations(binding: DeviceBinding, scope: CloudRequestScope, remoteId: string,
  baseRaw: string | null): Promise<void> {
  const raw = await readDeviceLocationsRaw(binding.project_id);
  const device = sanitizeLocations(parse<unknown>(raw, []));
  let cloud: { locations: LocationEntry[]; revision: string };
  try {
    cloud = await cloudApi.readLocationList(remoteId, scope);
  } catch (error) {
    if (unsupported(error)) return;
    throw error;
  }
  const remote = sanitizeLocations({ locations: cloud.locations });
  const merged = mergeLocationLists(baseRaw ? sanitizeLocations(parse<unknown>(baseRaw, [])) : null, device, remote);
  let revision = cloud.revision;
  if (!same(merged, remote)) {
    // A 412 means another device wrote meanwhile: the next pass merges again.
    revision = (await cloudApi.replaceLocationList(remoteId, merged, cloud.revision, scope)).revision;
  }
  if (!same(merged, device) && !await writeDeviceLocations(binding.project_id, raw, merged)) {
    return; // edited here during the pass: try again next time, base unchanged
  }
  await rememberProjectSyncBases(binding, { locations_base: JSON.stringify(merged), locations_revision: revision });
}

async function syncAssets(binding: DeviceBinding, scope: CloudRequestScope, remoteId: string,
  syncedRaw: string | null): Promise<void> {
  const local = api as unknown as LocalAssets;
  if (typeof local.getAssetBytes !== 'function' || typeof local.importAsset !== 'function') return;
  const [mine, theirs] = await Promise.all([
    local.listAssets(binding.project_id),
    cloudApi.listAssets(remoteId, scope).catch(error => { if (unsupported(error)) return null; throw error; }),
  ]);
  if (!theirs) return;
  const known = new Set(parse<string[]>(syncedRaw, []));
  const here = new Map(mine.map(asset => [asset.id, asset]));
  const there = new Map(theirs.map(asset => [asset.id, asset]));
  const synced = new Set<string>([...here.keys()].filter(id => there.has(id)));
  let routeMissing = false;
  for (const asset of mine) {
    // Known on both before and now gone from the cloud: deleted there, not re-sent.
    if (there.has(asset.id) || known.has(asset.id) || routeMissing || !scope.isCurrent()) continue;
    if ((asset.size_bytes ?? 0) > MAX_ASSET_BYTES) continue;
    try {
      const bytes = await local.getAssetBytes(binding.project_id, asset.id);
      await cloudApi.putDeviceAsset(remoteId, asset.id, bytes, asset.original_name || asset.filename, asset.mime_type, scope);
      synced.add(asset.id);
    } catch (error) {
      if (unsupported(error)) routeMissing = true;
      else console.warn('[cloud] could not upload asset', asset.id, error);
    }
  }
  for (const asset of theirs) {
    if (here.has(asset.id) || known.has(asset.id) || !scope.isCurrent()) continue;
    try {
      const bytes = await cloudApi.downloadAsset(remoteId, asset.id, scope);
      await local.importAsset(binding.project_id, {
        id: asset.id, filename: asset.filename, mime_type: asset.mime_type, bytes,
      });
      synced.add(asset.id);
    } catch (error) {
      console.warn('[cloud] could not download asset', asset.id, error);
    }
  }
  // Remember what is on both sides, plus what was known before and is now on one
  // side only (a deletion), so neither is sent back.
  for (const id of known) if (here.has(id) || there.has(id)) synced.add(id);
  await rememberProjectSyncBases(binding, { assets_synced: JSON.stringify([...synced]) });
}

/** One pass over the project's details, locations and assets. Each part fails
 * on its own: a problem with one picture does not hold up the locations. */
export async function syncProjectExtras(binding: DeviceBinding, scope: CloudRequestScope, remoteId: string,
  project: ProjectInfo): Promise<'synced' | 'pending'> {
  const bases = await readProjectSyncBases(binding.project_id);
  let ok = true;
  const part = async (name: string, task: () => Promise<void>) => {
    if (!scope.isCurrent()) { ok = false; return; }
    try {
      await task();
    } catch (error) {
      ok = false;
      console.warn(`[cloud] could not sync the project's ${name}:`, error);
    }
  };
  await part('details', () => syncDetails(binding, scope, remoteId, project, bases?.details_base ?? null));
  await part('locations', () => syncLocations(binding, scope, remoteId, bases?.locations_base ?? null));
  await part('assets', () => syncAssets(binding, scope, remoteId, bases?.assets_synced ?? null));
  return ok ? 'synced' : 'pending';
}
