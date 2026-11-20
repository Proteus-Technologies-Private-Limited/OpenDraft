/**
 * Which scenes in the Navigator are open to show their synopsis, remembered
 * per script.
 *
 * Kept as a default plus the scenes the writer has flipped from it, rather than
 * a list of open scenes: after *Show all* a scene written later opens too, and
 * after *Hide all* it stays shut, which is what the button promised.
 *
 * Scenes are addressed by the Navigator's ids (`scene-1`, `scene-2`, …), which
 * are their place in the script — headings carry no lasting id of their own.
 * So moving a scene moves which row is remembered as open; that is the cost of
 * not writing view state into the document.
 */

export interface SynopsisExpansion {
  /** Whether a scene not in `flipped` is open. */
  allOpen: boolean;
  /** Scenes whose state is the opposite of `allOpen`. */
  flipped: string[];
}

export const DEFAULT_EXPANSION: SynopsisExpansion = { allOpen: false, flipped: [] };

const STORAGE_KEY = 'opendraft:navigatorSynopses';
/** Scripts remembered at once; the least recently used is dropped. */
const MAX_SCRIPTS = 50;

export function isSceneOpen(state: SynopsisExpansion, sceneId: string): boolean {
  return state.flipped.includes(sceneId) ? !state.allOpen : state.allOpen;
}

export function toggleScene(state: SynopsisExpansion, sceneId: string): SynopsisExpansion {
  const flipped = state.flipped.includes(sceneId)
    ? state.flipped.filter((id) => id !== sceneId)
    : [...state.flipped, sceneId];
  return { allOpen: state.allOpen, flipped };
}

export function setAllScenes(open: boolean): SynopsisExpansion {
  return { allOpen: open, flipped: [] };
}

/** True when every one of `sceneIds` is open — the header then offers *Hide all*. */
export function allScenesOpen(state: SynopsisExpansion, sceneIds: readonly string[]): boolean {
  return sceneIds.length > 0 && sceneIds.every((id) => isSceneOpen(state, id));
}

interface Stored {
  /** Script key → expansion, in least- to most-recently-used order. */
  scripts: Record<string, SynopsisExpansion>;
}

function sanitize(value: unknown): SynopsisExpansion | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SynopsisExpansion>;
  if (typeof v.allOpen !== 'boolean' || !Array.isArray(v.flipped)) return null;
  return { allOpen: v.allOpen, flipped: v.flipped.filter((id): id is string => typeof id === 'string') };
}

function read(storage: Storage | undefined): Stored {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { scripts: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return parsed && typeof parsed.scripts === 'object' && parsed.scripts ? { scripts: parsed.scripts } : { scripts: {} };
  } catch (err) {
    console.warn('[navigator] could not read remembered synopses', err);
    return { scripts: {} };
  }
}

function defaultStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

export function loadExpansion(scriptKey: string | null, storage: Storage | undefined = defaultStorage()): SynopsisExpansion {
  if (!scriptKey) return DEFAULT_EXPANSION;
  return sanitize(read(storage).scripts[scriptKey]) ?? DEFAULT_EXPANSION;
}

export function saveExpansion(
  scriptKey: string | null,
  state: SynopsisExpansion,
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!scriptKey || !storage) return;
  try {
    const { scripts } = read(storage);
    delete scripts[scriptKey];
    scripts[scriptKey] = state;
    const keys = Object.keys(scripts);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SCRIPTS))) delete scripts[key];
    storage.setItem(STORAGE_KEY, JSON.stringify({ scripts }));
  } catch (err) {
    console.warn('[navigator] could not remember open synopses', err);
  }
}
