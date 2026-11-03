import { afterEach, expect, it, vi } from 'vitest';
import { recoverRejectedCollaboration } from './rejectedCollabRecovery';
const doc = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Unsynced local edits' }] }] };
afterEach(() => vi.useRealTimers());
it.each([true, false])('retains local edits after a refused reconnect (host=%s)', async isHost => {
  vi.useFakeTimers();
  const state = { projectId: 'project' as string | null, scriptId: 'script' as string | null, title: 'My screenplay', collaborating: true, unsaved: false, restored: null as unknown };
  const preserve = vi.fn(); const disconnect = vi.fn();
  recoverRejectedCollaboration({
    isHost, projectId: state.projectId, scriptId: state.scriptId, doc,
    preserve, disconnect, isCurrent: () => true,
    leave: () => { state.collaborating = false; },
    clearGuestProject: () => { state.projectId = null; state.scriptId = null; state.title = 'Untitled Screenplay'; },
    markUnsaved: () => { state.unsaved = true; },
    remount: () => { state.restored = preserve.mock.lastCall?.[0]; },
  });
  expect(disconnect).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(state).toEqual({ projectId: isHost ? 'project' : null, scriptId: isHost ? 'script' : null, title: isHost ? 'My screenplay' : 'Untitled Screenplay', collaborating: false, unsaved: true, restored: doc });
  expect(preserve).toHaveBeenCalledExactlyOnceWith(doc, isHost ? 'project' : null, isHost ? 'script' : null);
});
it('cannot tear down a replacement session when deferred recovery runs', async () => {
  vi.useFakeTimers(); const leave = vi.fn(); const remount = vi.fn();
  recoverRejectedCollaboration({ isHost: true, projectId: 'p', scriptId: 's', doc, preserve: vi.fn(), disconnect: vi.fn(), isCurrent: () => false, leave, clearGuestProject: vi.fn(), markUnsaved: vi.fn(), remount });
  await vi.runAllTimersAsync();
  expect(leave).not.toHaveBeenCalled(); expect(remount).not.toHaveBeenCalled();
});
