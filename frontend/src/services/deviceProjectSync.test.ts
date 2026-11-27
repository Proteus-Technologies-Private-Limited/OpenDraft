import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outdatedMergeCopies } from '../utils/scriptMerge';

type Content = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body?: unknown, message?: string) {
      super(message ?? String(status));
      this.status = status;
      this.body = body;
    }
  }
  return {
    ApiError,
    settings: { autoMergeEdits: true, collabAuth: {} },
    // The device's SQLite copy, the cloud's copy and the stored merge base.
    device: { content: null as Content | null, updated_at: 'd1' },
    cloud: { content: null as Content | null, revision: 'r0', updated_at: 'c1' },
    base: null as Content | null,
    showingNow: vi.fn(() => false),
    openAnywhere: vi.fn(async () => false),
    windowWith: vi.fn(async () => null),
    getScript: vi.fn(),
    upload: vi.fn(),
    pull: vi.fn(),
    remember: vi.fn(async () => {}),
  };
});

const binding = {
  project_id: 'project', scope: 'scope', binding_id: 'binding', enabled: 1, generation: 'g1', published: 1, last_synced: 0,
};
const meta = (updated: string) => ({
  id: 'script', title: 'Pilot', author: '', format: 'screenplay', created_at: '', updated_at: updated,
  page_count: 0, size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
});

vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => mocks.settings, subscribe: vi.fn() },
}));
vi.mock('../stores/storageStatusStore', () => ({ useStorageStatusStore: { getState: () => ({ mode: 'sqlite' }) } }));
vi.mock('./platform', () => ({ isTauri: () => true }));
vi.mock('./offlineCloud', () => ({
  scopeForCloud: () => ({ key: 'scope', base: 'https://cloud.example.invalid', isCurrent: () => true }),
}));
vi.mock('./deviceProjectExtras', () => ({ syncProjectExtras: vi.fn(async () => 'synced') }));
vi.mock('./openDocuments', () => ({
  documentKey: (projectId: string, scriptId: string) => `script:${projectId}/${scriptId}`,
  findWindowWithDocument: mocks.windowWith,
  scriptOpenAnywhere: mocks.openAnywhere,
  scriptShowingNow: mocks.showingNow,
}));
vi.mock('./api', () => ({
  ApiError: mocks.ApiError,
  api: {
    getProject: vi.fn(async () => ({ id: 'project', name: 'Film', properties: { folder_path: '' } })),
    listScripts: vi.fn(async () => [meta(mocks.device.updated_at)]),
    createScript: vi.fn(async () => ({})),
    saveScript: vi.fn(async () => ({})),
  },
}));
vi.mock('./cloudApi', () => ({
  cloudApi: {
    listScripts: vi.fn(async () => [meta(mocks.cloud.updated_at)]),
    getScript: mocks.getScript,
    uploadOfflineScript: mocks.upload,
    ensureDeviceProject: vi.fn(),
    ensureDeviceScript: vi.fn(),
    saveScript: vi.fn(),
  },
}));
vi.mock('./deviceSyncStore', () => ({
  activeBindings: vi.fn(async () => [binding]),
  readBinding: vi.fn(async () => binding),
  updateBinding: vi.fn(async () => {}),
  projectHasLinkedScripts: vi.fn(async () => false),
  // A real base: this device and the cloud have both moved on from it.
  readScriptBases: vi.fn(async () => [{
    script_id: 'script', content_hash: 'base-hash', cloud_revision: 'r0', device_updated: 'd0', cloud_updated: 'c0',
    deleted: '', sending_hash: '', base_title: 'Pilot',
  }]),
  readScriptBaseContent: vi.fn(async () => mocks.base),
  readDeviceContent: vi.fn(async () => mocks.device.content && {
    raw: JSON.stringify(mocks.device.content), updated_at: mocks.device.updated_at, content: mocks.device.content,
  }),
  pullDeviceContent: mocks.pull,
  noteUploadHash: vi.fn(async () => {}),
  rememberScriptBase: mocks.remember,
  rememberBaseTitle: vi.fn(async () => {}),
  forgetScriptBase: vi.fn(async () => {}),
  tombstoneScript: vi.fn(async () => {}),
  enableBinding: vi.fn(), disableBinding: vi.fn(), restartBinding: vi.fn(),
}));

