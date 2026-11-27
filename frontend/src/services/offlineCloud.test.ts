import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ScriptResponse } from './api';
import {
  offlineCloud, offlineCloudStatus, readOfflineCloudMerge, resolveOfflineCloudConflict, startOfflineCloudSync,
} from './offlineCloud';
import { outdatedMergeCopies } from '../utils/scriptMerge';
import type { OfflineScript } from './offlineCloudStore';

const mocks = vi.hoisted(() => {
  const auth = { accessToken: 'token', user: { id: 'writer' } };
  const state: { collabAuth: unknown; autoMergeEdits: boolean } = { collabAuth: auth, autoMergeEdits: true };
  return {
    state, subscribe: vi.fn(), toast: vi.fn(),
    getScript: vi.fn(), upload: vi.fn(), deleteScript: vi.fn(), deleteProject: vi.fn(),
    createScript: vi.fn(), persist: vi.fn(async () => true),
    edit: vi.fn(), read: vi.fn(), pending: vi.fn(), unresolved: vi.fn(),
    clear: vi.fn(), remove: vi.fn(), openAnywhere: vi.fn(async () => false), showingNow: vi.fn(() => false),
  };
});

vi.mock('../config', () => ({ getApiBase: () => 'https://cloud.example.invalid' }));
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => mocks.state, subscribe: mocks.subscribe },
}));
vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../components/Toast', () => ({ showToast: mocks.toast }));
vi.mock('./platform', () => ({ isTauri: () => true, platformFetch: vi.fn() }));
vi.mock('./cloudApi', () => ({
  cloudApi: {
    getScript: mocks.getScript, uploadOfflineScript: mocks.upload,
    deleteScript: mocks.deleteScript, deleteProject: mocks.deleteProject, createScript: mocks.createScript,
  },
}));
vi.mock('./openDocuments', () => ({ scriptOpenAnywhere: mocks.openAnywhere, scriptShowingNow: mocks.showingNow }));
vi.mock('./offlineCloudStore', () => ({
  readOfflineScript: mocks.read, editOfflineScript: mocks.edit,
  pendingOfflineScripts: mocks.pending, unresolvedOfflineScripts: mocks.unresolved,
  clearSyncedOfflineData: mocks.clear, removeOfflineScripts: mocks.remove,
  cacheOfflineCatalog: vi.fn(async () => {}), readOfflineCatalog: vi.fn(async () => undefined),
}));

const scope = JSON.stringify(['https://cloud.example.invalid', 'writer']);
const projectId = 'project';
const scriptId = 'script';
const key = [scope, projectId, scriptId];
const body = (text: string) => ({
  type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text }] }],
});
const response = (text: string, revision: string): ScriptResponse => ({
  meta: { id: scriptId, title: 'Test screenplay', author: '', format: 'json', created_at: '', updated_at: '',
    page_count: 0, size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '' },
  content: body(text), content_revision: revision,
});
const rows = new Map<string, OfflineScript>();
const row = () => rows.get(JSON.stringify(key));
const save = (text: string) => offlineCloud.saveScript(projectId, scriptId, body(text));
const drain = () => vi.advanceTimersByTimeAsync(0);
const fail = (status: number, detail?: object) => new ApiError(status, detail, String(status));

function changeAccount(id?: string) {
  const previous = { ...mocks.state };
  mocks.state.collabAuth = id ? { accessToken: 'token', user: { id } }
    : { accessToken: '', user: { id: '' } };
  const listener = mocks.subscribe.mock.calls[0][0];
  listener(mocks.state, previous);
}

