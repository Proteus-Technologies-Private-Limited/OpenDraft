import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => [{ label: 'main', title: 'Script' }, { label: 'main-2', title: 'Other' }, { label: 'panel-main-navigator-1', title: 'Navigator' }]) }));
import { claimOpenDocument, findWindowWithDocument, markDocumentShowing, scriptOpenAnywhere } from './openDocuments';
const key = 'opendraft:open-documents';
function windowLabel(label: string) { vi.stubGlobal('window', { __TAURI_INTERNALS__: { metadata: { currentWindow: { label } } } }); }
beforeEach(() => localStorage.removeItem(key));
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(key); });
it('never lets a panel claim a second copy of its owner document', () => {
  windowLabel('main'); claimOpenDocument('script:p/s', 'Script'); const before = localStorage.getItem(key);
  windowLabel('panel-main-navigator-1'); claimOpenDocument('script:p/s', 'Navigator');
  expect(localStorage.getItem(key)).toBe(before);
});
it('drops a stale panel claim without weakening the guard for real editor windows', async () => {
  windowLabel('main-2');
  localStorage.setItem(key, JSON.stringify([{ window: 'panel-main-navigator-1', key: 'script:p/s', title: 'Navigator', at: 1 }]));
  expect(await findWindowWithDocument('script:p/s')).toBeNull();
  localStorage.setItem(key, JSON.stringify([{ window: 'main', key: 'script:p/s', title: 'Script', at: 1 }]));
  expect(await findWindowWithDocument('script:p/s')).toEqual({ window: 'main', title: 'Script' });
});
it('counts a script as open here only while an editor shows it', async () => {
  windowLabel('main');
  expect(await scriptOpenAnywhere('p', 's')).toBe(false);
  const first = markDocumentShowing('p', 's');
  const second = markDocumentShowing('p', 's'); // the next editor mounts before the last unmounts
  expect(await scriptOpenAnywhere('p', 's')).toBe(true);
  first();
  first(); // releasing twice does not drop the other editor's mark
  expect(await scriptOpenAnywhere('p', 's')).toBe(true);
  second();
  expect(await scriptOpenAnywhere('p', 's')).toBe(false);
  expect(markDocumentShowing(null, null)).toBeTypeOf('function');
});
it('still counts a script open in another live window', async () => {
  windowLabel('main-2');
  localStorage.setItem(key, JSON.stringify([{ window: 'main', key: 'script:p/s', title: 'Script', at: 1 }]));
  expect(await scriptOpenAnywhere('p', 's')).toBe(true);
});
