/**
 * Surfaces save failures as a blocking modal that the user must acknowledge.
 *
 * Used by all save paths in the editor (auto-save, metadata debounced save,
 * manual Cmd+S, save-on-close).  Errors that already trigger their own
 * dialog — auth (401), quota (402), unverified email (403) — set a `handled`
 * flag on the error and the call sites skip this store for them.
 */

import { create } from 'zustand';

export interface SaveErrorInfo {
  /** Human-readable error message (already extracted from the Error). */
  message: string;
  /** Where the failure originated: auto-save, manual save, etc. */
  source: 'auto-save' | 'metadata-save' | 'manual-save' | 'save-on-close';
  /** Captured time so the dialog can show "just now" / timestamp. */
  at: number;
}

interface SaveErrorState {
  error: SaveErrorInfo | null;
  setError: (info: Omit<SaveErrorInfo, 'at'>) => void;
  clearError: () => void;
}

export const useSaveErrorStore = create<SaveErrorState>((set) => ({
  error: null,
  setError: (info) => set({ error: { ...info, at: Date.now() } }),
  clearError: () => set({ error: null }),
}));

/**
 * Convenience helper: extract a clean message from an unknown error and push
 * it into the store, unless the error is already `handled` (auth, quota).
 * Returns true if the error was surfaced (i.e. not handled elsewhere).
 */
export function reportSaveError(
  err: unknown,
  source: SaveErrorInfo['source'],
): boolean {
  if (err && typeof err === 'object' && (err as any).handled === true) {
    return false;
  }
  const message = err instanceof Error ? err.message : String(err);
  useSaveErrorStore.getState().setError({ message, source });
  return true;
}
