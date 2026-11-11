import { getFoldState, isFoldableDevice } from './foldPosture';
export type PostureKey = 'folded' | 'open';
/** Book posture reflows the page without replacing the writer's layout choice. */
export function currentZoomLayout(layout: 'page' | 'phone'): 'page' | 'phone' {
  return layout === 'phone' || (isFoldableDevice() && getFoldState().fold === 'book') ? 'phone' : 'page';
}
export interface PostureChoices {
  toolbarMode?: 'compact' | 'comfortable' | 'hidden';
  viewLayout?: 'page' | 'phone';
}
export interface PosturePreferences extends PostureChoices {
  byPosture?: Partial<Record<PostureKey, PostureChoices>>;
}
export function currentPostureKey(): PostureKey | null {
  return isFoldableDevice() ? (getFoldState().size === 'phone' ? 'folded' : 'open') : null;
}
export function migratePosturePreferences(saved: PosturePreferences): PosturePreferences['byPosture'] {
  if (saved.byPosture) return saved.byPosture;
  // A pre-existing explicit choice outranks either posture's defaults.
  const choices = { toolbarMode: saved.toolbarMode, viewLayout: saved.viewLayout };
  return { folded: { ...choices }, open: { ...choices } };
}
export function postureChoices(saved: PosturePreferences, key: PostureKey): Required<PostureChoices> {
  const choice = migratePosturePreferences(saved)?.[key];
  return {
    toolbarMode: choice?.toolbarMode ?? (key === 'folded' ? 'hidden' : 'compact'),
    viewLayout: choice?.viewLayout ?? (key === 'folded' ? 'phone' : 'page'),
  };
}
export function savePostureChoice(saved: PosturePreferences, key: PostureKey, patch: PostureChoices): PosturePreferences['byPosture'] {
  const byPosture = migratePosturePreferences(saved);
  return { ...byPosture, [key]: { ...byPosture?.[key], ...patch } };
}
