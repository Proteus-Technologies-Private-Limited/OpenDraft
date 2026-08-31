/**
 * Where File → Print sends the script.
 *
 * Both mobile platforms were broken, in opposite ways. On iOS Tauri replaces
 * `window.print()` with a command it registers on desktop only, so asking for
 * a print dialog rejected — and the rejection put an unclosable error screen
 * over the writer's document (issue #97). On Android nothing rejected and
 * nothing happened: the WebView has no window.print() to call. Each needs its
 * own destination, and desktop and the browser must keep the real dialog they
 * already have — routing those through a PDF would replace a working print
 * with a file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { printRoute } from './platform';

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
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
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

describe('printRoute', () => {
  it('sends an iPhone to the share sheet — the device the bug was reported from', () => {
    pose(IPHONE, 5, true);
    expect(printRoute()).toBe('ios-share-sheet');
  });

  it('sends an iPad there too, which reproduced it', () => {
    pose(IPAD, 5, true);
    expect(printRoute()).toBe('ios-share-sheet');
  });

  it('recognises an iPad hiding behind a desktop user agent', () => {
    pose(IPAD_DESKTOP_UA, 5, true);
    expect(printRoute()).toBe('ios-share-sheet');
  });

  it('sends Android to the system print service', () => {
    pose(ANDROID, 5, true);
    expect(printRoute()).toBe('android-print-service');
  });

  it('leaves a Mac on its own print dialog', () => {
    pose(MAC, 0, true);
    expect(printRoute()).toBe('dialog');
  });

  it('leaves Windows on its own print dialog', () => {
    pose(WINDOWS, 0, true);
    expect(printRoute()).toBe('dialog');
  });

  it('leaves a mobile browser alone — Safari and Chrome print for themselves', () => {
    pose(IPHONE, 5, false);
    expect(printRoute()).toBe('dialog');
  });

  it('leaves an Android browser alone as well', () => {
    pose(ANDROID, 5, false);
    expect(printRoute()).toBe('dialog');
  });
});
