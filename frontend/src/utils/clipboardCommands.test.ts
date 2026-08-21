/**
 * The Edit menu's Cut, Copy and Paste.
 *
 * All three ran `document.execCommand`, which acts on the DOM selection — gone
 * by the time a menu item is tapped on iOS — and `execCommand('paste')` is not
 * implemented by WebKit at all. These pin the replacement: which clipboard
 * flavour is written, what happens as each API is missing in turn, and that a
 * cut never destroys the selection unless the copy actually landed.
 *
 * `serializeSelection` is deliberately absent: it builds real DOM through
 * ProseMirror's DOMSerializer, and this suite runs without a DOM on purpose
 * (see vitest.config.ts). Its output is covered in the app itself — and with
 * it `cutSelection`, whose delete-by-range cannot be reached without first
 * serializing. The same rule is pinned on the paste side, where no DOM is
 * needed: the range is read before the await and applied after it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeClipboard, pasteIntoEditor, pasteWithoutFormatting } from './clipboardCommands';

/** Set per test: the paste path is deliberately different on iOS. */
let os: 'ios' | 'macos' = 'macos';
vi.mock('../services/platform', () => ({ getOS: () => os }));

type Editor = Parameters<typeof pasteIntoEditor>[0];

/** The parts of an editor these commands touch, and nothing else. */
function fakeEditor(selection = { from: 42, to: 42 }) {
  const pasteHTML = vi.fn(() => true);
  const pasteText = vi.fn(() => true);
  const setTextSelection = vi.fn(() => chain);
  const deleteRange = vi.fn(() => chain);
  const chain: Record<string, unknown> = { setTextSelection, deleteRange, run: vi.fn(() => true) };
  chain.focus = vi.fn(() => chain);

  return {
    editor: {
      // `state` is read before any await; the commands below run after one.
      state: { selection, doc: { content: { size: 500 } } },
      chain: () => chain,
      commands: { focus: vi.fn() },
      view: { pasteHTML, pasteText },
    } as unknown as Editor,
    pasteHTML,
    pasteText,
    setTextSelection,
    deleteRange,
  };
}

/** A clipboard item as `navigator.clipboard.read()` hands them over. */
function clipboardItem(types: Record<string, string>) {
  return {
    types: Object.keys(types),
    getType: async (type: string) => ({ text: async () => types[type] }),
  };
}

const originalClipboard = navigator.clipboard;
const originalClipboardItem = globalThis.ClipboardItem;

beforeEach(() => {
  os = 'macos';
  globalThis.ClipboardItem = class {
    items: Record<string, Blob>;
    constructor(items: Record<string, Blob>) { this.items = items; }
  } as unknown as typeof ClipboardItem;
});

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  globalThis.ClipboardItem = originalClipboardItem;
  vi.restoreAllMocks();
});

function stubClipboard(api: Record<string, unknown>) {
  Object.defineProperty(navigator, 'clipboard', { value: api, configurable: true });
}

