/**
 * Test environment shims.
 *
 * The suite runs in vitest's `node` environment — no DOM, which keeps tests
 * fast and free of jsdom. But several pure-logic modules under test import a
 * Zustand store transitively, and those stores read `localStorage` at module
 * scope to hydrate user preferences.
 *
 * Rather than restructure production code to suit the tests, provide the one
 * browser API they touch. This is an in-memory implementation with the real
 * semantics: values are coerced to strings, a missing key returns null.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

/**
 * `navigator` became a Node global in 21. CI runs Node 20, where it is absent —
 * so anything reading it at module scope threw there while passing on a newer
 * local Node, and the suite went red only after it was pushed. `getOS()` reads
 * `navigator.userAgent`, and the clipboard tests stub `navigator.clipboard`, so
 * the shim carries a userAgent and stays writable for them to define onto.
 */
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', maxTouchPoints: 0 },
    writable: true,
    configurable: true,
  });
}

/**
 * `config.ts` reads `window.__TAURI_INTERNALS__` and `window.location.origin`
 * at module scope to decide the API base URL. Exporters reach it transitively
 * via `imageAsset`. A plain (non-Tauri) origin is the right shape for tests —
 * nothing under test makes a network call.
 */
if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { origin: 'http://localhost', href: 'http://localhost/', pathname: '/' },
      localStorage: globalThis.localStorage,
      sessionStorage: globalThis.sessionStorage,
      navigator: { userAgent: 'node' },
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
    configurable: true,
  });
}
