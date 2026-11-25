/**
 * Reopening the script the writer had open — issue #68, re-opened.
 *
 * After a crash OpenDraft launched into a blank Untitled Screenplay, so a
 * writer who lost a few unsaved lines was shown an empty page and had no way to
 * tell that the rest of their script was safe in the library.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rememberLastSession, readLastSession, clearLastSession, forgetLastSessionFor } from './lastSession';

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

  // A script kept on the server belongs to the account that had it open.
  // Reopening it for anyone else greeted them with "Script not found" (or a
  // 401 when nobody was signed in).
  it('reopens a server script only for the account that had it open', () => {
    rememberLastSession('p1', 's1', 'user-a');
    expect(readLastSession('user-a')).toMatchObject({ projectId: 'p1', scriptId: 's1' });
    expect(readLastSession('user-b')).toBeNull();
    expect(readLastSession(null)).toBeNull();
  });

  it('keeps another account’s record for when it signs back in', () => {
    rememberLastSession('p1', 's1', 'user-a');
    expect(readLastSession('user-b')).toBeNull();
    expect(readLastSession('user-a')?.scriptId).toBe('s1');
  });

  it('reopens a script on this device whoever is signed in', () => {
    rememberLastSession('p1', 's1', null);
    expect(readLastSession('user-a')?.scriptId).toBe('s1');
    expect(readLastSession(null)?.scriptId).toBe('s1');
  });

  it('still reopens a record written before owners were kept', () => {
    localStorage.setItem(KEY, JSON.stringify({ projectId: 'p1', scriptId: 's1', at: Date.now() }));
    expect(readLastSession('user-a')?.scriptId).toBe('s1');
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

// A deleted script must not stay queued to reopen: reopening fails, the editor
// falls back to the project, the project to the start screen, and the start
// screen reopened it again — a redirect loop of 404s.
describe('forgetLastSessionFor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forgets the record when its script is deleted', () => {
    rememberLastSession('p1', 's1');
    forgetLastSessionFor('p1', 's1');
    expect(readLastSession()).toBeNull();
  });

  it('forgets the record when its whole project is deleted', () => {
    rememberLastSession('p1', 's1');
    forgetLastSessionFor('p1');
    expect(readLastSession()).toBeNull();
  });

  it('keeps the record when something else is deleted', () => {
    rememberLastSession('p1', 's1');
    forgetLastSessionFor('p1', 's2');
    forgetLastSessionFor('p2');
    expect(readLastSession()).toMatchObject({ projectId: 'p1', scriptId: 's1' });
  });

  it('keeps a record that belongs to another account unless it matches', () => {
    rememberLastSession('p1', 's1', 'user-a');
    forgetLastSessionFor('p9', 's9');
    expect(readLastSession('user-a')).toMatchObject({ scriptId: 's1' });
    forgetLastSessionFor('p1', 's1');
    expect(readLastSession('user-a')).toBeNull();
  });

  it('never throws on an unreadable record', () => {
    localStorage.setItem(KEY, '{not json');
    expect(() => forgetLastSessionFor('p1', 's1')).not.toThrow();
  });
});