describe('writeClipboard', () => {
  it('writes both flavours, so emphasis survives a copy', async () => {
    const write = vi.fn(async () => undefined);
    stubClipboard({ write, writeText: vi.fn() });

    expect(await writeClipboard('<p><em>Hi</em></p>', 'Hi')).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    // write() takes an array of items; the flavours live on the first of them.
    const [[[item]]] = write.mock.calls as unknown as [[[{ items: Record<string, Blob> }]]];
    expect(Object.keys(item.items).sort()).toEqual(['text/html', 'text/plain']);
  });

  it('falls back to plain text when the rich write is refused', async () => {
    const write = vi.fn(async () => { throw new Error('not allowed'); });
    const writeText = vi.fn(async () => undefined);
    stubClipboard({ write, writeText });

    expect(await writeClipboard('<p>Hi</p>', 'Hi')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Hi');
  });

  it('falls back to execCommand when the async clipboard is missing entirely', async () => {
    stubClipboard({});
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('document', { execCommand });

    expect(await writeClipboard('<p>Hi</p>', 'Hi')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});

describe('pasteIntoEditor', () => {
  it('prefers the HTML flavour, so the paste keeps its emphasis', async () => {
    const { editor, pasteHTML, pasteText } = fakeEditor();
    stubClipboard({
      read: async () => [clipboardItem({ 'text/html': '<p>Hi</p>', 'text/plain': 'Hi' })],
    });

    expect(await pasteIntoEditor(editor)).toEqual({ ok: true });
    expect(pasteHTML).toHaveBeenCalledWith('<p>Hi</p>');
    expect(pasteText).not.toHaveBeenCalled();
  });

  it('takes plain text when that is all the clipboard holds', async () => {
    const { editor, pasteText } = fakeEditor();
    stubClipboard({ read: async () => [clipboardItem({ 'text/plain': 'INT. KITCHEN - DAY' })] });

    expect(await pasteIntoEditor(editor)).toEqual({ ok: true });
    expect(pasteText).toHaveBeenCalledWith('INT. KITCHEN - DAY');
  });

  it('takes the same rich path on iOS, so the menu matches long-press', async () => {
    os = 'ios';
    const { editor, pasteHTML } = fakeEditor();
    stubClipboard({
      read: async () => [clipboardItem({ 'text/html': '<p><b>Loud</b></p>', 'text/plain': 'Loud' })],
      readText: async () => { throw new Error('should not be reached'); },
    });

    expect(await pasteIntoEditor(editor)).toEqual({ ok: true });
    // Routing iOS through readText() cost one prompt instead of two, but threw
    // away bold, italic and colour to do it.
    expect(pasteHTML).toHaveBeenCalledWith('<p><b>Loud</b></p>');
  });

  it('fetches exactly one flavour, because each getType is another prompt', async () => {
    const { editor } = fakeEditor();
    const getType = vi.fn(async () => ({ text: async () => '<p>Hi</p>' }));
    stubClipboard({
      read: async () => [{ types: ['text/html', 'text/plain'], getType }],
    });

    await pasteIntoEditor(editor);
    expect(getType).toHaveBeenCalledTimes(1);
    expect(getType).toHaveBeenCalledWith('text/html');
  });

  it('names the iOS prompt when the read is refused', async () => {
    os = 'ios';
    const { editor } = fakeEditor();
    stubClipboard({ readText: async () => { throw new Error('NotAllowedError'); } });

    const result = await pasteIntoEditor(editor);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('tap “Paste”');
  });

  it('does not read twice when the item API is refused off iOS', async () => {
    const { editor } = fakeEditor();
    const read = vi.fn(async () => { throw new Error('NotAllowedError'); });
    const readText = vi.fn(async () => 'should not be reached');
    stubClipboard({ read, readText });

    expect((await pasteIntoEditor(editor)).ok).toBe(false);
    expect(readText).not.toHaveBeenCalled();
  });

  it('reports an empty clipboard as empty, not as a failure to read', async () => {
    const { editor } = fakeEditor();
    stubClipboard({ read: async () => [] });

    expect(await pasteIntoEditor(editor)).toEqual({ ok: false, error: 'The clipboard is empty.' });
  });

  it('pastes where the writer left the cursor, not where focus came back', async () => {
    const { editor, setTextSelection, pasteHTML } = fakeEditor({ from: 42, to: 42 });
    stubClipboard({ read: async () => [clipboardItem({ 'text/html': '<p>Hi</p>' })] });

    await pasteIntoEditor(editor);

    // Awaiting the clipboard hands control to a system prompt, and focus comes
    // back with the selection at the top of the document — which put the paste
    // in the script's first element instead of under the cursor.
    expect(setTextSelection).toHaveBeenCalledWith({ from: 42, to: 42 });
    expect(setTextSelection.mock.invocationCallOrder[0])
      .toBeLessThan(pasteHTML.mock.invocationCallOrder[0]);
  });

  it('clamps a stale cursor to a document that has since shrunk', async () => {
    const { editor, setTextSelection } = fakeEditor({ from: 9000, to: 9000 });
    stubClipboard({ read: async () => [clipboardItem({ 'text/plain': 'Hi' })] });

    await pasteIntoEditor(editor);

    expect(setTextSelection).toHaveBeenCalledWith({ from: 500, to: 500 });
  });

  it('uses readText where the item-based API is unavailable', async () => {
    const { editor, pasteText } = fakeEditor();
    stubClipboard({ readText: async () => 'CUT TO:' });

    expect(await pasteIntoEditor(editor)).toEqual({ ok: true });
    expect(pasteText).toHaveBeenCalledWith('CUT TO:');
  });
});

describe('pasteWithoutFormatting', () => {
  it('never asks for the HTML flavour', async () => {
    const { editor, pasteHTML, pasteText } = fakeEditor();
    const read = vi.fn();
    stubClipboard({ read, readText: async () => 'Plain words' });

    expect(await pasteWithoutFormatting(editor)).toEqual({ ok: true });
    expect(read).not.toHaveBeenCalled();
    expect(pasteHTML).not.toHaveBeenCalled();
    expect(pasteText).toHaveBeenCalledWith('Plain words');
  });
});
