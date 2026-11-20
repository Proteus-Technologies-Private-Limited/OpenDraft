/**
 * The Location Database for storages that live on the device.
 *
 * On the web the Locations panel talks to the Python backend. The desktop and
 * mobile apps have no backend — every `api` method they use is replaced by a
 * local one in `initStorage()` — and the location methods had no local
 * counterpart, so they fell through to HTTP and the panel could not load.
 *
 * Each storage supplies three small functions (read a project's list, write
 * it back, list the project's script documents); everything else — ids,
 * normalising names, discovery — is written once here on top of
 * utils/locationData.ts, so the SQLite database and both fallbacks behave
 * the same way.
 */
import type { LocationEntry } from './api';
import {
  applyLocationUpdate,
  buildLocation,
  discoverNewLocations,
  newLocationId,
  sanitizeLocations,
} from '../utils/locationData';

export interface LocationStore {
  /** The stored list for a project, as parsed JSON; `null` when there is none. */
  read: (projectId: string) => Promise<unknown>;
  write: (projectId: string, locations: LocationEntry[]) => Promise<void>;
  /** Every script document in the project, for discovery. */
  scriptDocs: (projectId: string) => Promise<unknown[]>;
}

export function createLocationApi(store: LocationStore) {
  // A project's list is one stored value, so every change is read–modify–write.
  // Running them one at a time keeps two quick changes (two photos added in a
  // row) from each writing back a list that lacks the other's.
  const tails = new Map<string, Promise<unknown>>();
  function inTurn<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const run = (tails.get(projectId) ?? Promise.resolve()).then(task, task);
    tails.set(projectId, run.catch(() => undefined));
    return run;
  }

  const load = async (projectId: string): Promise<LocationEntry[]> =>
    sanitizeLocations(await store.read(projectId));

  const now = () => new Date().toISOString();

  return {
    listLocations: (projectId: string): Promise<LocationEntry[]> =>
      inTurn(projectId, () => load(projectId)),

    createLocation: (
      projectId: string,
      data: Partial<LocationEntry> & { name: string },
    ): Promise<LocationEntry> =>
      inTurn(projectId, async () => {
        const locations = await load(projectId);
        const created = buildLocation(data, newLocationId(), now());
        await store.write(projectId, [...locations, created]);
        return created;
      }),

    updateLocation: (
      projectId: string,
      locId: string,
      data: Partial<LocationEntry>,
    ): Promise<LocationEntry> =>
      inTurn(projectId, async () => {
        const locations = await load(projectId);
        const index = locations.findIndex((l) => l.id === locId);
        if (index < 0) throw new Error(`Location not found: ${locId}`);
        const updated = applyLocationUpdate(locations[index], data, now());
        const next = locations.slice();
        next[index] = updated;
        await store.write(projectId, next);
        return updated;
      }),

    deleteLocation: (projectId: string, locId: string): Promise<{ message: string }> =>
      inTurn(projectId, async () => {
        const locations = await load(projectId);
        const next = locations.filter((l) => l.id !== locId);
        if (next.length === locations.length) throw new Error(`Location not found: ${locId}`);
        await store.write(projectId, next);
        // i18n-ignore status payload returned by the storage layer, never shown
        return { message: 'ok' };
      }),

    discoverLocations: (
      projectId: string,
    ): Promise<{ discovered: number; locations: LocationEntry[] }> =>
      inTurn(projectId, async () => {
        const locations = await load(projectId);
        const docs = await store.scriptDocs(projectId);
        const result = discoverNewLocations(locations, docs, newLocationId, now());
        if (result.discovered > 0) await store.write(projectId, result.locations);
        return result;
      }),
  };
}

// ── Fallback storages ────────────────────────────────────────────────────────
// Both degraded modes keep their index in localStorage, so locations sit there
// too, one key per project. The lists are small text; photos stay assets.

const browserKey = (projectId: string) => `opendraft:locations:${projectId}`;

/** A LocationStore kept in localStorage, for the two fallback storages. */
export function browserLocationStore(
  scriptDocs: (projectId: string) => Promise<unknown[]>,
): LocationStore {
  return {
    read: async (projectId) => {
      const raw = localStorage.getItem(browserKey(projectId));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`[locations] stored list for ${projectId} is unreadable:`, err);
        return null;
      }
    },
    write: async (projectId, locations) => {
      try {
        localStorage.setItem(browserKey(projectId), JSON.stringify(locations));
      } catch (err) {
        // Surface it: a swallowed quota error would look like a saved change.
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Local storage save failed: ${msg}`);
      }
    },
    scriptDocs,
  };
}

/** Drop a deleted project's locations from localStorage. */
export function forgetBrowserLocations(projectId: string): void {
  try {
    localStorage.removeItem(browserKey(projectId));
  } catch (err) {
    console.warn(`[locations] could not clear locations for ${projectId}:`, err);
  }
}
