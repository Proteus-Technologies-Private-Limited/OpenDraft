/**
 * The "your session for … has ended" notice names the account that was signed
 * in. On a shared computer that tells the next person who used it last, so it
 * is only kept while the writer opted in to "Remember email" on this device.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  REMEMBERED_EMAIL_KEY,
  clearSignedOutAccount,
  readSignedOutAccount,
  recordSignedOutAccount,
} from './signedOutAccount';

const SIGNED_OUT_KEY = 'opendraft:signedOutEmail';
const AUTH_KEY = 'opendraft:collabAuth';

beforeEach(() => {
  localStorage.clear();
});

describe('signed-out account email', () => {
  it('is recorded when "Remember email" is on', () => {
    localStorage.setItem(REMEMBERED_EMAIL_KEY, 'alice@example.com');
    recordSignedOutAccount('alice@example.com');
    expect(readSignedOutAccount()).toBe('alice@example.com');
  });

  it('is not recorded when "Remember email" is off', () => {
    recordSignedOutAccount('alice@example.com');
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
    expect(readSignedOutAccount()).toBeNull();
  });

  it('drops a value stored before the rule when the preference is off', () => {
    localStorage.setItem(SIGNED_OUT_KEY, 'alice@example.com');
    expect(readSignedOutAccount()).toBeNull();
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
  });

  it('is forgotten once "Remember email" is unticked', () => {
    localStorage.setItem(REMEMBERED_EMAIL_KEY, 'alice@example.com');
    recordSignedOutAccount('alice@example.com');
    localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    expect(readSignedOutAccount()).toBeNull();
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
  });

  it('clears an older value when a session ends with the preference off', () => {
    localStorage.setItem(SIGNED_OUT_KEY, 'bob@example.com');
    recordSignedOutAccount('alice@example.com');
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
  });

  it('clearSignedOutAccount removes it', () => {
    localStorage.setItem(REMEMBERED_EMAIL_KEY, 'alice@example.com');
    recordSignedOutAccount('alice@example.com');
    clearSignedOutAccount();
    expect(readSignedOutAccount()).toBeNull();
  });
});

describe('settingsStore.clearCollabAuth', () => {
  async function storeSignedInAs(email: string) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      accessToken: 'a', refreshToken: 'r', user: { id: 'u1', email, displayName: 'A' },
    }));
    vi.resetModules();
    return (await import('../stores/settingsStore')).useSettingsStore;
  }

  it('records nothing for a session that ends on its own with "Remember email" off', async () => {
    const store = await storeSignedInAs('alice@example.com');
    store.getState().clearCollabAuth();
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
  });

  it('records the email for a session that ends on its own with "Remember email" on', async () => {
    localStorage.setItem(REMEMBERED_EMAIL_KEY, 'alice@example.com');
    const store = await storeSignedInAs('alice@example.com');
    store.getState().clearCollabAuth();
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBe('alice@example.com');
  });

  it('records nothing for a deliberate sign-out', async () => {
    localStorage.setItem(REMEMBERED_EMAIL_KEY, 'alice@example.com');
    const store = await storeSignedInAs('alice@example.com');
    store.getState().clearCollabAuth({ deliberate: true });
    expect(localStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
  });
});
