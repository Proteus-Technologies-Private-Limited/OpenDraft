/**
 * Where File → Print sends the script (issue #97).
 *
 * On iOS Tauri replaces `window.print()` with a command it only registers on
 * desktop, so asking for a print dialog there rejected — and the rejection
 * put an unclosable error screen over the writer's document. Print has to
 * recognise that platform and go to the share sheet, where AirPrint lives,
 * and it has to recognise only that platform: routing a desktop or a browser
 * through the share sheet would replace a working print dialog with a file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { printsViaShareSheet } from './platform';

/** Pose as a device: user agent, touch points, and whether Tauri is present. */
function pose(userAgent: string, maxTouchPoints: number, tauri: boolean) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  if (tauri) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
// iPadOS 13+ claims to be a Macintosh; only the touch points give it away.
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';

const original = {
  ua: navigator.userAgent,
  touch: navigator.maxTouchPoints,
  tauri: (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__,
};
afterEach(() => {
  pose(original.ua, original.touch, false);
  if (original.tauri) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = original.tauri;
});

describe('printsViaShareSheet', () => {
  it('is true on an iPhone — the device the bug was reported from', () => {
    pose(IPHONE, 5, true);
    expect(printsViaShareSheet()).toBe(true);
  });

  it('is true on an iPad, which reproduced it too', () => {
    pose(IPAD, 5, true);
    expect(printsViaShareSheet()).toBe(true);
  });

  it('is true on an iPad hiding behind a desktop user agent', () => {
    pose(IPAD_DESKTOP_UA, 5, true);
    expect(printsViaShareSheet()).toBe(true);
  });

  it('is false on a Mac, which has a real print dialog', () => {
    pose(MAC, 0, true);
    expect(printsViaShareSheet()).toBe(false);
  });

  it('is false on Android, where window.print() was never intercepted', () => {
    pose(ANDROID, 5, true);
    expect(printsViaShareSheet()).toBe(false);
  });

  it('is false in a mobile browser — Safari prints for itself', () => {
    pose(IPHONE, 5, false);
    expect(printsViaShareSheet()).toBe(false);
  });
});
