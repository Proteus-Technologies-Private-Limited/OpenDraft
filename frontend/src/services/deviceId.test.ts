import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDevicePlatform } from './deviceId';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

function device(userAgent: string, maxTouchPoints: number, app: boolean) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints });
  vi.stubGlobal('window', app ? { __TAURI_INTERNALS__: {} } : {});
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('device platform', () => {
  it('names an iPad as iOS even though iPadOS sends a Mac user agent', () => {
    device(MAC_UA, 5, true);
    expect(getDevicePlatform()).toBe('iOS (OpenDraft)');
    device(MAC_UA, 5, false);
    expect(getDevicePlatform()).toBe('iOS browser');
  });

  it('still names a Mac (no touch screen) as macOS', () => {
    device(MAC_UA, 0, true);
    expect(getDevicePlatform()).toBe('macOS (OpenDraft)');
    device(MAC_UA, 0, false);
    expect(getDevicePlatform()).toBe('macOS browser');
  });

  it('names an iPhone and an Android device as before', () => {
    device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, true);
    expect(getDevicePlatform()).toBe('iOS (OpenDraft)');
    device('Mozilla/5.0 (Linux; Android 15; Pixel Fold)', 5, true);
    expect(getDevicePlatform()).toBe('Android (OpenDraft)');
  });
});
