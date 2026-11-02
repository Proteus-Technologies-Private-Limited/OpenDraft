/**
 * What the Table Read panel shows (issue #131): the lines of the script, which
 * one is being read, and the word the voice is on. The player in
 * services/tts/player.ts drives it; the panel and the editor highlight read it.
 */
import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import type { ReadLine } from '../services/tts/script';
import type { EngineKind, VoiceInfo } from '../services/tts/types';

export type TableReadStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface TableReadState {
  open: boolean;
  status: TableReadStatus;
  error: string | null;
  /** The browser has no voices of its own: the writer has to configure a provider. */
  needsProvider: boolean;
  lines: ReadLine[];
  /** Index into `lines` of the line being read, or that a read would start from. */
  current: number;
  /** The word being spoken, as a [start, end) range of `lines[current].text`. */
  word: { start: number; end: number } | null;
  engineKind: EngineKind | null;
  engineLabel: string;
  voices: VoiceInfo[];
  /** Voice id reading each character, and the narrator's under ''. */
  casting: Record<string, string | null>;

  setOpen: (open: boolean) => void;
  /** Open the panel with the script on screen: the Outline would cover it. */
  openTableRead: () => void;
  setNeedsProvider: (v: boolean) => void;
  patch: (p: Partial<Omit<TableReadState, 'setOpen' | 'openTableRead' | 'setNeedsProvider' | 'patch'>>) => void;
}

export const useTableReadStore = create<TableReadState>((set) => ({
  open: false,
  status: 'idle',
  error: null,
  needsProvider: false,
  lines: [],
  current: 0,
  word: null,
  engineKind: null,
  engineLabel: '',
  voices: [],
  casting: {},

  setOpen: (open) => set({ open }),
  openTableRead: () => {
    const editors = useEditorStore.getState();
    if (editors.outlineOpen) editors.toggleOutline();
    set({ open: true });
  },
  setNeedsProvider: (v) => set({ needsProvider: v }),
  patch: (p) => set(p),
}));

/** Key under which the narrator's voice is kept in `casting`. */
export const NARRATOR_KEY = '';
