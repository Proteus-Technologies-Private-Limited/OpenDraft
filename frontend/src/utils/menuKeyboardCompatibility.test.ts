import { afterEach, describe, expect, it, vi } from 'vitest';

const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;

afterEach(() => {
  Object.defineProperty(Intl, 'Segmenter', descriptor);
  vi.resetModules();
});

describe('menu typeahead without Intl.Segmenter', () => {
  it.each(['a', 'é', '😀', 'क', 'ि', 'कि', 'E\u0301', 'e\u0301\u0323'])('accepts the printable key %s', async key => {
    Reflect.deleteProperty(Intl, 'Segmenter');
    vi.resetModules();
    const { menuSearchKey } = await import('./menuKeyboard');
    expect(menuSearchKey(key)).toBe(true);
  });

  it.each(['', ' ', '\n', 'Dead', 'Shift', 'ArrowDown', 'ab', 'क्ष', 'e' + '\u0301'.repeat(4)])('rejects unsupported key %s', async key => {
    Reflect.deleteProperty(Intl, 'Segmenter');
    vi.resetModules();
    const { menuSearchKey } = await import('./menuKeyboard');
    expect(menuSearchKey(key)).toBe(false);
  });

  it('creates one available segmenter for repeated key events', async () => {
    const NativeSegmenter = Intl.Segmenter;
    let calls = 0;
    class CountingSegmenter extends NativeSegmenter {
      constructor(...args: ConstructorParameters<typeof Intl.Segmenter>) {
        super(...args);
        calls++;
      }
    }
    Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: CountingSegmenter });
    vi.resetModules();
    const { menuSearchKey } = await import('./menuKeyboard');
    for (const key of ['a', 'कि', 'क्ष', 'e\u0301']) expect(menuSearchKey(key)).toBe(true);
    expect(calls).toBe(1);
  });
});
