/**
 * Writing goals, the words-written history and the running sprint
 * (utils/writingGoals). Goals and history are kept in this device's
 * localStorage only; the session and the sprint last until the app closes.
 */
import { create } from 'zustand';
import {
  applyCount, dayKey, normalizeGoals, normalizeHistory, DEFAULT_GOALS,
  type Baseline, type DayProgress, type Sprint, type WritingGoals, type WritingHistory,
} from '../utils/writingGoals';

const STORAGE_KEY_GOALS = 'opendraft:writingGoals';
const STORAGE_KEY_HISTORY = 'opendraft:writingHistory';

function load<T>(key: string, normalize: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

interface WritingGoalsState {
  goals: WritingGoals;
  setGoals: (goals: Partial<WritingGoals>) => void;
  history: WritingHistory;
  /** Written since the app was opened. */
  session: DayProgress;
  sprint: Sprint | null;
  baseline: Baseline | null;
  /** Compare the script's current counts with the last ones and record what was written. */
  recordCount: (scriptKey: string, words: number, pages: number, now?: Date) => void;
  startSprint: (minutes: number, noBackspace: boolean, now?: number) => void;
  /** Ends the sprint and returns it, or null when none was running. */
  endSprint: () => Sprint | null;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

export const useWritingGoalsStore = create<WritingGoalsState>((set, get) => ({
  goals: load(STORAGE_KEY_GOALS, normalizeGoals, DEFAULT_GOALS),
  setGoals: (patch) => {
    const goals = normalizeGoals({ ...get().goals, ...patch });
    save(STORAGE_KEY_GOALS, goals);
    set({ goals });
  },
  history: load(STORAGE_KEY_HISTORY, normalizeHistory, {}),
  session: { words: 0, pages: 0 },
  sprint: null,
  baseline: null,

  recordCount: (scriptKey, words, pages, now = new Date()) => {
    const s = get();
    const prev = { history: s.history, session: s.session, sprint: s.sprint, baseline: s.baseline };
    const next = applyCount(prev, scriptKey, words, pages, dayKey(now));
    if (next === prev) return;
    if (next.history !== prev.history) save(STORAGE_KEY_HISTORY, next.history);
    set(next);
  },

  startSprint: (minutes, noBackspace, now = Date.now()) => {
    const durationMs = Math.max(1, Math.round(minutes)) * 60_000;
    set({ sprint: { endsAt: now + durationMs, durationMs, words: 0, noBackspace } });
  },
  endSprint: () => {
    const sprint = get().sprint;
    set({ sprint: null });
    return sprint;
  },

  dialogOpen: false,
  setDialogOpen: (open) => set({ dialogOpen: open }),
}));
