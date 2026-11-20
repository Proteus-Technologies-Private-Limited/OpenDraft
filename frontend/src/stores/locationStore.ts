/**
 * The open project's location records, shared by Location Profiles and Scene
 * Details so an edit in one shows in the other at once.
 *
 * Locations belong to the project, not the script: on the web they are the
 * backend's locations.json, in the apps the device storage (services/api picks
 * which). Every write goes through the API first and lands here only once it
 * has been stored, so the list never shows something that was not saved.
 */
import { create } from 'zustand';
import { api, type LocationEntry } from '../services/api';

interface LocationState {
  /** The project the list belongs to; null before anything was loaded. */
  projectId: string | null;
  locations: LocationEntry[];
  loading: boolean;
  /** Whether the list for `projectId` has been read at least once. */
  loaded: boolean;
  /** The last load's failure, or null. */
  error: string | null;
  /** Read the project's locations. Without `force`, a list already read for the project is kept. */
  load: (projectId: string, force?: boolean) => Promise<void>;
  /** Store a change. Throws, so each caller words its own failure. */
  update: (projectId: string, id: string, patch: Partial<LocationEntry>) => Promise<LocationEntry>;
  create: (projectId: string, data: Partial<LocationEntry> & { name: string }) => Promise<LocationEntry>;
  remove: (projectId: string, id: string) => Promise<void>;
  /** Add an entry for every place the project's scripts name that has none. Returns how many were added. */
  discover: (projectId: string) => Promise<number>;
}

export const useLocationStore = create<LocationState>((set, get) => {
  /** Apply `change` only if the project has not been switched while the request was out. */
  const forProject = (projectId: string, change: (list: LocationEntry[]) => LocationEntry[]) => {
    if (get().projectId !== projectId) return;
    set((s) => ({ locations: change(s.locations) }));
  };

  return {
    projectId: null,
    locations: [],
    loading: false,
    loaded: false,
    error: null,

    load: async (projectId, force = false) => {
      const s = get();
      if (!force && s.projectId === projectId && (s.loaded || s.loading)) return;
      if (s.projectId !== projectId) set({ projectId, locations: [], loaded: false });
      set({ loading: true, error: null });
      try {
        const list = await api.listLocations(projectId);
        if (get().projectId !== projectId) return;
        set({ locations: list, loaded: true, loading: false });
      } catch (err) {
        console.warn('[locations] could not load the project’s locations', err);
        if (get().projectId !== projectId) return;
        set({ loading: false, loaded: true, error: err instanceof Error ? err.message : String(err) });
      }
    },

    update: async (projectId, id, patch) => {
      const updated = await api.updateLocation(projectId, id, patch);
      forProject(projectId, (list) => list.map((l) => (l.id === id ? updated : l)));
      return updated;
    },

    create: async (projectId, data) => {
      const created = await api.createLocation(projectId, data);
      forProject(projectId, (list) => [...list, created]);
      return created;
    },

    remove: async (projectId, id) => {
      await api.deleteLocation(projectId, id);
      forProject(projectId, (list) => list.filter((l) => l.id !== id));
    },

    discover: async (projectId) => {
      set({ loading: true });
      try {
        const result = await api.discoverLocations(projectId);
        if (get().projectId === projectId) set({ locations: result.locations, loaded: true });
        return result.discovered;
      } finally {
        set({ loading: false });
      }
    },
  };
});
