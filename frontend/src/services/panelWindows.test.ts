import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ listen: vi.fn(), desktop: true, label: 'main' as string | null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('./platform', () => ({ isDesktopTauri: () => native.desktop }));
vi.mock('./openDocuments', () => ({ currentWindowLabel: () => native.label }));
import { canPopOutNavigator, subscribePanel } from './panelWindows';
afterEach(() => { vi.clearAllMocks(); native.desktop = true; native.label = 'main'; });
describe('panel bridge lifecycle', () => {
  it('excludes browser/mobile/panel windows from the pop-out controls', () => {
    expect(canPopOutNavigator()).toBe(true);
    native.label = 'main-2'; expect(canPopOutNavigator()).toBe(true);
    native.label = 'panel-main-navigator-1'; expect(canPopOutNavigator()).toBe(false);
    native.label = null; expect(canPopOutNavigator()).toBe(false);
    native.label = 'main'; native.desktop = false; expect(canPopOutNavigator()).toBe(false);
  });
  it('unregisters a listener even when registration resolves after unmount', async () => {
    let ready!: (stop: () => void) => void;
    native.listen.mockReturnValueOnce(new Promise(resolve => { ready = resolve; }));
    const receive = vi.fn(), unlisten = vi.fn();
    const stop = subscribePanel('panel-snapshot', receive);
    stop(); ready(unlisten); await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
    native.listen.mock.calls[0][1]({ payload: 'late' });
    expect(receive).not.toHaveBeenCalled();
  });
  it('delivers payloads while active and stops on cleanup', async () => {
    const unlisten = vi.fn(), receive = vi.fn(); native.listen.mockResolvedValueOnce(unlisten);
    const stop = subscribePanel('panel-command', receive); await Promise.resolve();
    native.listen.mock.calls[0][1]({ payload: 'current' }); expect(receive).toHaveBeenCalledWith('current');
    stop(); native.listen.mock.calls[0][1]({ payload: 'late' }); expect(receive).toHaveBeenCalledTimes(1); expect(unlisten).toHaveBeenCalledOnce();
  });
});
