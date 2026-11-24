import { describe, expect, it } from 'vitest';
import { addToast, withoutErrors, type QueuedToast } from './toastQueue';

const toast = (id: number, text: string, type: QueuedToast['type'] = 'error'): QueuedToast => ({ id, text, type });

describe('toast stack', () => {
  it('shows a repeated message once, as the newest', () => {
    const list = addToast(addToast(addToast([], toast(1, 'Failed to load')), toast(2, 'Saved', 'success')), toast(3, 'Failed to load'));
    expect(list.map(item => item.id)).toEqual([2, 3]);
  });

  it('keeps different messages, and the same text with a different kind', () => {
    const list = addToast(addToast([], toast(1, 'Offline', 'info')), toast(2, 'Offline', 'error'));
    expect(list).toHaveLength(2);
  });

  it('drops errors but keeps other feedback when the account changes', () => {
    const list = [toast(1, 'Network is unreachable'), toast(2, 'Signed out', 'success'), toast(3, 'Unsynced edits remain', 'info')];
    expect(withoutErrors(list).map(item => item.id)).toEqual([2, 3]);
  });
});
