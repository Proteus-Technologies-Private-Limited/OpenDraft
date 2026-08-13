import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  writeRecoverySnapshot,
  readRecoverySnapshot,
  readRecoverableSnapshot,
  clearRecoverySnapshot,
  snapshotMatchesDocument,
  type RecoverySnapshot,
} from './recoveryService';

const STORAGE_KEY = 'opendraft:recovery';

const CONTENT = {
  type: 'doc',
  content: [{ type: 'action', content: [{ type: 'text', text: 'FADE IN:' }] }],
  _notes: [{ id: 'n1', text: 'a note' }],
};

describe('recoveryService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a snapshot', () => {
    expect(
      writeRecoverySnapshot({
        content: CONTENT,
        title: 'My Script',
        projectId: 'p1',
        scriptId: 's1',
      }),
    ).toBe(true);

    const read = readRecoverySnapshot();
    expect(read).not.toBeNull();
    expect(read!.title).toBe('My Script');
    expect(read!.projectId).toBe('p1');
    expect(read!.scriptId).toBe('s1');
    expect(read!.content).toEqual(CONTENT);
    expect(typeof read!.savedAt).toBe('number');
  });

  it('returns null when nothing was ever stored', () => {
    expect(readRecoverySnapshot()).toBeNull();
  });

  it('clears the snapshot', () => {
    writeRecoverySnapshot({ content: CONTENT, title: 'x', projectId: null, scriptId: null });
    clearRecoverySnapshot();
    expect(readRecoverySnapshot()).toBeNull();
  });

  // A snapshot that fails to parse must not resurface on every launch.
  it('discards an unreadable snapshot instead of failing repeatedly', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json');
    expect(readRecoverySnapshot()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards a snapshot written by an incompatible version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 99, savedAt: Date.now(), content: CONTENT }),
    );
    expect(readRecoverySnapshot()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards a snapshot with no usable content', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: Date.now(), content: null }),
    );
    expect(readRecoverySnapshot()).toBeNull();
  });

  // Overshooting the quota can take the existing entry down with it, turning
  // "too big to protect" into "lost what we had".
  it('refuses an oversized document and keeps the previous snapshot', () => {
    writeRecoverySnapshot({
      content: CONTENT,
      title: 'Small',
      projectId: null,
      scriptId: null,
    });

    const huge = { type: 'doc', big: 'x'.repeat(4_000_000) };
    expect(
      writeRecoverySnapshot({ content: huge, title: 'Huge', projectId: null, scriptId: null }),
    ).toBe(false);

    expect(readRecoverySnapshot()!.title).toBe('Small');
  });

  it('reports failure rather than throwing when storage rejects the write', () => {
    // Spied on the instance, not Storage.prototype: the suite runs in vitest's
    // node environment, where localStorage is an in-memory shim rather than a
    // real Storage (see src/test/setup.ts).
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(
      writeRecoverySnapshot({ content: CONTENT, title: 't', projectId: null, scriptId: null }),
    ).toBe(false);
    setItem.mockRestore();
  });

  describe('snapshotMatchesDocument', () => {
    const snap = (projectId: string | null, scriptId: string | null): RecoverySnapshot => ({
      version: 1,
      savedAt: 0,
      title: 't',
      projectId,
      scriptId,
      content: CONTENT,
    });

    it('matches a stored script by project and script id', () => {
      expect(snapshotMatchesDocument(snap('p1', 's1'), 'p1', 's1')).toBe(true);
    });

    // The unsaved "Untitled Screenplay" is the document with no other
    // protection, so both-null has to count as a match.
    it('matches an unsaved document against an unsaved editor', () => {
      expect(snapshotMatchesDocument(snap(null, null), null, null)).toBe(true);
    });

    it('does not match a different script', () => {
      expect(snapshotMatchesDocument(snap('p1', 's1'), 'p1', 's2')).toBe(false);
      expect(snapshotMatchesDocument(snap('p1', 's1'), null, null)).toBe(false);
      expect(snapshotMatchesDocument(snap(null, null), 'p1', 's1')).toBe(false);
    });
  });

  // The prompt asks "is there work from last time", not "is there a snapshot".
  // Checking the latter made it fire on every remount of the editor — opening
  // the Beat Board and coming back offered the writer their own document.
  describe('readRecoverableSnapshot', () => {
    it('does not offer back work from the current session', () => {
      writeRecoverySnapshot({ content: CONTENT, title: 'In progress', projectId: null, scriptId: null });

      expect(readRecoverySnapshot()).not.toBeNull();
      expect(readRecoverableSnapshot()).toBeNull();
    });

    it('offers back work an earlier session left behind', async () => {
      // A fresh module instance is a fresh session id, which is exactly what a
      // relaunch produces.
      vi.resetModules();
      const lastRun = await import('./recoveryService');
      lastRun.writeRecoverySnapshot({
        content: CONTENT,
        title: 'Before the crash',
        projectId: null,
        scriptId: null,
      });

      vi.resetModules();
      const thisRun = await import('./recoveryService');
      expect(thisRun.readRecoverableSnapshot()?.title).toBe('Before the crash');
    });

    it('offers back a snapshot written before sessions were tracked', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          savedAt: Date.now(),
          title: 'From an older build',
          projectId: null,
          scriptId: null,
          content: CONTENT,
        }),
      );

      expect(readRecoverableSnapshot()?.title).toBe('From an older build');
    });
  });

  // The editor asks this before its first paint, to decide whether the welcome
  // dialog should wait. Getting it wrong meant a writer picked "Sample Script"
  // and was told about unsaved work immediately afterwards.
  describe('hasRecoverableSnapshot', () => {
    it('is false when nothing was stored', async () => {
      vi.resetModules();
      const svc = await import('./recoveryService');
      expect(svc.hasRecoverableSnapshot()).toBe(false);
    });

    it('is false for work belonging to this session', async () => {
      vi.resetModules();
      const svc = await import('./recoveryService');
      svc.writeRecoverySnapshot({ content: CONTENT, title: 'x', projectId: null, scriptId: null });
      expect(svc.hasRecoverableSnapshot()).toBe(false);
    });

    it('is true for work an earlier session left behind', async () => {
      vi.resetModules();
      const lastRun = await import('./recoveryService');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'x', projectId: null, scriptId: null });

      vi.resetModules();
      const thisRun = await import('./recoveryService');
      expect(thisRun.hasRecoverableSnapshot()).toBe(true);
    });

    // Once offered, it must not hold the welcome dialog back a second time —
    // the editor is rebuilt on every visit to another screen.
    it('is false once the prompt has already been shown', async () => {
      vi.resetModules();
      const lastRun = await import('./recoveryService');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'x', projectId: null, scriptId: null });

      vi.resetModules();
      const thisRun = await import('./recoveryService');
      thisRun.markRecoveryPromptSeen();
      expect(thisRun.hasRecoverableSnapshot()).toBe(false);
    });
  });

  // iPadOS restores every scene the app had open and decides for itself which
  // one to show. The window in front after a crash is therefore not necessarily
  // the one that wrote the snapshot — and offering only the local slot left the
  // writer looking at an empty editor with their pages in a hidden window.
  describe('offering another window snapshot after a relaunch', () => {
    const withLabel = async (label: string) => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label } },
      };
      vi.resetModules();
      return import('./recoveryService');
    };

    afterEach(() => {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it('offers the main window work to whichever window comes back first', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({
        content: CONTENT,
        title: 'Left behind by main',
        projectId: null,
        scriptId: null,
      });

      // A different window, in a new session, with nothing in its own slot.
      const thisRun = await withLabel('main-1');
      expect(thisRun.readRecoverableSnapshot()?.title).toBe('Left behind by main');
    });

    it('prefers this window own work over a sibling slot', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'Main', projectId: null, scriptId: null });
      const lastRunSecond = await withLabel('main-1');
      lastRunSecond.writeRecoverySnapshot({ content: CONTENT, title: 'Second', projectId: null, scriptId: null });

      const thisRun = await withLabel('main-1');
      expect(thisRun.readRecoverableSnapshot()?.title).toBe('Second');
    });

    it('does not offer the same snapshot to two windows of one run', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'Only once', projectId: null, scriptId: null });

      // Both windows share a module instance here, which is what a single run
      // of the app has: one session id, two windows asking in turn.
      const thisRun = await withLabel('main-1');
      expect(thisRun.readRecoverableSnapshot()?.title).toBe('Only once');
      expect(thisRun.readRecoverableSnapshot()).not.toBeNull(); // same window may re-read

      const sibling = await import('./recoveryService');
      expect(sibling.readRecoverableSnapshot()?.title).toBe('Only once');
    });

    it('clears the slot it offered, not just its own', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'Left behind', projectId: null, scriptId: null });

      const thisRun = await withLabel('main-1');
      expect(thisRun.readRecoverableSnapshot()).not.toBeNull();
      thisRun.clearRecoverySnapshot();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(thisRun.readRecoverableSnapshot()).toBeNull();
    });
  });

  // Every window of the app shares one localStorage. With a single slot, two
  // windows overwrote each other's unsaved work on every tick and a save in one
  // threw away the other's protection — which stopped being a desktop-only
  // corner case when iPad gained real windows (issue #63).
  describe('per-window slots', () => {
    const withLabel = async (label: string) => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label } },
      };
      // The key is resolved once per module instance, so each window needs one.
      vi.resetModules();
      return import('./recoveryService');
    };

    const write = (
      svc: typeof import('./recoveryService'),
      title: string,
    ) => svc.writeRecoverySnapshot({ content: CONTENT, title, projectId: null, scriptId: null });

    afterEach(() => {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it('keeps the main window on the unsuffixed slot', async () => {
      const svc = await withLabel('main');
      expect(write(svc, 'Main window')).toBe(true);

      // Unchanged from before windows existed, so a snapshot written by an
      // older version is still offered back after an update.
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it('gives a second window its own slot', async () => {
      const svc = await withLabel('main-1');
      expect(write(svc, 'Second window')).toBe(true);

      expect(localStorage.getItem(`${STORAGE_KEY}:main-1`)).not.toBeNull();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not clear another window snapshot when this one saves', async () => {
      const main = await withLabel('main');
      write(main, 'Main window');

      const second = await withLabel('main-1');
      write(second, 'Second window');
      // What an explicit save in the second window does.
      second.clearRecoverySnapshot();

      expect(second.readRecoverySnapshot()).toBeNull();
      const survivor = await withLabel('main');
      expect(survivor.readRecoverySnapshot()?.title).toBe('Main window');
    });

    it('falls back to the shared slot outside Tauri', async () => {
      vi.resetModules();
      const svc = await import('./recoveryService');
      expect(write(svc, 'Browser tab')).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });
  });
});
