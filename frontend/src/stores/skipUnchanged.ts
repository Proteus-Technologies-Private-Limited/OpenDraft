import type { StateCreator } from 'zustand';

/**
 * Drops a merge `set` whose every field already holds that value.
 *
 * zustand hands subscribers a new state object for any `set`, changed or not,
 * and a component that reads a store without a selector re-renders for each
 * one. The editor sets the page count and current page after every keystroke,
 * so the whole editor screen re-rendered per key pressed (issue #229).
 */
export const skipUnchanged = <T extends object>(config: StateCreator<T>): StateCreator<T> =>
  (set, get, api) => {
    const guarded = ((partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => {
      const state = get();
      const next = typeof partial === 'function' ? partial(state) : partial;
      if (!replace && next && (next === state || Object.keys(next).every(
        (key) => Object.is((next as Record<string, unknown>)[key], (state as Record<string, unknown>)[key]),
      ))) return;
      (set as (p: T | Partial<T>, r?: boolean) => void)(next, replace);
    }) as typeof set;
    api.setState = guarded;
    return config(guarded, get, api);
  };
