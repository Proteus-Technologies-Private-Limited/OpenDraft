/**
 * Settings → Account & Sharing → Invite Defaults.
 *
 * The expiry is stored in hours and 30 minutes is 0.5. It used to be read back
 * with parseInt, which made it 0 after a restart: Settings still looked right
 * (the pulldown showed its first option, which happens to be 30 minutes), but
 * the Share dialog's `|| 1` turned every new invite into a 1-hour one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'opendraft:defaultInviteExpiry';

async function freshStore() {
  vi.resetModules();
  const mod = await import('./settingsStore');
  return mod.useSettingsStore;
}

beforeEach(() => {
  localStorage.removeItem(KEY);
});

describe('default invite expiry', () => {
  it('is 1 hour when nothing is stored', async () => {
    expect((await freshStore()).getState().defaultInviteExpiry).toBe(1);
  });

  it.each([0.5, 1, 6, 168, 720])('keeps %s hours across a restart', async (hours) => {
    (await freshStore()).getState().setDefaultInviteExpiry(hours);
    expect((await freshStore()).getState().defaultInviteExpiry).toBe(hours);
  });

  it.each(['', 'soon', '0', '-3', 'Infinity'])('falls back to 1 hour for a stored %j', async (raw) => {
    localStorage.setItem(KEY, raw);
    expect((await freshStore()).getState().defaultInviteExpiry).toBe(1);
  });
});
