import { beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../../src-tauri/tauri.conf.json';

const native = vi.hoisted(() => ({ enabled: false, getVersion: vi.fn() }));
vi.mock('./platform', () => ({ isTauri: () => native.enabled }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: native.getVersion }));

beforeEach(() => {
  vi.resetModules();
  native.enabled = false;
  native.getVersion.mockReset();
});

describe('application version', () => {
  it('uses the release configuration in the browser without calling native IPC', async () => {
    const app = await import('./appVersion');
    expect(app.getAppVersion()).toBe(version);
    expect(await app.readAppVersion()).toBe(version);
    expect(native.getVersion).not.toHaveBeenCalled();
  });
  it('reads a native packaging override and shares concurrent lookups', async () => {
    native.enabled = true;
    native.getVersion.mockResolvedValue('9.8.7');
    const app = await import('./appVersion');
    expect(await Promise.all([app.readAppVersion(), app.readAppVersion()])).toEqual(['9.8.7', '9.8.7']);
    expect(native.getVersion).toHaveBeenCalledTimes(1);
    expect(app.getAppVersion()).toBe('9.8.7');
    expect(await app.readAppVersion()).toBe('9.8.7');
    expect(native.getVersion).toHaveBeenCalledTimes(1);
  });
  it('falls back to the build version after an unavailable native API and allows retry', async () => {
    native.enabled = true;
    native.getVersion.mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValue('8.0.1');
    const app = await import('./appVersion');
    expect(await app.readAppVersion()).toBe(version);
    expect(await app.readAppVersion()).toBe('8.0.1');
  });
  it('ignores empty native versions', async () => {
    native.enabled = true;
    native.getVersion.mockResolvedValue('  ');
    const app = await import('./appVersion');
    expect(await app.readAppVersion()).toBe(version);
  });
});
