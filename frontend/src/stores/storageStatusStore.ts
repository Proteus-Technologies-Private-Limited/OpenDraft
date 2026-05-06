/**
 * Tracks runtime storage status so the UI can surface the fact that
 * SQLite was unavailable and the app is now running on the file fallback.
 */

import { create } from 'zustand';

export type StorageMode = 'sqlite' | 'file-fallback' | 'localstorage-fallback' | 'http';

interface StorageStatusState {
  mode: StorageMode;
  /** Failure reason captured from the SQLite init exception. */
  errorReason: string | null;
  /** Whether the user has acknowledged the modal this session. */
  acknowledged: boolean;
  setMode: (mode: StorageMode, errorReason?: string | null) => void;
  acknowledge: () => void;
}

export const useStorageStatusStore = create<StorageStatusState>((set) => ({
  mode: 'sqlite',
  errorReason: null,
  acknowledged: false,
  setMode: (mode, errorReason = null) => set({ mode, errorReason, acknowledged: false }),
  acknowledge: () => set({ acknowledged: true }),
}));
