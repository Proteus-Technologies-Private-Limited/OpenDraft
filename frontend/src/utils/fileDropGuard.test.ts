import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragCarriesFiles, installFileDropGuard } from './fileDropGuard';

function dragEvent(type: string, types: string[]): DragEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
  return e;
}

describe('fileDropGuard', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => { uninstall?.(); uninstall = null; vi.restoreAllMocks(); });

  it('recognises drags that carry files', () => {
    expect(dragCarriesFiles(dragEvent('dragover', ['Files']))).toBe(true);
    expect(dragCarriesFiles(dragEvent('dragover', ['text/plain']))).toBe(false);
    expect(dragCarriesFiles(new Event('dragover') as DragEvent)).toBe(false);
  });

  it('cancels an uncaught file drop so the web view cannot navigate to it', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const target = new EventTarget();
    uninstall = installFileDropGuard(target);
    const over = dragEvent('dragover', ['Files']);
    target.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer!.dropEffect).toBe('none');
    const drop = dragEvent('drop', ['Files']);
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('leaves a drop a real target already took, and its drop effect', () => {
    const target = new EventTarget();
    // A drop zone handled it earlier on the bubble path.
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'copy';
    });
    uninstall = installFileDropGuard(target);
    const over = dragEvent('dragover', ['Files']);
    target.dispatchEvent(over);
    expect(over.dataTransfer!.dropEffect).toBe('copy');
  });

  it('never touches drags without files', () => {
    const target = new EventTarget();
    uninstall = installFileDropGuard(target);
    const over = dragEvent('dragover', ['text/plain']);
    const drop = dragEvent('drop', ['text/plain']);
    target.dispatchEvent(over);
    target.dispatchEvent(drop);
    expect(over.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
  });

  it('removes its listeners when uninstalled', () => {
    const target = new EventTarget();
    installFileDropGuard(target)();
    const drop = dragEvent('drop', ['Files']);
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });
});
