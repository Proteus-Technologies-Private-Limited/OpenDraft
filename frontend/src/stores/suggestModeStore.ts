/**
 * Whether the editor is suggesting rather than editing (editor/suggestions),
 * and as whom.
 *
 * An editor turns it on and off for themselves (Tools ▸ Suggest Changes). A
 * collaborator invited to suggest has it on and cannot turn it off — the collab
 * server holds them to it as well (collab-server/src/services/suggestionGuard).
 */
import { create } from 'zustand';
import { currentNoteAuthor } from './editorStore';
import type { Suggester } from '../editor/suggestions';

interface SuggestModeState {
  /** Edits become suggestions. */
  suggesting: boolean;
  /** Set by a Suggest invite: the writer cannot leave suggest mode. */
  locked: boolean;
  /** The Suggestions panel. */
  panelOpen: boolean;
  /** This window's stable id in the collaboration session it is in (utils/suggesterId). */
  uid: string | null;
  setSuggesting: (on: boolean) => void;
  /** Join or leave a session as a suggester. */
  setLocked: (locked: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setUid: (uid: string | null) => void;
}

export const useSuggestModeStore = create<SuggestModeState>((set) => ({
  suggesting: false,
  locked: false,
  panelOpen: false,
  uid: null,
  setSuggesting: (on) => set((s) => ({ suggesting: s.locked ? true : on })),
  setLocked: (locked) => set({ locked, suggesting: locked }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setUid: (uid) => set({ uid }),
}));

/**
 * Who suggestions made here are signed by: the name notes are signed with —
 * the collaboration session name, else the account's, else a plain "You" —
 * and, in a session, this window's id there. The collab server checks a
 * suggester signs with their own.
 */
export function suggestionAuthor(): Suggester {
  return { by: currentNoteAuthor() || 'You', uid: useSuggestModeStore.getState().uid };
}
