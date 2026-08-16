/**
 * Reopening the script the writer had open — issue #68, re-opened.
 *
 * After a crash OpenDraft launched into a blank Untitled Screenplay, so a
 * writer who lost a few unsaved lines was shown an empty page and had no way to
 * tell that the rest of their script was safe in the library.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rememberLastSession, readLastSession, clearLastSession } from './lastSession';

const KEY = 'opendraft:last-session';

describe('lastSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('round-trips the open script', () => {
    rememberLastSession('p1', 's1');
    expect(readLastSession()).toMatchObject({ projectId: 'p1', scriptId: 's1' });
  });

  it('has nothing to say before anything was opened', () => {
    expect(readLastSession()).toBeNull();
  });

  // An unsaved document and a file opened from disk both have no library
  // identity — there is nothing to reopen, and the recovery snapshot is what
  // covers them.
  it('records nothing for a document with no library identity', () => {
    rememberLastSession(null, null);
    expect(readLastSession()).toBeNull();
    rememberLastSession('p1', null);
    expect(readLastSession()).toBeNull();
  });

  it('forgets the previous script when one is closed', () => {
    rememberLastSession('p1', 's1');
    rememberLastSession(null, null);
    expect(readLastSession()).toBeNull();
  });

  it('is cleared on request', () => {
    rememberLastSession('p1', 's1');
    clearLastSession();
    expect(readLastSession()).toBeNull();
  });

  it('ignores a record old enough to be someone else problem', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ projectId: 'p1', scriptId: 's1', at: Date.now() - 40 * 24 * 60 * 60 * 1000 }),
    );
    expect(readLastSession()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('discards an unreadable record rather than failing every launch', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readLastSession()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('discards a record missing its ids', () => {
    localStorage.setItem(KEY, JSON.stringify({ projectId: 'p1', at: Date.now() }));
    expect(readLastSession()).toBeNull();
  });

  // Same reasoning as the recovery slots: two windows share one localStorage,
  // and a window coming back should find what it had open, not its sibling's.
  it('keeps a separate record per window', async () => {
    const withLabel = async (label: string) => {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label } },
      };
      vi.resetModules();
      return import('./lastSession');
    };

    const main = await withLabel('main');
    main.rememberLastSession('p1', 'main-script');
    const second = await withLabel('main-1');
    second.rememberLastSession('p1', 'second-script');

    expect((await withLabel('main')).readLastSession()?.scriptId).toBe('main-script');
    expect((await withLabel('main-1')).readLastSession()?.scriptId).toBe('second-script');
  });
});
