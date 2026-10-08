/**
 * Scripts saved to files on disk (issue #135) — the behaviour that protects the
 * writer's work.
 *
 * Runs the real service against three fakes: the two SQLite tables it owns, a
 * filesystem behind the Tauri commands, and the library API. What is pinned
 * down: files follow the scripts (create, rename, move, delete), a file changed
 * elsewhere is never overwritten silently, whichever copy loses a conflict is
 * kept, and a drive that goes away costs nothing but a retry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// ── Fake filesystem behind the Tauri commands ──────────────────────────────

interface FakeFile { text: string; mtime: number }
const fs = {
  files: new Map<string, FakeFile>(),
  dirs: new Set<string>(),
  offline: new Set<string>(),
  clock: 1000,
};

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

function checkOnline(path: string): void {
  for (const root of fs.offline) {
    if (path === root || path.startsWith(`${root}/`)) throw new Error(`${path}: network path not found`);
  }
}

function touch(path: string, text: string): void {
  fs.clock += 10;
  fs.files.set(path, { text, mtime: fs.clock });
  fs.dirs.add(dirOf(path));
}

const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const path = args.path as string;
  switch (cmd) {
    case 'stat_path': {
      checkOnline(path);
      const f = fs.files.get(path);
      if (f) return { exists: true, is_dir: false, size: f.text.length, modified_ms: f.mtime };
      if (fs.dirs.has(path)) return { exists: true, is_dir: true, size: 0, modified_ms: 0 };
      return { exists: false, is_dir: false, size: 0, modified_ms: 0 };
    }
    case 'read_text_path': {
      checkOnline(path);
      const f = fs.files.get(path);
      if (!f) throw new Error(`Failed to read ${path}`);
      return f.text;
    }
    case 'save_text_atomic':
      checkOnline(path);
      touch(path, args.contents as string);
      return null;
    case 'list_dir_entries':
      checkOnline(path);
      return [...fs.files.entries()]
        .filter(([p]) => dirOf(p) === path)
        .map(([p, f]) => ({ name: p.slice(path.length + 1), path: p, is_dir: false, size: f.text.length, modified_ms: f.mtime }));
    case 'ensure_dir':
      checkOnline(path);
      fs.dirs.add(path);
      return null;
    case 'probe_directory':
      checkOnline(path);
      return { exists: fs.dirs.has(path), is_dir: true, writable: true, error: null };
    case 'rename_path': {
      const from = args.from as string;
      const to = args.to as string;
      checkOnline(from);
      const f = fs.files.get(from);
      if (!f) throw new Error('missing');
      if (fs.files.has(to)) throw new Error('exists');
      fs.files.delete(from);
      fs.files.set(to, f);
      return null;
    }
    case 'delete_file':
      checkOnline(path);
      fs.files.delete(path);
      return null;
    default:
      throw new Error(`unexpected command ${cmd}`);
  }
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

// ── Fake SQLite: only the two tables the service owns ───────────────────────

interface Row {
  script_id: string; project_id: string; path: string; format: string;
  synced_hash: string; synced_mtime: number; pending: number; last_error: string;
}
const tables = {
  links: new Map<string, Row>(),
  ignores: new Set<string>(),
};

const fakeDb = {
  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const q = sql.replace(/\s+/g, ' ').trim();
    const all = [...tables.links.values()].map((r) => ({ ...r }));
    if (q === 'SELECT * FROM script_files WHERE script_id = $1') return all.filter((r) => r.script_id === params[0]) as T;
    if (q === 'SELECT * FROM script_files WHERE project_id = $1') return all.filter((r) => r.project_id === params[0]) as T;
    if (q === 'SELECT * FROM script_files WHERE pending = 1') return all.filter((r) => r.pending === 1) as T;
    if (q === 'SELECT * FROM script_files') return all as T;
    if (q === 'SELECT path FROM script_files') return all.map((r) => ({ path: r.path })) as T;
    if (q === 'SELECT name FROM project_folder_ignores WHERE project_id = $1') {
      return [...tables.ignores].filter((k) => k.startsWith(`${params[0]}|`)).map((k) => ({ name: k.split('|')[1] })) as T;
    }
    throw new Error(`unexpected select: ${q}`);
  },
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('INSERT INTO script_files')) {
      const [script_id, project_id, path, format, synced_hash, synced_mtime, pending, last_error] = params as [string, string, string, string, string, number, number, string];
      tables.links.set(script_id, { script_id, project_id, path, format, synced_hash, synced_mtime, pending, last_error });
      return;
    }
    if (q === 'DELETE FROM script_files WHERE script_id = $1') { tables.links.delete(params[0] as string); return; }
    if (q === 'DELETE FROM script_files WHERE project_id = $1') {
      for (const [k, r] of tables.links) if (r.project_id === params[0]) tables.links.delete(k);
      return;
    }
    if (q.startsWith('INSERT OR IGNORE INTO project_folder_ignores')) { tables.ignores.add(`${params[0]}|${params[1]}`); return; }
    if (q === 'DELETE FROM project_folder_ignores WHERE project_id = $1 AND name = $2') { tables.ignores.delete(`${params[0]}|${params[1]}`); return; }
    if (q === 'DELETE FROM project_folder_ignores WHERE project_id = $1') {
      for (const k of [...tables.ignores]) if (k.startsWith(`${params[0]}|`)) tables.ignores.delete(k);
      return;
    }
    throw new Error(`unexpected execute: ${q}`);
  },
};

vi.mock('./db', () => ({
  getDb: async () => fakeDb,
  simpleHash: async (s: string) => createHash('sha256').update(s).digest('hex'),
}));

// ── Fake library ────────────────────────────────────────────────────────────

interface FakeScript { projectId: string; title: string; format: string; content: Record<string, unknown> | null }
const lib = {
  projects: new Map<string, { id: string; name: string; properties: Record<string, unknown> }>(),
  scripts: new Map<string, FakeScript>(),
  checkins: [] as string[],
  nextId: 1,
};

function meta(id: string, s: FakeScript) {
  return {
    id, title: s.title, author: '', format: s.format, created_at: '', updated_at: '',
    page_count: 0, size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
  };
}

const fakeApi = {
  async getProject(id: string) {
    const p = lib.projects.get(id);
    if (!p) throw new Error('no project');
    return { ...p, properties: { ...p.properties }, created_at: '', updated_at: '', color: '', pinned: false, sort_order: 0 };
  },
  async updateProject(id: string, data: { properties?: Record<string, unknown> }) {
    const p = lib.projects.get(id)!;
    if (data.properties) p.properties = { ...p.properties, ...data.properties };
    return fakeApi.getProject(id);
  },
  async createProject(name: string) {
    const id = `p${lib.nextId++}`;
    lib.projects.set(id, { id, name, properties: {} });
    return fakeApi.getProject(id);
  },
  async deleteProject(id: string) { lib.projects.delete(id); return { message: 'deleted' }; },
  async listScripts(projectId: string) {
    return [...lib.scripts.entries()].filter(([, s]) => s.projectId === projectId).map(([id, s]) => meta(id, s));
  },
  async getScript(projectId: string, scriptId: string) {
    const s = lib.scripts.get(scriptId);
    if (!s || s.projectId !== projectId) throw new Error('no script');
    return { meta: meta(scriptId, s), content: s.content };
  },
  async saveScript(_projectId: string, scriptId: string, data: { title?: string; content?: Record<string, unknown> }) {
    const s = lib.scripts.get(scriptId)!;
    if (data.title !== undefined) s.title = data.title;
    if (data.content !== undefined) s.content = data.content;
    return { meta: meta(scriptId, s), content: s.content };
  },
  async createScript(projectId: string, data: { title: string; content?: Record<string, unknown>; format?: string }) {
    const id = `s${lib.nextId++}`;
    lib.scripts.set(id, { projectId, title: data.title, format: data.format ?? 'screenplay', content: data.content ?? null });
    return { meta: meta(id, lib.scripts.get(id)!), content: data.content ?? null };
  },
  async checkin(_projectId: string, message: string) { lib.checkins.push(message); return {}; },
};

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), api: fakeApi }));
vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<object>()), isDesktopTauri: () => true }));

const lf = await import('./linkedFiles');
const { useLinkedFileStore } = await import('../stores/linkedFileStore');

// ── Helpers ─────────────────────────────────────────────────────────────────

const FOLDER = '/raid/MyFilm/scripts';

function doc(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
      { type: 'action', content: [{ type: 'text', text }] },
    ],
    ...extra,
  };
}

async function folderProject(format = 'odraft'): Promise<string> {
  const p = await fakeApi.createProject('My Film');
  fs.dirs.add(FOLDER);
  await lf.attachProjectFolder(p.id, FOLDER, format as 'odraft');
  return p.id;
}

/** Create a script the way the local storage layer does: insert, then the hook. */
async function newScript(projectId: string, title: string, content: Record<string, unknown>) {
  const created = await fakeApi.createScript(projectId, { title, content });
  await lf.afterScriptCreated(projectId, { id: created.meta.id, title, format: 'screenplay', content });
  return created.meta.id;
}