beforeAll(() => {
  vi.stubGlobal('navigator', { onLine: true, storage: { persist: mocks.persist } });
  vi.useFakeTimers();
  startOfflineCloudSync();
  vi.useRealTimers();
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.useFakeTimers();
  rows.clear();
  mocks.state.collabAuth = { accessToken: 'token', user: { id: 'writer' } };
  mocks.state.autoMergeEdits = true;
  mocks.upload.mockReset();
  mocks.getScript.mockReset().mockResolvedValue(response('original', 'r0'));
  mocks.toast.mockClear();
  mocks.createScript.mockReset().mockResolvedValue(response('copy', 'copy'));
  mocks.openAnywhere.mockReset().mockResolvedValue(false);
  mocks.showingNow.mockReset().mockReturnValue(false);
  mocks.read.mockReset().mockImplementation(async key => rows.get(JSON.stringify(key)));
  mocks.edit.mockReset().mockImplementation(async (key, change) => {
    const id = JSON.stringify(key);
    const next = change(rows.get(id));
    if (next) rows.set(id, next);
    else rows.delete(id);
    return next;
  });
  mocks.pending.mockImplementation(async scope => [...rows.values()].filter(row => row.scope === scope && row.state === 'pending'));
  mocks.unresolved.mockImplementation(async scope => [...rows.values()].filter(row => row.scope === scope && row.state !== 'synced')
    .map(row => [row.scope, row.projectId, row.scriptId]));
  mocks.clear.mockClear().mockImplementation(async scope => {
    for (const [id, row] of rows) if (row.scope === scope && row.state === 'synced') rows.delete(id);
    return [...rows.values()].some(row => row.scope === scope);
  });
  mocks.remove.mockClear().mockImplementation(async (scope, pid, sid) => {
    for (const [id, row] of rows) {
      if (row.scope === scope && row.projectId === pid && (!sid || row.scriptId === sid)) rows.delete(id);
    }
  });
  mocks.deleteScript.mockReset().mockResolvedValue({ message: 'deleted' });
  mocks.deleteProject.mockReset().mockResolvedValue({ message: 'deleted' });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('offline cloud uploads', () => {
  it('acknowledges an earlier upload without losing a newer edit', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockImplementationOnce(async () => {
      await save('second edit');
      return response('first edit', 'r1');
    }).mockResolvedValueOnce(response('second edit', 'r2'));
    await save('first edit');
    expect(mocks.persist).toHaveBeenCalledOnce();
    await drain();
    expect(row()).toMatchObject({ revision: 'r1', state: 'pending', script: { content: body('second edit') } });
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.upload.mock.calls.map(([, , content, revision]) => [content, revision])).toEqual([
      [body('first edit'), 'r0'], [body('second edit'), 'r1'],
    ]);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2' });
  });

  it('retries the exact in-flight body after a lost acknowledgment', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockImplementationOnce(async () => {
      await save('second edit');
      throw new Error('Response lost after commit');
    }).mockResolvedValueOnce(response('first edit', 'r1'))
      .mockResolvedValueOnce(response('second edit', 'r2'));
    await save('first edit');
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.upload.mock.calls.map(([, , content, revision]) => [content, revision])).toEqual([
      [body('first edit'), 'r0'], [body('first edit'), 'r0'], [body('second edit'), 'r1'],
    ]);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2', inFlight: undefined });
  });

  it('retains newer edits on 412 and can explicitly upload them against the current cloud revision', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockImplementationOnce(async () => {
      await save('latest device edit');
      throw fail(412);
    });
    await save('device edit');
    await vi.advanceTimersByTimeAsync(10);
    expect(row()).toMatchObject({ state: 'conflict', script: { content: body('latest device edit') } });
    mocks.getScript.mockResolvedValueOnce(response('other device', 'r1'));
    mocks.upload.mockResolvedValueOnce(response('latest device edit', 'r2'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'device');
    await drain();
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([body('latest device edit'), 'r1']);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2' });
  });

  it('can replace a conflict copy from the cloud or remove one deleted remotely', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    await save('local');
    await drain();
    mocks.getScript.mockResolvedValueOnce(response('cloud', 'r1'));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'cloud')).resolves.toBe('resolved');
    expect(row()).toMatchObject({ state: 'synced', script: { content: body('cloud') } });

    mocks.upload.mockRejectedValueOnce(fail(404, { detail: { code: 'offline_script_missing' } }));
    await save('local again');
    await drain();
    expect(row()?.state).toBe('conflict');
    mocks.getScript.mockRejectedValueOnce(fail(404));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'cloud')).resolves.toBe('removed');
    expect(row()).toBeUndefined();
    expect(offlineCloudStatus(projectId, scriptId)).toBeNull();
  });

  it('names a deleted cloud script instead of a generic problem when the device copy is uploaded', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(404, { detail: { code: 'offline_script_missing' } }));
    await save('local');
    await drain();
    expect(row()?.state).toBe('conflict');
    mocks.getScript.mockRejectedValueOnce(fail(404));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'device'))
      .rejects.toThrow('toolbar:status.save.cloudDeleted');
    expect(row()).toMatchObject({ state: 'conflict', script: { content: body('local') } });
  });

  it('keeps an autosave that lands while a conflict is being resolved', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    await save('device edit');
    await drain();
    mocks.getScript.mockImplementationOnce(async () => {
      await save('typed during the fetch');
      return response('other device', 'r1');
    });
    mocks.upload.mockResolvedValueOnce(response('typed during the fetch', 'r2'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'device', body('device edit'));
    await drain();
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([body('typed during the fetch'), 'r1']);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2' });
  });

  it('lets a rejected upload be resolved with either choice', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(422));
    await save('refused');
    await drain();
    expect(row()?.state).toBe('problem');
    mocks.getScript.mockResolvedValueOnce(response('cloud', 'r1'));
    mocks.upload.mockResolvedValueOnce(response('refused', 'r2'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'device');
    await drain();
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2' });

    mocks.upload.mockRejectedValueOnce(fail(422));
    await save('refused again');
    await drain();
    expect(row()?.state).toBe('problem');
    mocks.getScript.mockResolvedValueOnce(response('cloud again', 'r3'));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'cloud')).resolves.toBe('resolved');
    expect(row()).toMatchObject({ state: 'synced', script: { content: body('cloud again') } });
  });

  it('keeps the queue retryable when the upload endpoint is absent but the script exists', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(404, { detail: 'Not Found' }));
    await save('queued');
    await drain();
    expect(mocks.getScript).toHaveBeenCalledTimes(2);
    expect(row()).toMatchObject({ state: 'pending', inFlight: { content: body('queued') } });
  });

  it('retains unsynced rows on account change and ignores an old response after switching back', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    await offlineCloud.getScript(projectId, 'download-only');
    mocks.upload.mockImplementationOnce(async () => {
      changeAccount('another');
      changeAccount('writer');
      return response('queued', 'r1');
    }).mockResolvedValueOnce(response('queued', 'r1'));
    await save('queued');
    await drain();
    expect(mocks.clear).toHaveBeenCalledWith(scope);
    expect(await mocks.read([scope, projectId, 'download-only'])).toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith('toolbar:status.save.cloudSignOutPending', 'info');
    expect(row()).toMatchObject({ state: 'pending', revision: 'r0' });
    await vi.advanceTimersByTimeAsync(1);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r1' });
  });

  it('merges non-overlapping cloud changes after a 412 and uploads the merge', async () => {
    const two = (a: string, b: string) => ({ type: 'doc', content: [
      { type: 'action', content: [{ type: 'text', text: a }] },
      { type: 'action', content: [{ type: 'text', text: b }] },
    ] });
    const withContent = (content: object, revision: string) => ({ ...response('', revision), content });
    mocks.getScript.mockResolvedValueOnce(withContent(two('one', 'two'), 'r0'));
    await offlineCloud.getScript(projectId, scriptId);
    expect(row()?.base).toEqual(two('one', 'two'));
    mocks.upload.mockRejectedValueOnce(fail(412)).mockResolvedValueOnce(withContent(two('ONE', 'TWO'), 'r2'));
    mocks.getScript.mockResolvedValueOnce(withContent(two('one', 'TWO'), 'r1'));
    await offlineCloud.saveScript(projectId, scriptId, two('ONE', 'two'));
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([two('ONE', 'TWO'), 'r1']);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2', base: two('ONE', 'TWO') });
  });

  it('leaves an overlapping or open script as a conflict for the writer', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    expect(row()?.state).toBe('conflict');

    rows.clear();
    await offlineCloud.getScript(projectId, scriptId);
    mocks.openAnywhere.mockResolvedValue(true);
    mocks.upload.mockRejectedValueOnce(fail(412));
    await save('device edit');
    await drain();
    expect(row()?.state).toBe('conflict');
  });

  it('leaves even a non-overlapping change for review when automatic merging is off', async () => {
    const two = (a: string, b: string) => ({ type: 'doc', content: [
      { type: 'action', content: [{ type: 'text', text: a }] },
      { type: 'action', content: [{ type: 'text', text: b }] },
    ] });
    const withContent = (content: object, revision: string) => ({ ...response('', revision), content });
    mocks.state.autoMergeEdits = false;
    mocks.getScript.mockResolvedValueOnce(withContent(two('one', 'two'), 'r0'));
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(withContent(two('one', 'TWO'), 'r1'));
    await offlineCloud.saveScript(projectId, scriptId, two('ONE', 'two'));
    await drain();
    expect(row()?.state).toBe('conflict');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('uploads a merge built in the dialog on the current cloud revision', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await readOfflineCloudMerge(projectId, scriptId);
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    mocks.upload.mockResolvedValueOnce(response('merged', 'r2'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'merged', body('merged'));
    await drain();
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([body('merged'), 'r1']);
    expect(mocks.createScript).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ state: 'synced', revision: 'r2' });
  });

  it('saves the losing side as a copy when one whole version is kept', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'cloud');
    expect(mocks.createScript).toHaveBeenCalledWith(projectId,
      expect.objectContaining({ title: 'Test screenplay (device copy)', content: body('device edit') }), expect.anything());
  });

  it('removes cached rows after an explicit script or project deletion', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    await save('queued');
    await offlineCloud.deleteScript(projectId, scriptId);
    expect(row()).toBeUndefined();
    expect(mocks.remove).toHaveBeenCalledWith(scope, projectId, scriptId);

    await offlineCloud.getScript(projectId, scriptId);
    await save('queued again');
    mocks.deleteProject.mockRejectedValueOnce(fail(404));
    await offlineCloud.deleteProject(projectId);
    expect(row()).toBeUndefined();
    expect(mocks.remove).toHaveBeenCalledWith(scope, projectId, undefined);
  });

  it('opens and saves online with a revision when device storage cannot cache a download', async () => {
    mocks.edit.mockRejectedValue(new Error('Storage full'));
    await expect(offlineCloud.getScript(projectId, scriptId)).resolves.toMatchObject({ content_revision: 'r0' });
    mocks.upload.mockResolvedValueOnce(response('online edit', 'r1'));
    await expect(save('online edit')).resolves.toMatchObject({ content_revision: 'r1' });
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([body('online edit'), 'r0']);
  });

  it('duplicates the queued device content rather than the older cloud body', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    await save('queued copy');
    mocks.createScript.mockResolvedValueOnce(response('queued copy', 'new'));
    await offlineCloud.duplicateScript(projectId, scriptId);
    expect(mocks.createScript).toHaveBeenCalledWith(projectId, {
      title: 'Test screenplay (copy)', content: body('queued copy'), format: 'json',
    }, expect.objectContaining({ key: scope }));
    expect(mocks.getScript).toHaveBeenCalledOnce();
  });
  it('does not upload a merge when the cloud changed while the dialog was open, and rebuilds it', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    expect(row()?.state).toBe('conflict');
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    const opened = await readOfflineCloudMerge(projectId, scriptId);
    expect(opened.cloudRevision).toBe('r1');
    const uploads = mocks.upload.mock.calls.length;

    // Another device saves r2 while the writer is choosing.
    mocks.getScript.mockResolvedValueOnce(response('another device', 'r2'));
    const failure = await resolveOfflineCloudConflict(projectId, scriptId, 'merged', body('merged on r1'), opened.cloudRevision)
      .catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe('toolbar:status.save.cloudChangedDuringMerge');
    expect(outdatedMergeCopies(failure)).toMatchObject({ cloud: body('another device'), cloudRevision: 'r2', base: body('original') });
    await drain();
    expect(mocks.upload.mock.calls.length).toBe(uploads);
    expect(row()).toMatchObject({ state: 'conflict', script: { content: body('device edit') } });

    // The merge rebuilt on r2 goes up on r2.
    mocks.getScript.mockResolvedValueOnce(response('another device', 'r2'));
    mocks.upload.mockResolvedValueOnce(response('merged on r2', 'r3'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'merged', body('merged on r2'), 'r2');
    await drain();
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([body('merged on r2'), 'r2']);
    expect(row()).toMatchObject({ state: 'synced', revision: 'r3' });
  });

  it('also catches a cloud change when the caller does not pass the revision back', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await readOfflineCloudMerge(projectId, scriptId);
    mocks.getScript.mockResolvedValueOnce(response('another device', 'r2'));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'merged', body('merged')))
      .rejects.toThrow('toolbar:status.save.cloudChangedDuringMerge');
    // The rebuilt merge is on r2 now.
    mocks.getScript.mockResolvedValueOnce(response('another device', 'r2'));
    mocks.upload.mockResolvedValueOnce(response('merged', 'r3'));
    await resolveOfflineCloudConflict(projectId, scriptId, 'merged', body('merged'));
    await drain();
    expect(mocks.upload.mock.lastCall?.slice(2, 4)).toEqual([body('merged'), 'r2']);
  });

  it('explains a full plan instead of failing when the losing version cannot be kept as a copy', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    mocks.createScript.mockRejectedValueOnce(fail(402));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'cloud'))
      .rejects.toThrow('toolbar:status.save.cloudCopyQuotaDevice');
    expect(row()).toMatchObject({ state: 'conflict', script: { content: body('device edit') } });

    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    mocks.createScript.mockRejectedValueOnce(fail(402));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'device'))
      .rejects.toThrow('toolbar:status.save.cloudCopyQuotaCloud');
    expect(row()).toMatchObject({ state: 'conflict', script: { content: body('device edit') } });
  });

  it('does not save the kept copy twice when a retry follows a failed step', async () => {
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await save('device edit');
    await drain();
    const store = mocks.edit.getMockImplementation()!;
    mocks.createScript.mockImplementationOnce(async () => {
      // The copy is saved; recording it works; the final write then fails.
      mocks.edit.mockImplementationOnce(store).mockImplementationOnce(async () => { throw new Error('Storage full'); });
      return response('device edit', 'copy');
    });
    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'cloud')).rejects.toThrow('Storage full');
    expect(row()).toMatchObject({ state: 'conflict', keptCopy: { choice: 'cloud' } });

    mocks.getScript.mockResolvedValueOnce(response('cloud edit', 'r1'));
    await expect(resolveOfflineCloudConflict(projectId, scriptId, 'cloud')).resolves.toBe('resolved');
    expect(mocks.createScript).toHaveBeenCalledOnce();
    expect(row()).toMatchObject({ state: 'synced', script: { content: body('cloud edit') } });
    expect(row()?.keptCopy).toBeUndefined();
  });

  it('leaves a background merge for the writer when the script is opened while the cloud copy is fetched', async () => {
    const two = (a: string, b: string) => ({ type: 'doc', content: [
      { type: 'action', content: [{ type: 'text', text: a }] },
      { type: 'action', content: [{ type: 'text', text: b }] },
    ] });
    const withContent = (content: object, revision: string) => ({ ...response('', revision), content });
    mocks.getScript.mockResolvedValueOnce(withContent(two('one', 'two'), 'r0'));
    await offlineCloud.getScript(projectId, scriptId);
    mocks.upload.mockRejectedValueOnce(fail(412));
    mocks.getScript.mockImplementationOnce(async () => {
      mocks.showingNow.mockReturnValue(true); // an editor mounts mid-fetch
      return withContent(two('one', 'TWO'), 'r1');
    });
    await offlineCloud.saveScript(projectId, scriptId, two('ONE', 'two'));
    await drain();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({ state: 'conflict', revision: 'r0', script: { content: two('ONE', 'two') } });
  });
});
