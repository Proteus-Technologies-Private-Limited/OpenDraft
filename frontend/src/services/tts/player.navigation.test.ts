import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';
import type { SpeakOptions } from './types';

const fixture = vi.hoisted(() => ({
  kind: 'system' as 'system' | 'ai',
  invoke: vi.fn(),
  speak: vi.fn(),
  engineGate: null as Promise<void> | null,
}));
vi.mock('../platform', () => ({ isTauri: () => true, getOS: () => 'android' }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../stores/editorStore', () => ({ useEditorStore: { getState: () => ({ characterProfiles: [] }) } }));
vi.mock('../../stores/voiceSettingsStore', () => ({ useVoiceSettingsStore: { getState: () => ({ options: {
  rate: 1, followScript: false, readAction: true, readSceneHeadings: true,
  readParentheticals: true, readTransitions: true, announceCharacters: false,
} }) } }));
vi.mock('../../editor/extensions/TableReadHighlight', () => ({ tableReadPluginKey: 'read-highlight' }));
vi.mock('./voiceAssign', () => ({ inferGenders: () => ({}), castVoices: () => ({ narrator: 'reader', bySpeaker: new Map() }) }));
vi.mock('./engines', () => ({
  activeEngineKind: () => fixture.kind,
  engineFor: async () => {
    await fixture.engineGate;
    return { engine: { id: fixture.kind === 'system' ? 'native' : 'ai', kind: fixture.kind,
      label: 'Synthetic reader', speak: fixture.speak }, voices: [] };
  },
  NeedsProviderError: class extends Error {},
}));

const schema = new Schema({ nodes: {
  doc: { content: 'action+' }, action: { content: 'text*' }, text: {},
} });
const action = (text: string) => schema.nodes.action.create(null, schema.text(text));
const original = ['First line.', 'Second line.', 'Third line.'];
const targets = [
  { label: 'Next', start: 0, target: 1, text: original[1] },
  { label: 'Previous', start: 2, target: 1, text: original[1] },
  { label: 'direct line selection', start: 0, target: 2, text: original[2] },
];

describe('Table Read navigation through document edits', () => {
  let player: typeof import('./player');
  let store: typeof import('../../stores/tableReadStore').useTableReadStore;
  let state: EditorState;
  let editor: Editor;
  let listener: ((event: { transaction: Transaction }) => void) | undefined;
  let native: Record<string, unknown>;
  const starts = () => fixture.invoke.mock.calls.filter(([, args]) => args.request.action === 'start').map(([, args]) => args.request);
  const dispatch = (tr: Transaction) => { state = state.apply(tr); listener?.({ transaction: tr }); };
  const prepend = (text: string, remote = true) => {
    const tr = state.tr.insert(0, action(text));
    if (remote) tr.setMeta('y-sync$', { isChangeOrigin: true });
    dispatch(tr);
  };
  const jump = (label: string, target: number) => {
    if (label === 'Next') player.step(1);
    else if (label === 'Previous') player.step(-1);
    else player.jumpTo(target);
  };
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); fixture.kind = 'system'; fixture.engineGate = null;
    native = { status: 'idle' };
    fixture.invoke.mockReset().mockImplementation(async (_command, { request }) => {
      if (request.action === 'start') native = { status: 'playing', session: request.session,
        index: request.index, offset: request.offset, end: request.offset };
      if (request.action === 'jump') native = { ...native, index: request.index, offset: 0, end: 0 };
      if (request.action === 'pause') native = { ...native, status: 'paused' };
      if (request.action === 'play') native = { ...native, status: 'playing' };
      if (request.action === 'stop' || request.action === 'release') native = { ...native, status: 'idle' };
      return native;
    });
    fixture.speak.mockReset().mockImplementation((_text: string, options: SpeakOptions) => new Promise<void>(resolve => {
      if (options.signal.aborted) resolve();
      else options.signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI_INTERNALS__: { invoke: fixture.invoke } }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('navigator', { language: 'en' });
    state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, original.map(action)) });
    listener = undefined;
    editor = { get state() { return state; }, isDestroyed: false,
      on: (_name: string, callback: typeof listener) => { listener = callback; },
      off: () => { listener = undefined; }, view: { dispatch } } as unknown as Editor;
    player = await import('./player'); store = (await import('../../stores/tableReadStore')).useTableReadStore;
    player.prepare(editor);
    await vi.advanceTimersByTimeAsync(0);
  });
  afterEach(async () => {
    player.teardown(); await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it.each(targets)('honors the first native $label after a collaborator inserts a line', async ({ label, start, target, text }) => {
    player.play(editor, start);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    prepend('Inserted before.');
    expect(store.getState().status).toBe('playing');
    jump(label, target);
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    const request = starts()[1];
    expect(request.index).toBe(target + 1);
    expect(request.lines[request.index].text).toBe(text);
    expect(request.offset).toBe(0);
    expect(store.getState().current).toBe(target + 1);
  });

  it.each(targets)('honors the first foreground $label after a collaborator edit', async ({ label, start, target, text }) => {
    fixture.kind = 'ai';
    player.play(editor, start);
    await vi.waitFor(() => expect(fixture.speak).toHaveBeenCalledTimes(1));
    prepend('Inserted before.');
    jump(label, target);
    await vi.waitFor(() => expect(fixture.speak).toHaveBeenCalledTimes(2));
    expect(fixture.speak.mock.calls[1][0]).toBe(text);
    expect(store.getState()).toMatchObject({ status: 'playing', current: target + 1 });
  });

  it.each([true, false])('honors a paused target after edits (remote: %s)', async remote => {
    player.play(editor, 0);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    player.pause();
    await vi.waitFor(() => expect(native.status).toBe('paused'));
    prepend('Inserted before.', remote);
    player.jumpTo(2);
    expect(store.getState()).toMatchObject({ status: 'paused', current: 3 });
    player.resume();
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    expect(starts()[1].index).toBe(3);
    expect(starts()[1].lines[3].text).toBe(original[2]);
  });

  it('maps edits arriving both before and after a jump during voice loading', async () => {
    player.resetEngine();
    let ready = () => {};
    fixture.engineGate = new Promise<void>(resolve => { ready = resolve; });
    player.play(editor, 0);
    expect(store.getState().status).toBe('loading');
    prepend('First insertion.');
    player.jumpTo(2);
    prepend('Second insertion.');
    ready();
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    expect(starts()[0].index).toBe(4);
    expect(starts()[0].lines[4].text).toBe(original[2]);
  });

  it('resets the position mapping after rebuilding and retains native fast jumps', async () => {
    player.play(editor, 0);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    prepend('First insertion.');
    player.jumpTo(1);
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    player.step(1);
    await vi.waitFor(() => expect(store.getState().current).toBe(3));
    expect(starts()).toHaveLength(2);
    expect(fixture.invoke.mock.calls.some(([, args]) => args.request.action === 'jump' && args.request.index === 3)).toBe(true);
    prepend('Second insertion.');
    player.step(-1);
    await vi.waitFor(() => expect(starts()).toHaveLength(3));
    expect(starts()[2].index).toBe(3);
    expect(starts()[2].lines[3].text).toBe(original[1]);
  });

  it('starts Play from idle on the selected line after a collaborator edit', async () => {
    player.jumpTo(2);
    expect(store.getState()).toMatchObject({ status: 'idle', current: 2 });
    prepend('Inserted before.');
    player.play(editor, store.getState().current);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    expect(starts()[0].index).toBe(3);
    expect(starts()[0].lines[3].text).toBe(original[2]);
  });

  it('keeps its place when settings rebuild the lines after a collaborator edit', async () => {
    player.play(editor, 2);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    player.pause();
    await vi.waitFor(() => expect(native.status).toBe('paused'));
    prepend('Inserted before.');
    player.rebuild();
    const { lines, current } = store.getState();
    expect(current).toBe(3);
    expect(lines[current].spoken).toContain(original[2]);
  });

  it('stays on the last line, not the top, when the target line was deleted', async () => {
    player.play(editor, 2);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    player.pause();
    await vi.waitFor(() => expect(native.status).toBe('paused'));
    const last = state.doc.child(0).nodeSize + state.doc.child(1).nodeSize;
    dispatch(state.tr.delete(last, state.doc.content.size).setMeta('y-sync$', { isChangeOrigin: true }));
    player.jumpTo(2);
    const { lines, current } = store.getState();
    expect(lines).toHaveLength(2);
    expect(current).toBe(1);
  });

  it('stops cleanly when all speakable content was deleted before a jump', async () => {
    player.play(editor, 0);
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    dispatch(state.tr.delete(0, state.doc.content.size).setMeta('y-sync$', { isChangeOrigin: true }));
    player.jumpTo(1);
    await vi.waitFor(() => expect(store.getState()).toMatchObject({ status: 'idle', lines: [] }));
    expect(starts()).toHaveLength(1);
  });
});