const doc = (...lines: string[]): Content => ({
  type: 'doc', content: lines.map(text => ({ type: 'action', content: [{ type: 'text', text }] })),
});
const lines = (content: unknown) => ((content as { content?: Array<{ content?: Array<{ text?: string }> }> })?.content ?? [])
  .map(block => block.content?.[0]?.text ?? '');
const remote = () => ({ meta: meta(mocks.cloud.updated_at), content: mocks.cloud.content, content_revision: mocks.cloud.revision });

let sync: typeof import('./deviceProjectSync');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  mocks.settings.autoMergeEdits = true;
  mocks.base = doc('one', 'two');
  mocks.device.content = doc('ONE', 'two');
  mocks.device.updated_at = 'd1';
  mocks.cloud.content = doc('one', 'TWO');
  mocks.cloud.revision = 'r1';
  mocks.cloud.updated_at = 'c1';
  mocks.showingNow.mockReset().mockReturnValue(false);
  mocks.openAnywhere.mockReset().mockResolvedValue(false);
  mocks.windowWith.mockReset().mockResolvedValue(null);
  mocks.remember.mockClear();
  mocks.getScript.mockReset().mockImplementation(async () => remote());
  mocks.upload.mockReset().mockImplementation(async (_project: string, _id: string, content: Content, revision: string) => {
    if (revision !== mocks.cloud.revision) throw new mocks.ApiError(412);
    mocks.cloud.content = content;
    mocks.cloud.revision = `${revision}+`;
    mocks.cloud.updated_at = 'c2';
    return remote();
  });
  // Writes only over the exact body read, and only while no editor shows it.
  mocks.pull.mockReset().mockImplementation(async (_binding: unknown, _meta: unknown, content: Content,
    original: { raw: string } | undefined, stillOpening: () => boolean = () => true) => {
    if (!stillOpening()) return false;
    if (original && original.raw !== JSON.stringify(mocks.device.content)) return false;
    mocks.device.content = content;
    mocks.device.updated_at = 'd2';
    return true;
  });
  vi.resetModules();
  sync = await import('./deviceProjectSync');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One background pass over the project. */
async function pass() {
  sync.wakeDeviceProjectSync();
  await vi.advanceTimersByTimeAsync(800);
}

describe('merging both sides in the background', () => {
  it('merges changes to different lines, writes the merge here and uploads it on the cloud revision', async () => {
    await pass();
    expect(lines(mocks.device.content)).toEqual(['ONE', 'TWO']);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.upload.mock.calls[0][3]).toBe('r1');
    expect(lines(mocks.cloud.content)).toEqual(['ONE', 'TWO']);
    expect(mocks.remember).toHaveBeenCalledWith(binding, expect.objectContaining({ cloud_revision: 'r1+' }), mocks.cloud.content);
    expect(sync.deviceSyncStatus('project')).toMatchObject({ state: 'synced', issues: [] });
  });

  it('leaves the screenplay for the writer when an editor opens it during the merge', async () => {
    mocks.openAnywhere.mockResolvedValue(false);
    mocks.showingNow.mockReturnValue(true); // opened after the first check
    await pass();
    expect(lines(mocks.device.content)).toEqual(['ONE', 'two']);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(sync.deviceSyncStatus('project')).toMatchObject({ state: 'conflict', issues: [{ id: 'script', kind: 'conflict' }] });
  });

  it('asks the writer about overlapping changes, and about any change when merging automatically is off', async () => {
    mocks.cloud.content = doc('one!', 'two');
    await pass();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(sync.deviceSyncStatus('project')?.state).toBe('conflict');

    vi.resetModules();
    sync = await import('./deviceProjectSync');
    mocks.cloud.content = doc('one', 'TWO');
    mocks.settings.autoMergeEdits = false;
    await pass();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(lines(mocks.device.content)).toEqual(['ONE', 'two']);
  });
});

