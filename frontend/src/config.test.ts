import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The Cloud API base must default to the hosted OpenDraft server on packaged
 * apps.
 *
 * Every desktop release used to be built with
 * `VITE_API_BASE=http://localhost:18321/api` — a leftover from when the app
 * shipped a Python sidecar on that port. `computeApiBase` consulted the env var
 * before the Tauri branch, so the `https://open-draft.com` default was
 * unreachable and shipped builds pointed at a dead local port: sign-in failed
 * out of the box, and Settings showed localhost as the "default".
 */

const HOSTED = 'https://open-draft.com/api';

function setTauri(on: boolean) {
  if (on) (window as any).__TAURI_INTERNALS__ = {};
  else delete (window as any).__TAURI_INTERNALS__;
}

function setEnv(value: string | undefined) {
  if (value === undefined) vi.stubEnv('VITE_API_BASE', '');
  else vi.stubEnv('VITE_API_BASE', value);
}

async function loadConfig() {
  vi.resetModules();
  return await import('./config');
}

describe('computeApiBase', () => {
  beforeEach(() => {
    localStorage.clear();
    setTauri(false);
    setEnv(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setTauri(false);
    localStorage.clear();
  });

  it('defaults to the hosted server on a packaged app', async () => {
    setTauri(true);
    const { getApiBase } = await loadConfig();
    expect(getApiBase()).toBe(HOSTED);
  });

  it('ignores a loopback VITE_API_BASE baked into a packaged build', async () => {
    setTauri(true);
    setEnv('http://localhost:18321/api');
    const { getApiBase } = await loadConfig();
    expect(getApiBase()).toBe(HOSTED);
  });

  it('ignores a 127.0.0.1 VITE_API_BASE on a packaged app too', async () => {
    setTauri(true);
    setEnv('http://127.0.0.1:8008/api');
    const { getApiBase } = await loadConfig();
    expect(getApiBase()).toBe(HOSTED);
  });

  it('still honours a real VITE_API_BASE so self-hosters can retarget a build', async () => {
    setTauri(true);
    setEnv('https://scripts.example.com');
    const { getApiBase } = await loadConfig();
    expect(getApiBase()).toBe('https://scripts.example.com/api');
  });

  it('lets a saved Settings override win over everything', async () => {
    setTauri(true);
    setEnv('https://scripts.example.com');
    localStorage.setItem('opendraft:cloudApiUrl', 'https://mine.example.org');
    const { getApiBase } = await loadConfig();
    expect(getApiBase()).toBe('https://mine.example.org/api');
  });

  it('leaves the browser free to use a loopback backend in development', async () => {
    setTauri(false);
    setEnv('http://localhost:8008/api');
    const { getApiBase } = await loadConfig();
    expect(getApiBase()).toBe('http://localhost:8008/api');
  });
});
