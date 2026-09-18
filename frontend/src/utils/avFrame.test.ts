/**
 * Choosing the picture for a storyboard frame.
 *
 * The one invariant worth holding down here is WHEN the bytes are read.
 * Android's WebView backs the chosen `File` with a `content://` URI whose read
 * permission does not outlive the `<input>` it came from, so reading after the
 * element leaves the document throws a bare `DOMException` — the picker opened,
 * the writer chose a picture, and the frame silently never arrived (verified on
 * a Pixel 9 emulator; iOS and the desktop webviews never minded either way).
 *
 * These tests therefore model a file that can only be read while its input is
 * mounted, which is exactly the shape of the bug.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { pickImageFile } from './avFrame';

interface FakeInput {
  type: string;
  accept: string;
  style: { display: string };
  files: unknown[] | null;
  onchange: (() => void | Promise<void>) | null;
  click: () => void;
  remove: () => void;
  mounted: boolean;
}

const originalDocument = (globalThis as Record<string, unknown>).document;

/**
 * A file whose bytes are readable only while `input.mounted` is true.
 *
 * `arrayBuffer` rejecting with a `DOMException`-shaped error once the element
 * is gone is the whole of the Android behaviour being reproduced.
 */
function contentUriFile(input: FakeInput, name = 'frame.png', type = 'image/png') {
  return {
    name,
    type,
    async arrayBuffer() {
      if (!input.mounted) {
        throw new Error('The requested file could not be read (permission denied)');
      }
      return new Uint8Array([1, 2, 3, 4]).buffer;
    },
  };
}

/** Install a DOM stub and hand back the input `pickImageFile` will create. */
function stubDom(): { input: FakeInput; clicked: () => boolean } {
  let clicked = false;
  const input: FakeInput = {
    type: '', accept: '', style: { display: '' },
    files: null, onchange: null, mounted: false,
    click: () => { clicked = true; },
    remove: () => { input.mounted = false; },
  };
  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => input,
      body: { appendChild: () => { input.mounted = true; } },
    },
    configurable: true,
  });
  return { input, clicked: () => clicked };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {
    value: originalDocument,
    configurable: true,
  });
});

describe('pickImageFile', () => {
  it('reads the bytes while the input is still mounted', async () => {
    const { input, clicked } = stubDom();
    const promise = pickImageFile();
    expect(clicked()).toBe(true);
    expect(input.accept).toBe('image/*');

    input.files = [contentUriFile(input)];
    await input.onchange?.();

    const file = await promise;
    expect(file).not.toBeNull();
    expect(file!.name).toBe('frame.png');
    expect(file!.type).toBe('image/png');
    // The copy owns its bytes, so the caller can read it after the picker has
    // been torn down — which is what every caller actually does.
    expect(input.mounted).toBe(false);
    expect(await file!.arrayBuffer()).toHaveProperty('byteLength', 4);
  });

  it('takes the input out of the document once it has the bytes', async () => {
    const { input } = stubDom();
    const promise = pickImageFile();
    input.files = [contentUriFile(input)];
    await input.onchange?.();
    await promise;
    expect(input.mounted).toBe(false);
  });

  it('resolves null when the picker is dismissed with nothing chosen', async () => {
    const { input } = stubDom();
    const promise = pickImageFile();
    input.files = [];
    await input.onchange?.();
    await expect(promise).resolves.toBeNull();
  });

  it('rejects rather than resolving null when the chosen file cannot be read', async () => {
    const { input } = stubDom();
    const promise = pickImageFile();
    // Unreadable from the start — a cancel and a failure are different things,
    // and only one of them is worth telling the writer about.
    input.files = [{
      name: 'frame.png',
      type: 'image/png',
      arrayBuffer: async () => { throw new Error('could not be read'); },
    }];
    await input.onchange?.();
    await expect(promise).rejects.toThrow(/could not be read/);
  });
});
