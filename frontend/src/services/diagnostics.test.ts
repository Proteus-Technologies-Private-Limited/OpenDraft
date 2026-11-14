import { describe, expect, it } from 'vitest';
import { detectOs } from './diagnostics';

// User agents as the app's web views actually send them.
const IPHONE_WKWEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_MOBILE_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const DESKTOP_CLASS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

describe('detectOs', () => {
  it('reports an iPhone as iOS, not macOS', () => {
    // Every iOS user agent says "like Mac OS X"; this was reported as macOS.
    expect(detectOs(IPHONE_WKWEBVIEW, 5)).toBe('iOS');
  });

  it('reports an iPad as iPadOS, whether its user agent says iPad or Macintosh', () => {
    expect(detectOs(IPAD_MOBILE_UA, 5)).toBe('iPadOS');
    expect(detectOs(DESKTOP_CLASS_SAFARI, 5)).toBe('iPadOS');
  });

  it('still reports a Mac, which has no touch points, as macOS with its version', () => {
    expect(detectOs(DESKTOP_CLASS_SAFARI, 0)).toBe('macOS 10.15.7');
  });

  it('keeps Android, Windows and Linux as before', () => {
    expect(detectOs('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36', 5)).toBe('Android');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 0)).toBe('Windows 10/11 (x64)');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 0)).toBe('Linux');
  });
});
