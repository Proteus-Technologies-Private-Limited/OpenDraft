/**
 * Stable per-installation device identifier sent on every auth request.
 *
 * The server uses (userId, deviceId) to:
 *   • notify the user by email when a new device signs in (default), or
 *   • require an emailed 6-digit code on every new device when the user
 *     has opted into two-factor verification.
 *
 * The id is generated once on first run and persisted in localStorage.
 * Clearing site data effectively forgets the device — that's by design;
 * a cleared client looks new to the server and the user gets notified.
 */

const STORAGE_KEY = 'opendraft:deviceId';
const NAME_KEY = 'opendraft:deviceName';

function randomId(): string {
  // crypto.randomUUID is available everywhere we ship (modern browsers,
  // Tauri's WKWebView, Android System WebView). The fallback only kicks
  // in for very old environments and is not security-critical — the id
  // is opaque to the user and rotated freely.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function detectPlatform(): string {
  try {
    const ua = navigator.userAgent || '';
    const isTauri = typeof (window as any).__TAURI__ !== 'undefined' || typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
    if (isTauri) {
      if (/Android/i.test(ua)) return 'Android (OpenDraft)';
      if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS (OpenDraft)';
      if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS (OpenDraft)';
      if (/Windows/i.test(ua)) return 'Windows (OpenDraft)';
      if (/Linux/i.test(ua)) return 'Linux (OpenDraft)';
      return 'Desktop (OpenDraft)';
    }
    if (/Android/i.test(ua)) return 'Android browser';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS browser';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS browser';
    if (/Windows/i.test(ua)) return 'Windows browser';
    if (/Linux/i.test(ua)) return 'Linux browser';
  } catch { /* ignore */ }
  return 'Unknown';
}

function defaultName(): string {
  const platform = detectPlatform();
  // Browser name as a coarse hint — better than "Unknown".
  let browser = '';
  try {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
  } catch { /* ignore */ }
  return browser ? `${platform} · ${browser}` : platform;
}

export function getDeviceId(): string {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) return cached;
    const fresh = randomId();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / disabled storage — fall back to an in-memory id.
    if (!(globalThis as any).__opendraftDeviceIdMemo) {
      (globalThis as any).__opendraftDeviceIdMemo = randomId();
    }
    return (globalThis as any).__opendraftDeviceIdMemo;
  }
}

export function getDeviceName(): string {
  try {
    const cached = localStorage.getItem(NAME_KEY);
    if (cached) return cached;
  } catch { /* ignore */ }
  return defaultName();
}

export function setDeviceName(name: string): void {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch { /* ignore */ }
}

export function getDevicePlatform(): string {
  return detectPlatform();
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
}

export function getDeviceInfo(): DeviceInfo {
  return {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    platform: getDevicePlatform(),
  };
}
