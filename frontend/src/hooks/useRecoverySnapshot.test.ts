/**
 * The recovery hook must not lose words that a slow save raced past.
 *
 * Cmd+S cleared the snapshot once the save finished. When the save took longer
 * than the snapshot debounce and the writer kept typing, the hook had already
 * stored those newer words and remembered them as written; the clear then
 * deleted that copy and the hook, seeing the same text it "had written", never
 * put it back. With auto-save off a crash then lost the words outright.
 *
 * The suite runs without a DOM, so React's two hooks are stood in for: refs are
 * plain objects and effects run at once. That is all this hook uses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('react', () => ({
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (fn: () => void | (() => void)) => { fn(); },
}));
vi.mock('../components/Toast', () => ({ showToast: () => {} }));

const { useRecoverySnapshot } = await import('./useRecoverySnapshot');
const { readRecoverySnapshot, clearRecoverySnapshot } = await import('../services/recoveryService');

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text }] }] };
}

describe('useRecoverySnapshot after a save clears the slot', () => {
  let current: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as unknown as { document?: unknown }).document = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  function mount() {
    const saved = doc('A');
    current = doc('A');
    // Effects run at once under the stand-in React above, so a plain call mounts it.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRecoverySnapshot({
      buildSaveContent: () => current,
      documentTitle: 'Script',
      projectId: 'p1',
      scriptId: 's1',
      editor: null,
      lastSavedJsonRef: { current: JSON.stringify(saved) },
      scriptSwitchingRef: { current: false },
      isCollabGuest: false,
      isHistoryMode: false,
      hasEdits: () => true,
    });
  }

  it('writes the newer words back after something else cleared them', () => {
    mount();
    // The writer types B while the save of A is still in flight.
    current = doc('B');
    vi.advanceTimersByTime(10_000);
    expect(readRecoverySnapshot()?.content).toEqual(doc('B'));

    // The save of A lands and clears the slot — B is now nowhere.
    clearRecoverySnapshot();
    expect(readRecoverySnapshot()).toBeNull();

    // The next pass must put B back even though it is the same B as before.
    vi.advanceTimersByTime(10_000);
    expect(readRecoverySnapshot()?.content).toEqual(doc('B'));
  });

  it('still skips rewriting an unchanged snapshot that is in place', () => {
    mount();
    current = doc('B');
    vi.advanceTimersByTime(10_000);
    const first = readRecoverySnapshot()?.savedAt;
    vi.advanceTimersByTime(10_000);
    expect(readRecoverySnapshot()?.savedAt).toBe(first);
  });
});
