import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  writeRecoverySnapshot,
  readRecoverySnapshot,
  readRecoverableSnapshot,
  clearRecoverySnapshot,
  recoverySlotKey,
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
    localStorage.setItem(recoverySlotKey(), '{ not json');
    expect(readRecoverySnapshot()).toBeNull();
    expect(localStorage.getItem(recoverySlotKey())).toBeNull();
  });

  it('discards a snapshot written by an incompatible version', () => {
    localStorage.setItem(
      recoverySlotKey(),
      JSON.stringify({ version: 99, savedAt: Date.now(), content: CONTENT }),
    );
    expect(readRecoverySnapshot()).toBeNull();
    expect(localStorage.getItem(recoverySlotKey())).toBeNull();
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

    // The claim one window puts on another's snapshot stops them both offering
    // it in the same breath. It used to be permanent, so a window killed while
    // its prompt was still on screen left the mark behind and that work was
    // skipped on every launch from then on (issue #68, re-opened).
    it('re-offers a sibling snapshot whose claim went stale', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'Stranded', projectId: null, scriptId: null });

      const interrupted = await withLabel('main-1');
      expect(interrupted.readRecoverableSnapshot()?.title).toBe('Stranded');
      // ...and that window dies before the writer answers.

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as RecoverySnapshot;
      expect(stored.offeredBy).toBeTruthy();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...stored, offeredAt: Date.now() - 10 * 60_000 }),
      );

      const nextLaunch = await withLabel('main-1');
      expect(nextLaunch.readRecoverableSnapshot()?.title).toBe('Stranded');
    });

    it('still honours a claim made moments ago', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'Only once', projectId: null, scriptId: null });

      const first = await withLabel('main-1');
      expect(first.readRecoverableSnapshot()?.title).toBe('Only once');

      // A second window of a *different* run, launching alongside the first.
      const concurrent = await withLabel('main-2');
      expect(concurrent.readRecoverableSnapshot()).toBeNull();
    });

    // Snapshots written before claims were timestamped must not stay hidden.
    it('re-offers a snapshot claimed by a version that did not stamp a time', async () => {
      const lastRun = await withLabel('main');
      lastRun.writeRecoverySnapshot({ content: CONTENT, title: 'Legacy', projectId: null, scriptId: null });
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as RecoverySnapshot;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...stored, offeredBy: 'a-run-that-is-long-gone' }),
      );

      const thisRun = await withLabel('main-1');
      expect(thisRun.readRecoverableSnapshot()?.title).toBe('Legacy');
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

  });

  /**
   * A browser has no window label, so every tab was sharing the one unsuffixed
   * slot: opening the app in a second tab destroyed the unsaved work the first
   * tab was protecting, within ten seconds and with nothing said.
   */
  describe('per-tab slots in the browser', () => {
    const write = (
      svc: typeof import('./recoveryService'),
      title: string,
    ) => svc.writeRecoverySnapshot({ content: CONTENT, title, projectId: null, scriptId: null });

    /** Let a ping and its answers cross between the simulated tabs. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

    /** Every tab this test opened, so none is left answering the next one. */
    const open: (typeof import('./recoveryService'))[] = [];

    afterEach(() => {
      for (const tab of open.splice(0)) tab.closeRecoveryPresence();
    });

    /** A fresh run of the app in a tab of its own: new session, new sessionStorage. */
    const newTab = async () => {
      sessionStorage.clear();
      vi.resetModules();
      const tab = await import('./recoveryService');
      open.push(tab);
      return tab;
    };

    /** The same tab again — sessionStorage survives a reload, a session id does not. */
    const reloadTab = async () => {
      vi.resetModules();
      const tab = await import('./recoveryService');
      open.push(tab);
      return tab;
    };

    it('gives a tab a slot of its own rather than the shared one', async () => {
      const tab = await newTab();
      expect(write(tab, 'First tab')).toBe(true);
      expect(tab.recoverySlotKey()).toMatch(/^opendraft:recovery:tab-/);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('comes back to the same slot after a reload', async () => {
      const tab = await newTab();
      write(tab, 'Before the reload');
      const slot = tab.recoverySlotKey();

      const reloaded = await reloadTab();
      expect(reloaded.recoverySlotKey()).toBe(slot);
      // ...and the work from before the reload is what it offers back.
      expect(reloaded.readRecoverableSnapshot()?.title).toBe('Before the reload');
    });

    it('does not overwrite what another tab is protecting', async () => {
      const first = await newTab();
      write(first, 'Unsaved work in the first tab');
      const firstSlot = first.recoverySlotKey();

      const second = await newTab();
      write(second, 'A script imported in the second tab');

      expect(second.recoverySlotKey()).not.toBe(firstSlot);
      const survivor = JSON.parse(localStorage.getItem(firstSlot) || 'null');
      expect(survivor?.title).toBe('Unsaved work in the first tab');
    });

    it('steps over a slot a duplicated tab brought with it', async () => {
      // Duplicating a tab copies its sessionStorage, so the copy would
      // otherwise write straight into the original's slot. What gives it away
      // is the original still snapshotting after the copy opened, so the clock
      // has to move for the test to mean anything.
      vi.useFakeTimers();
      try {
        const start = new Date('2026-01-01T00:00:00Z').getTime();
        vi.setSystemTime(start);
        const first = await newTab();
        write(first, 'Unsaved work in the first tab');
        const firstSlot = first.recoverySlotKey();

        vi.setSystemTime(start + 5_000);
        vi.resetModules(); // a new run, but the same sessionStorage
        const duplicate = await import('./recoveryService');
        open.push(duplicate);

        vi.setSystemTime(start + 15_000);
        write(first, 'Unsaved work in the first tab');
        write(duplicate, 'The duplicate');

        expect(duplicate.recoverySlotKey()).not.toBe(firstSlot);
        expect(JSON.parse(localStorage.getItem(firstSlot) || 'null')?.title)
          .toBe('Unsaved work in the first tab');
        expect(JSON.parse(localStorage.getItem(duplicate.recoverySlotKey()) || 'null')?.title)
          .toBe('The duplicate');
      } finally {
        vi.useRealTimers();
      }
    });

    it('still offers back work left by a tab that is gone', async () => {
      const first = await newTab();
      write(first, 'Left behind by a closed tab');
      first.closeRecoveryPresence(); // the tab is closed: it answers nothing

      const second = await newTab();
      await settle();
      write(second, 'This tab');
      expect(second.readRecoverableSnapshot()?.title).toBe('Left behind by a closed tab');
    });

    /**
     * Opening a second tab used to greet the writer with their own live
     * document, described as unsaved work from their last session and "edited
     * just now". The tabs are asked who is using what, and a tab that is open
     * answers for its own slot.
     */
    it('does not offer back work another open tab is looking after', async () => {
      const first = await newTab();
      write(first, 'Being edited in the first tab right now');

      const second = await newTab();
      await settle(); // the ping and the answer
      expect(second.readRecoverableSnapshot()).toBeNull();
      expect(second.hasRecoverableSnapshot()).toBe(false);
    });

    it('offers that same work back once the tab holding it has gone', async () => {
      const first = await newTab();
      write(first, 'Unsaved when the tab went away');

      const second = await newTab();
      await settle();
      expect(second.readRecoverableSnapshot()).toBeNull();

      first.closeRecoveryPresence();
      const third = await newTab();
      await settle();
      expect(third.readRecoverableSnapshot()?.title).toBe('Unsaved when the tab went away');
    });

    it('falls back to how fresh the work is when tabs cannot be asked', async () => {
      // Engines without BroadcastChannel have nothing to ask, so a snapshot
      // written moments ago is taken for a live tab's rather than offered.
      const real = globalThis.BroadcastChannel;
      try {
        const first = await newTab();
        write(first, 'Fresh work from somewhere');
        first.closeRecoveryPresence();

        // @ts-expect-error — modelling an engine that does not have it.
        delete globalThis.BroadcastChannel;
        const second = await newTab();
        await settle();
        expect(second.readRecoverableSnapshot()).toBeNull();
      } finally {
        globalThis.BroadcastChannel = real;
      }
    });

    it('falls back to the shared slot when sessionStorage is unavailable', async () => {
      // Safari in private browsing, and anything else that refuses storage.
      const spy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      try {
        vi.resetModules();
        const svc = await import('./recoveryService');
        expect(svc.recoverySlotKey()).toBe(STORAGE_KEY);
      } finally {
        spy.mockRestore();
      }
    });

    it('frees the oldest stranded snapshot rather than leave the open document unprotected', async () => {
      const stale = await newTab();
      write(stale, 'Old and never answered for');
      const staleSlot = stale.recoverySlotKey();
      // Age it, so it is unmistakably the oldest.
      const aged = JSON.parse(localStorage.getItem(staleSlot)!);
      aged.savedAt = Date.now() - 7 * 24 * 60 * 60 * 1000;
      localStorage.setItem(staleSlot, JSON.stringify(aged));

      const live = await newTab();
      const liveSlot = live.recoverySlotKey();
      // The next write hits a full disk, once.
      let full = true;
      const setItem = localStorage.setItem.bind(localStorage);
      const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
        if (full && key === liveSlot) { full = false; throw new Error('QuotaExceededError'); }
        setItem(key, value);
      });
      try {
        expect(write(live, 'The document being typed')).toBe(true);
      } finally {
        spy.mockRestore();
      }
      expect(localStorage.getItem(staleSlot)).toBeNull();
      expect(JSON.parse(localStorage.getItem(liveSlot) || 'null')?.title)
        .toBe('The document being typed');
    });
  });
});