describe('a merge built in the dialog', () => {
  it('is not saved when the cloud changed while the dialog was open, and comes back rebuilt', async () => {
    const opened = await sync.readDeviceSyncMerge('project', 'script');
    expect(opened.cloudRevision).toBe('r1');

    // Another device saves while the writer is choosing.
    mocks.cloud.content = doc('one', 'TWO', 'THREE');
    mocks.cloud.revision = 'r2';
    const failure = await sync.resolveDeviceSyncIssue('project', 'script', 'merged', doc('ONE', 'TWO'), opened.cloudRevision)
      .catch(error => error);
    expect(failure).toBeInstanceOf(sync.DeviceSyncMessage);
    expect(failure.message).toBe('toolbar:status.save.cloudChangedDuringMerge');
    expect(outdatedMergeCopies(failure)).toMatchObject({
      cloud: doc('one', 'TWO', 'THREE'), device: doc('ONE', 'two'), base: doc('one', 'two'), cloudRevision: 'r2',
    });
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();

    // Saved once rebuilt on r2, and on r2.
    await sync.resolveDeviceSyncIssue('project', 'script', 'merged', doc('ONE', 'TWO', 'THREE'), 'r2');
    expect(mocks.upload.mock.calls[0][3]).toBe('r2');
    expect(lines(mocks.device.content)).toEqual(['ONE', 'TWO', 'THREE']);
    expect(lines(mocks.cloud.content)).toEqual(['ONE', 'TWO', 'THREE']);
  });

  it('is not saved over an edit made on this device while the dialog was open', async () => {
    const opened = await sync.readDeviceSyncMerge('project', 'script');
    mocks.device.content = doc('ONE', 'two', 'typed meanwhile');
    const failure = await sync.resolveDeviceSyncIssue('project', 'script', 'merged', doc('ONE', 'TWO'), opened.cloudRevision)
      .catch(error => error);
    expect(outdatedMergeCopies(failure)?.device).toEqual(doc('ONE', 'two', 'typed meanwhile'));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(lines(mocks.device.content)).toEqual(['ONE', 'two', 'typed meanwhile']);
  });

  it('comes back rebuilt when the cloud moves between the check and the upload', async () => {
    const opened = await sync.readDeviceSyncMerge('project', 'script');
    mocks.upload.mockImplementationOnce(async () => {
      mocks.cloud.content = doc('one', 'TWO', 'late');
      mocks.cloud.revision = 'r2';
      throw new mocks.ApiError(412);
    });
    const failure = await sync.resolveDeviceSyncIssue('project', 'script', 'merged', doc('ONE', 'TWO'), opened.cloudRevision)
      .catch(error => error);
    expect(outdatedMergeCopies(failure)).toMatchObject({
      cloud: doc('one', 'TWO', 'late'), device: doc('ONE', 'TWO'), cloudRevision: 'r2',
    });
    // The merge stays on this device; nothing else is lost.
    expect(lines(mocks.device.content)).toEqual(['ONE', 'TWO']);
  });

  it('is saved on the revision it was built on when nothing moved', async () => {
    const opened = await sync.readDeviceSyncMerge('project', 'script');
    await sync.resolveDeviceSyncIssue('project', 'script', 'merged', doc('ONE', 'TWO'), opened.cloudRevision);
    expect(mocks.upload.mock.calls[0][3]).toBe('r1');
    expect(lines(mocks.cloud.content)).toEqual(['ONE', 'TWO']);
  });
});