/** Save the way the local storage layer does: write, then the hook. */
async function save(projectId: string, scriptId: string, data: { title?: string; content?: Record<string, unknown> }) {
  const before = lib.scripts.get(scriptId)!.title;
  const res = await fakeApi.saveScript(projectId, scriptId, data);
  await lf.afterScriptSaved(projectId, scriptId, {
    title: res.meta.title,
    titleChanged: res.meta.title !== before,
    contentChanged: data.content !== undefined,
    content: res.content,
  });
}

/** Answer the next question asked; dropped after each test so none leaks into the next. */
const pendingAnswers: Array<() => void> = [];
function answerNextConflict(choice: 'file' | 'library'): void {
  const unsub = useLinkedFileStore.subscribe((s) => {
    if (s.conflict) {
      unsub();
      queueMicrotask(() => useLinkedFileStore.getState().answerConflict(choice));
    }
  });
  pendingAnswers.push(unsub);
}

beforeEach(() => {
  while (pendingAnswers.length) pendingAnswers.pop()!();
  fs.files.clear(); fs.dirs.clear(); fs.offline.clear();
  tables.links.clear(); tables.ignores.clear();
  lib.projects.clear(); lib.scripts.clear(); lib.checkins = [];
  useLinkedFileStore.setState({ byScript: {}, conflict: null, openScriptFile: null });
  invoke.mockClear();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('a project kept in a folder', () => {
  it('gives each new script a file of its own, never reusing a name', async () => {
    const pid = await folderProject('fountain');
    const a = await newScript(pid, 'Pilot', doc('one'));
    const b = await newScript(pid, 'Pilot', doc('two'));
    expect((await lf.getLink(a))?.path).toBe(`${FOLDER}/Pilot.fountain`);
    expect((await lf.getLink(b))?.path).toBe(`${FOLDER}/Pilot 2.fountain`);
    expect(fs.files.get(`${FOLDER}/Pilot.fountain`)?.text).toContain('one');
  });

  it('writes every save to the file, and follows a rename', async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('draft one'));
    await save(pid, id, { content: doc('draft two') });
    expect(fs.files.get(`${FOLDER}/Pilot.odraft`)?.text).toContain('draft two');

    await save(pid, id, { title: 'Episode 1' });
    expect(fs.files.has(`${FOLDER}/Pilot.odraft`)).toBe(false);
    expect(fs.files.get(`${FOLDER}/Episode 1.odraft`)?.text).toContain('draft two');
    expect((await lf.getLink(id))?.path).toBe(`${FOLDER}/Episode 1.odraft`);
  });

  it('does not reformat a file a save leaves unchanged — opening a script must not touch it', async () => {
    const pid = await folderProject('fountain');
    const original = 'Title: Cave\nAuthor: Someone\n\nINT. CAVE - NIGHT\n\nDark.\n';
    touch(`${FOLDER}/Cave.fountain`, original);
    await lf.scanProjectFolder(pid);
    const [cave] = await fakeApi.listScripts(pid);

    // The editor's first save after opening: the same script, re-stored.
    await save(pid, cave.id, { content: structuredClone(lib.scripts.get(cave.id)!.content!) });
    expect(fs.files.get(`${FOLDER}/Cave.fountain`)?.text).toBe(original);

    // A real edit is written.
    const edited = structuredClone(lib.scripts.get(cave.id)!.content) as { content: Array<Record<string, unknown>> };
    edited.content.push({ type: 'action', content: [{ type: 'text', text: 'Water drips.' }] });
    await save(pid, cave.id, { content: edited });
    expect(fs.files.get(`${FOLDER}/Cave.fountain`)?.text).toContain('Water drips.');
  });

  it('adds files dropped into the folder, but not one the writer removed from the project', async () => {
    const pid = await folderProject();
    touch(`${FOLDER}/Found.fountain`, 'INT. CAVE - NIGHT\n\nDark.\n');
    const scan = await lf.scanProjectFolder(pid);
    expect(scan.added).toBe(1);
    const [found] = await fakeApi.listScripts(pid);
    expect(found.title).toBe('Found');

    // Deleted from the project, kept on disk: the next scan leaves it alone.
    lib.scripts.delete(found.id);
    await lf.afterScriptDeleted(pid, found.id);
    expect((await lf.scanProjectFolder(pid)).added).toBe(0);
    expect(fs.files.has(`${FOLDER}/Found.fountain`)).toBe(true);
  });

  it('moves files to a new folder, removing each old one only once the new one is written', async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('words'));
    const result = await lf.moveProjectFolder(pid, '/nas/MyFilm');
    expect(result).toEqual({ moved: 1, failed: [] });
    expect(fs.files.has(`${FOLDER}/Pilot.odraft`)).toBe(false);
    expect(fs.files.get('/nas/MyFilm/Pilot.odraft')?.text).toContain('words');
    expect((await lf.getLink(id))?.path).toBe('/nas/MyFilm/Pilot.odraft');
    expect(lib.projects.get(pid)?.properties.folder_path).toBe('/nas/MyFilm');
  });

  it('leaves the files on disk when the project goes back to the library', async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('words'));
    await lf.detachProjectFolder(pid);
    expect(await lf.getLink(id)).toBeNull();
    expect(fs.files.has(`${FOLDER}/Pilot.odraft`)).toBe(true);
    expect(lib.projects.get(pid)?.properties.folder_path).toBe('');
  });
});

