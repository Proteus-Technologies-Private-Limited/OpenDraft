import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
function edit(meta: Record<string, unknown> = {}): Transaction {
  const tr = EditorState.create({ schema }).tr.insertText('typed', 1);
  for (const [key, value] of Object.entries(meta)) tr.setMeta(key, value);
  return tr;
}

const fixture = vi.hoisted(() => ({
  kind: 'system' as 'system' | 'ai',
  speak: vi.fn(async () => {}),
  invoke: vi.fn(),
  lineIndexAt: vi.fn((_lines: unknown, _pos: number) => 0),
  engineGate: null as Promise<void> | null,
  lines: [
    { index: 0, kind: 'action', speaker: null, from: 1, to: 12, spoken: 'First line', text: 'First line' },
    { index: 1, kind: 'dialogue', speaker: 'SARAH', from: 14, to: 30, spoken: 'Second line', text: 'Second line' },
  ],
}));
vi.mock('../platform', () => ({ isTauri: () => true, getOS: () => 'android' }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../stores/editorStore', () => ({ useEditorStore: { getState: () => ({ characterProfiles: [] }) } }));
vi.mock('../../stores/voiceSettingsStore', () => ({ useVoiceSettingsStore: { getState: () => ({ options: { rate: 1, followScript: false } }) } }));
vi.mock('../../editor/extensions/TableReadHighlight', () => ({ tableReadPluginKey: 'read-highlight' }));
vi.mock('./engines', () => ({
  activeEngineKind: () => fixture.kind,
  engineFor: async () => {
    await fixture.engineGate;
    return { engine: { id: fixture.kind === 'system' ? 'native' : 'ai', kind: fixture.kind, label: 'Synthetic engine', speak: fixture.speak }, voices: [] };
  },
  NeedsProviderError: class extends Error {},
}));
vi.mock('./voiceAssign', () => ({ inferGenders: () => ({}), castVoices: () => ({ narrator: 'narrator', bySpeaker: new Map([['SARAH', 'actor']]) }) }));
vi.mock('./script', () => ({
  buildReadLines: () => fixture.lines, lineIndexAt: fixture.lineIndexAt,
  spokenRangeToText: (_line: unknown, start: number, end: number) => ({ start, end }),
  spokenRangeToDoc: (_line: unknown, start: number, end: number) => ({ from: start, to: end }),
}));

describe('Table Read native queue integration', () => {
  let player: typeof import('./player');
  let store: typeof import('../../stores/tableReadStore').useTableReadStore;
  let native: Record<string, unknown>;
  let transaction: (event: { transaction: Transaction }) => void;
  let editor: Editor;
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); fixture.kind = 'system'; fixture.engineGate = null; fixture.speak.mockClear(); fixture.lineIndexAt.mockClear();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke: fixture.invoke } }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('navigator', { language: 'en' });
    native = { status: 'playing', index: 0, offset: 0, end: 0 };
    fixture.invoke.mockReset().mockImplementation(async (_command, { request }) => {
      if (request.action === 'start') native = { ...native, session: request.session, status: 'playing' };
      if (request.action === 'pause') native = { ...native, status: 'paused' };
      if (request.action === 'play') native = { ...native, status: 'playing' };
      if (request.action === 'jump') native = { ...native, index: request.index, offset: 0, end: 0 };
      return native;
    });
    const tr = { setMeta: vi.fn().mockImplementation(() => tr) };
    editor = { state: { doc: {}, selection: { from: 1 }, tr }, isDestroyed: false,
      on: (_name: string, callback: typeof transaction) => { transaction = callback; }, off: vi.fn(), view: { dispatch: vi.fn() } } as unknown as Editor;
    player = await import('./player'); store = (await import('../../stores/tableReadStore')).useTableReadStore;
    player.prepare(editor);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'release')).toBe(true));
  });
  afterEach(async () => {
    player.teardown();
    if (fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')) {
      await vi.waitFor(() => expect(fixture.invoke.mock.calls.at(-1)?.[1].request.action).toBe('stop'));
    }
    vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it('hands the complete cast queue to Android and reconciles words after suspension', async () => {
    player.play(editor, 0); await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(true));
    const start = fixture.invoke.mock.calls.find(([, args]) => args.request.action === 'start')![1].request;
    expect(start.lines).toMatchObject([{ text: 'First line', voice: 'narrator', gap: 250 }, { text: 'Second line', voice: 'actor', gap: 200 }]);
    expect(fixture.speak).not.toHaveBeenCalled();
    Object.assign(document, { visibilityState: 'hidden' });
    native = { ...native, index: 1, offset: 2, end: 6 };
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getState().current).toBe(0);
    Object.assign(document, { visibilityState: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(store.getState()).toMatchObject({ status: 'playing', current: 1, word: { start: 2, end: 6 } }));
    player.pause(); await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(store.getState().status).toBe('paused'));
    player.resume(); await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(store.getState().status).toBe('playing'));
    expect(fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'start')).toHaveLength(1);
  });

  it('pauses on document edits and rebuilds the native snapshot on resume', async () => {
    player.play(editor, 0); await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(true));
    transaction({ transaction: edit() });
    transaction({ transaction: edit() });
    transaction({ transaction: edit() });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().status).toBe('paused');
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'stop')).toHaveLength(1));
    player.resume(); await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'start')).toHaveLength(2));
  });

  it.each([
    ['remote sync', { 'y-sync$': { isChangeOrigin: true } }],
    ['remote appended repair', { appendedTransaction: edit({ 'y-sync$': { isChangeOrigin: true } }) }],
    ['automatic housekeeping', { addToHistory: false }],
  ])('keeps reading through %s and rebuilds on an explicit resume', async (_name, meta) => {
    player.play(editor, 0);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(true));
    transaction({ transaction: edit(meta) });
    native = { ...native, index: 1, offset: 2, end: 6 };
    await vi.advanceTimersByTimeAsync(400);
    expect(store.getState()).toMatchObject({ status: 'playing', current: 1, word: null });
    expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'stop')).toBe(false);
    expect(fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'start')).toHaveLength(1);
    player.pause();
    await vi.waitFor(() => expect(store.getState().status).toBe('paused'));
    player.resume();
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'start')).toHaveLength(2));
    expect(fixture.lineIndexAt).toHaveBeenLastCalledWith(fixture.lines, 19);
  });

  it.each([
    { 'y-sync$': { isChangeOrigin: false } },
    { 'y-sync$': { isChangeOrigin: true, isUndoRedoOperation: true }, addToHistory: false },
    { history$: {}, addToHistory: false },
  ])('still invalidates the queue for local collaboration edits and undo: %j', async meta => {
    player.play(editor, 0);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(true));
    transaction({ transaction: edit(meta) });
    expect(store.getState().status).toBe('paused');
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'stop')).toBe(true));
  });

  it('jumps within the current native session without resending its queue', async () => {
    player.play(editor, 0);
    await vi.waitFor(() => expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(true));
    player.jumpTo(1);
    await vi.waitFor(() => expect(store.getState().current).toBe(1));
    expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'jump' && args.request.index === 1)).toBe(true);
    expect(fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'start')).toHaveLength(1);
    expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'stop')).toBe(false);
  });

  it('keeps the existing AI foreground player', async () => {
    fixture.kind = 'ai'; player.play(editor, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(false);
    expect(fixture.speak).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe('idle');
  });

  it('does not start an obsolete queue after an edit during voice initialization', async () => {
    player.resetEngine();
    let ready = () => {};
    fixture.engineGate = new Promise<void>(resolve => { ready = resolve; });
    player.play(editor, 0);
    expect(store.getState().status).toBe('loading');
    transaction({ transaction: edit() });
    ready(); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().status).toBe('paused');
    expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'start')).toBe(false);
  });
});
