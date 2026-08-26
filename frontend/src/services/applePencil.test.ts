/**
 * Which devices the handwriting input is offered on (issue #90).
 *
 * The button exists for the Apple Pencil, so it belongs on an iPad and nowhere
 * else. Getting this wrong is quiet in both directions: hidden on an iPad the
 * feature does not exist, and shown on a Mac it is a button that does nothing
 * useful.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { supportsApplePencil } from './platform';

/** Pose as a device: user agent plus how many fingers it can feel. */
function pose(userAgent: string, maxTouchPoints: number) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15';
// iPadOS 13+ claims to be a Macintosh; only the touch points give it away.
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';

const original = { ua: navigator.userAgent, touch: navigator.maxTouchPoints };
afterEach(() => pose(original.ua, original.touch));

describe('supportsApplePencil', () => {
  it('is true for an iPad that says so', () => {
    pose(IPAD_OLD, 5);
    expect(supportsApplePencil()).toBe(true);
  });

  it('is true for an iPad hiding behind a desktop user agent', () => {
    pose(IPAD_DESKTOP_UA, 5);
    expect(supportsApplePencil()).toBe(true);
  });

  it('is false on an iPhone — no Pencil pairs with one', () => {
    pose(IPHONE, 5);
    expect(supportsApplePencil()).toBe(false);
  });

  it('is false on a real Mac, which has no touch points', () => {
    pose(MAC, 0);
    expect(supportsApplePencil()).toBe(false);
  });

  it('is false on Android', () => {
    pose(ANDROID, 5);
    expect(supportsApplePencil()).toBe(false);
  });
});
