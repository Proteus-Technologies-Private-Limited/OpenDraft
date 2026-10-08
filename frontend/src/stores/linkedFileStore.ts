/**
 * What the app knows about files linked to scripts (issue #135), for the UI.
 *
 * The links themselves live in SQLite (services/linkedFiles). This holds what
 * the status bar and project screen show — whether the last write reached the
 * file — and the one question the sync can need answered: the file and the
 * library copy both changed, so which one wins.
 */
import { create } from 'zustand';

export type LinkedFileState =
  /** The file holds what the library holds. */
  | 'synced'
  /** The library has changes the file has not received yet; a write is due. */
  | 'pending'
  /** The file is not where the link says — moved, deleted, or the drive is offline. */
  | 'missing'
  /**
   * The file was changed by something other than OpenDraft since it was last
   * written, and the library has changes too. Nothing is written until the
   * writer chooses which copy to keep.
   */
  | 'conflict';

export interface LinkedFileStatus {
  path: string;
  state: LinkedFileState;
  /** The reason the last write failed, when it did. */
  error?: string;
}

export type ConflictChoice = 'file' | 'library';

export interface FileConflict {
  scriptTitle: string;
  path: string;
  resolve: (choice: ConflictChoice) => void;
}

interface LinkedFileStoreState {
  byScript: Record<string, LinkedFileStatus>;
  setStatus: (scriptId: string, status: LinkedFileStatus | null) => void;

  /**
   * The linked file of the script open in the editor, or null — for the
   * status bar, and so the editor re-checks the file when the window regains
   * focus.
   */
  openScriptFile: { scriptId: string; path: string } | null;
  setOpenScriptFile: (v: { scriptId: string; path: string } | null) => void;

  /** The question on screen, if any. One at a time; later ones queue. */
  conflict: FileConflict | null;
  /**
   * Ask which copy to keep. Resolves when the writer answers. Questions asked
   * while one is showing wait their turn rather than replacing it, so no
   * caller is left awaiting an answer that will never come.
   */
  askConflict: (scriptTitle: string, path: string) => Promise<ConflictChoice>;
  answerConflict: (choice: ConflictChoice) => void;
}

const queue: FileConflict[] = [];

export const useLinkedFileStore = create<LinkedFileStoreState>((set, get) => ({
  byScript: {},
  setStatus: (scriptId, status) =>
    set((s) => {
      const next = { ...s.byScript };
      if (status) next[scriptId] = status;
      else delete next[scriptId];
      return { byScript: next };
    }),

  openScriptFile: null,
  setOpenScriptFile: (v) => set({ openScriptFile: v }),

  conflict: null,
  askConflict: (scriptTitle, path) =>
    new Promise<ConflictChoice>((resolve) => {
      const entry: FileConflict = { scriptTitle, path, resolve };
      if (get().conflict) queue.push(entry);
      else set({ conflict: entry });
    }),
  answerConflict: (choice) => {
    const current = get().conflict;
    if (!current) return;
    set({ conflict: queue.shift() ?? null });
    current.resolve(choice);
  },
}));

/**
 * Whether auto-save applies to the document open in the editor.
 *
 * A file opened from disk follows the "files" setting: the writer opened
 * someone else's format to edit it, and an unasked rewrite can lose what that
 * format cannot hold. A library script follows the library setting — including
 * one saved to a file or a project folder, which the writer chose deliberately,
 * in the format they chose, and whose file is never overwritten when it was
 * changed elsewhere (services/linkedFiles).
 */
export function autoSaveAppliesToOpenDocument(
  settings: { autoSaveLibrary: boolean; autoSaveFiles: boolean },
  hasFileOrigin: boolean,
): boolean {
  return hasFileOrigin ? settings.autoSaveFiles : settings.autoSaveLibrary;
}