describe('a file changed outside OpenDraft', () => {
  it('is loaded when the library has nothing the file lacks — keeping the notes .fountain cannot hold', async () => {
    const pid = await folderProject('fountain');
    const id = await newScript(pid, 'Pilot', doc('original', { _notes: [{ id: 'n1', text: 'keep me' }] }));
    touch(`${FOLDER}/Pilot.fountain`, 'INT. ROOM - DAY\n\nRewritten on the laptop.\n');

    const result = await lf.syncScriptWithFile(pid, id);
    expect(result.kind).toBe('loaded-from-file');
    const content = lib.scripts.get(id)!.content!;
    expect(JSON.stringify(content.content)).toContain('Rewritten on the laptop');
    expect(content._notes).toEqual([{ id: 'n1', text: 'keep me' }]);
  });

  it('is never overwritten by a save — the save stops and the question is raised', async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('mine'));
    touch(`${FOLDER}/Pilot.odraft`, fs.files.get(`${FOLDER}/Pilot.odraft`)!.text.replace('mine', 'theirs'));

    await save(pid, id, { content: doc('mine, edited') });
    expect(fs.files.get(`${FOLDER}/Pilot.odraft`)?.text).toContain('theirs');
    expect(useLinkedFileStore.getState().byScript[id]?.state).toBe('conflict');
  });

  it("keeps the file's version as a copy when the writer keeps OpenDraft's", async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('mine'));
    touch(`${FOLDER}/Pilot.odraft`, fs.files.get(`${FOLDER}/Pilot.odraft`)!.text.replace('mine', 'theirs'));
    await save(pid, id, { content: doc('mine, edited') }); // blocked: conflict

    answerNextConflict('library');
    const result = await lf.syncScriptWithFile(pid, id);
    expect(result.kind).toBe('kept-library');
    expect(fs.files.get(`${FOLDER}/Pilot.odraft`)?.text).toContain('mine, edited');
    const preserved = result.kind === 'kept-library' ? result.preservedAs : null;
    expect(preserved).toMatch(/Pilot \(changed outside OpenDraft .*\)\.odraft$/);
    expect(fs.files.get(preserved!)?.text).toContain('theirs');
  });

  it("writes what is on screen, not just the last save, when the writer keeps OpenDraft's", async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('saved draft'));
    touch(`${FOLDER}/Pilot.odraft`, fs.files.get(`${FOLDER}/Pilot.odraft`)!.text.replace('saved draft', 'theirs'));

    // The editor holds edits the library does not have yet.
    const onScreen = doc('typed but not saved');
    answerNextConflict('library');
    const result = await lf.syncScriptWithFile(pid, id, {
      hasUnsavedEdits: true,
      saveUnsavedEdits: async () => { await fakeApi.saveScript(pid, id, { content: onScreen }); },
    });
    expect(result.kind === 'kept-library' && result.unsavedStored).toBe(true);
    expect(fs.files.get(`${FOLDER}/Pilot.odraft`)?.text).toContain('typed but not saved');
  });

  it("records OpenDraft's version in Version History when the writer takes the file's", async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('mine'));
    touch(`${FOLDER}/Pilot.odraft`, fs.files.get(`${FOLDER}/Pilot.odraft`)!.text.replace('mine', 'theirs'));

    answerNextConflict('file');
    const unsaved = vi.fn(async () => {});
    const result = await lf.syncScriptWithFile(pid, id, { hasUnsavedEdits: true, saveUnsavedEdits: unsaved });
    expect(result.kind).toBe('loaded-from-file');
    expect(unsaved).toHaveBeenCalledOnce();
    expect(lib.checkins).toHaveLength(1);
    expect(JSON.stringify(lib.scripts.get(id)!.content)).toContain('theirs');
  });
});

