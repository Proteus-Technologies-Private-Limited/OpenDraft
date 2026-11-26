/**
 * Plugin document data: the JSON each plugin keeps inside the open script.
 *
 * Keyed by plugin id. It is saved with the script as `_pluginData`
 * (utils/saveContent.ts), restored on every load path, carried through
 * .odraft, backups, FDX and Fountain (utils/pluginData.ts), and synced to
 * collaborators. Entries belonging to a plugin that is turned off or not
 * installed are kept exactly as they arrived, so opening a script without the
 * plugin never loses its data.
 *
 * Plugins do not use this store directly: they go through
 * `pluginRegistry.getDocumentData()` / `setDocumentData()`.
 *
 * Deliberately free of other app imports so the plugin registry can depend on
 * it without pulling in the editor store.
 */
import { create } from 'zustand';

export type PluginDocumentData = Record<string, unknown>;

interface PluginDataState {
  /** Every plugin's entry for the open script. Replaced, never mutated. */
  data: PluginDocumentData;
  /** Replace everything — loading, importing or resetting a script. */
  setAll: (data: PluginDocumentData) => void;
  /** Set one plugin's entry; `undefined` removes it. */
  setEntry: (pluginId: string, value: unknown) => void;
}

export const usePluginDataStore = create<PluginDataState>((set) => ({
  data: {},
  setAll: (data) => set({ data }),
  setEntry: (pluginId, value) => set((st) => {
    if (value === undefined) {
      if (!(pluginId in st.data)) return st;
      const next = { ...st.data };
      delete next[pluginId];
      return { data: next };
    }
    return { data: { ...st.data, [pluginId]: value } };
  }),
}));

/** The open script's plugin data. */
export function currentPluginData(): PluginDocumentData {
  return usePluginDataStore.getState().data;
}
