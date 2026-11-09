import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { markSignedUp, hasSignedUpBefore } from './accountMarker';
import { isUnknownAccountError } from './collabAuth';

/**
 * The sign-in forms tell first-time visitors to create an account before
 * signing in, and stop once an account has been used on the device. These pin
 * what counts as "used before" and what counts as "no such account".
 */

// Node has no document; a minimal cookie jar that behaves like the browser's
// (writing one cookie never clears the others, reading returns them all).
function installCookieJar() {
  const jar = new Map<string, string>();
  vi.stubGlobal('document', {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(raw: string) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    },
  });
  return jar;
}

describe('accountMarker', () => {
  let jar: Map<string, string>;

  beforeEach(() => {
    localStorage.clear();
    jar = installCookieJar();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false on a device nobody has signed in on', () => {
    expect(hasSignedUpBefore()).toBe(false);
  });

  it('writes both the cookie and the localStorage copy', () => {
    markSignedUp();
    expect(jar.get('opendraft_has_account')).toBe('1');
    expect(localStorage.getItem('opendraft:hasAccount')).toBe('1');
    expect(hasSignedUpBefore()).toBe(true);
  });

  it('counts the cookie alone (web, after site data other than cookies was cleared)', () => {
    jar.set('opendraft_has_account', '1');
    expect(hasSignedUpBefore()).toBe(true);
  });

  it('counts localStorage alone (desktop/mobile webviews that drop cookies)', () => {
    localStorage.setItem('opendraft:hasAccount', '1');
    expect(hasSignedUpBefore()).toBe(true);
  });

  it('counts a remembered email from before the marker existed', () => {
    localStorage.setItem('opendraft:rememberedEmail', 'writer@example.com');
    expect(hasSignedUpBefore()).toBe(true);
  });

  it('ignores an unrelated cookie whose name merely contains ours', () => {
    jar.set('x_opendraft_has_account_old', '1');
    expect(hasSignedUpBefore()).toBe(false);
  });

  it('survives a document whose cookie access throws', () => {
    vi.stubGlobal('document', {
      get cookie(): string { throw new Error('SecurityError'); },
      set cookie(_v: string) { throw new Error('SecurityError'); },
    });
    expect(() => markSignedUp()).not.toThrow();
    // localStorage copy still lands, so the hint still works.
    expect(hasSignedUpBefore()).toBe(true);
  });
});

describe('isUnknownAccountError', () => {
  it('matches the collab server 404 for an unregistered email', () => {
    expect(isUnknownAccountError({ status: 404, message: 'User not found' })).toBe(true);
  });

  it('does not take a misrouted API 404 for a missing account', () => {
    expect(isUnknownAccountError({ status: 404, message: 'Not Found' })).toBe(false);
  });

  it('does not match a wrong password or a server error', () => {
    expect(isUnknownAccountError({ status: 401, message: 'Invalid email or password' })).toBe(false);
    expect(isUnknownAccountError({ status: 502, message: 'User not found' })).toBe(false);
    expect(isUnknownAccountError(new Error('Failed to fetch'))).toBe(false);
    expect(isUnknownAccountError(null)).toBe(false);
  });
});