describe('a drive that goes away', () => {
  it('costs the save nothing: the file is marked pending and written when the drive returns', async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('v1'));
    fs.offline.add('/raid');

    await save(pid, id, { content: doc('written while offline') });
    expect(lib.scripts.get(id)!.content).toEqual(doc('written while offline'));
    expect((await lf.getLink(id))?.pending).toBe(true);
    expect(useLinkedFileStore.getState().byScript[id]?.state).toBe('pending');
    expect(await lf.retryPendingWrites()).toBe(1);

    fs.offline.clear();
    expect(await lf.retryPendingWrites()).toBe(0);
    expect(fs.files.get(`${FOLDER}/Pilot.odraft`)?.text).toContain('written while offline');
    expect((await lf.getLink(id))?.pending).toBe(false);
  });

  it('opens the library copy and says so when the file cannot be reached', async () => {
    const pid = await folderProject();
    const id = await newScript(pid, 'Pilot', doc('v1'));
    fs.offline.add('/raid');
    const result = await lf.syncScriptWithFile(pid, id);
    expect(result.kind).toBe('unreachable');
  });
});

describe('a single script saved to a file', () => {
  it('links to the chosen file, writes it, and keeps the file when unlinked', async () => {
    const p = await fakeApi.createProject('Library project');
    const created = await fakeApi.createScript(p.id, { title: 'Short', content: doc('tiny') });
    const outcome = await lf.linkScriptToFile(p.id, created.meta.id, '/raid/Short.fdx');
    expect(outcome).toBe('written');
    expect(fs.files.get('/raid/Short.fdx')?.text).toContain('<FinalDraft');
    expect((await lf.findLinkByPath('/RAID/short.FDX'))?.scriptId).toBe(created.meta.id);

    await lf.unlinkScript(created.meta.id);
    expect(await lf.getLink(created.meta.id)).toBeNull();
    expect(fs.files.has('/raid/Short.fdx')).toBe(true);
  });

  it('refuses a format it cannot keep a script in', async () => {
    const p = await fakeApi.createProject('Library project');
    const created = await fakeApi.createScript(p.id, { title: 'Short', content: doc('tiny') });
    await expect(lf.linkScriptToFile(p.id, created.meta.id, '/raid/Short.docx')).rejects.toThrow(/\.odraft/);
  });
});

describe('merging what a file format cannot carry', () => {
  it('takes app state the file lacks from the library, and nothing the file has', () => {
    const merged = lf.mergeKeptMetadata(
      { type: 'doc', content: [], _revisionMode: true },
      { type: 'doc', content: [{ type: 'action' }], _notes: ['n'], _revisionMode: false, other: 'x' },
    );
    expect(merged).toEqual({ type: 'doc', content: [], _revisionMode: true, _notes: ['n'] });
  });
});

describe('naming a project opened from a folder', () => {
  it('takes the film name over a generic folder like "scripts"', () => {
    expect(lf.projectNameForFolder('/Volumes/RAID/MyFilm/scripts')).toBe('MyFilm');
    expect(lf.projectNameForFolder('D:\\Work\\Night Shift\\Drafts\\')).toBe('Night Shift');
    expect(lf.projectNameForFolder('/Volumes/RAID/MyFilm')).toBe('MyFilm');
    // Nothing above it but a drive: keep the folder's own name.
    expect(lf.projectNameForFolder('D:\\scripts')).toBe('scripts');
  });
});
