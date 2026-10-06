/**
 * Project zip export → import round trip.
 *
 * The bug that started this: importing an exported project produced each
 * screenplay twice, because the meta file `X.meta.json` was read as the
 * content of a second script named "X.meta". The rest guards everything else
 * the round trip used to drop — properties, colour, pin, order, images.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

vi.mock('../services/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  return { ApiError, api: {} };
});
vi.mock('../services/scratchAssets', () => ({
  getScratchBytes: async () => null,
  getScratchMeta: async () => null,
  putScratchAssetWithId: async () => {},
}));

const { ApiError } = await import('../services/api');
const { buildProjectZip } = await import('./zipExport');
const { importProjectFromZip, groupScriptFiles, remapAssets } = await import('./zipImport');

type Script = {
  meta: {
    id: string; title: string; author: string; format: string; created_at: string; updated_at: string;
    page_count: number; size_bytes: number; color: string; pinned: boolean; sort_order: number; preview: string;
  };
  content: Record<string, unknown>;
};

/** An in-memory stand-in for local storage — just the calls the zip uses. */
function makeBackend(opts: { withAssets?: boolean } = {}) {
  const projects = new Map<string, { id: string; name: string; properties: Record<string, unknown>; color: string; pinned: boolean; sort_order: number; created_at: string; updated_at: string }>();
  const scripts = new Map<string, Script[]>();
  const assets = new Map<string, Map<string, { filename: string; bytes: Uint8Array }>>();
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const backend = {
    projects, scripts, assets,
    failRead: new Set<string>(),
    async createProject(name: string) {
      const p = { id: id('proj'), name, properties: {}, color: '', pinned: false, sort_order: 0, created_at: '', updated_at: '' };
      projects.set(p.id, p);
      scripts.set(p.id, []);
      assets.set(p.id, new Map());
      return p as never;
    },
    async getProject(pid: string) {
      const p = projects.get(pid);
      if (!p) throw new Error('no project');
      return p as never;
    },
    async updateProject(pid: string, data: { properties?: Record<string, unknown> }) {
      const p = projects.get(pid)!;
      p.properties = { ...p.properties, ...data.properties };
      return p as never;
    },
    async deleteProject(pid: string) {
      projects.delete(pid);
      scripts.delete(pid);
    },
    async listScripts(pid: string) {
      return scripts.get(pid)!.map((s) => s.meta) as never;
    },
    async getScript(pid: string, sid: string) {
      if (backend.failRead.has(sid)) throw new Error('disk error');
      const s = scripts.get(pid)!.find((x) => x.meta.id === sid);
      if (!s) throw new Error('no script');
      return structuredClone(s) as never;
    },
    async createScript(pid: string, data: { title: string; content?: unknown; format?: string }) {
      const s: Script = {
        meta: {
          id: id('script'), title: data.title, author: '', format: data.format ?? 'screenplay',
          created_at: '', updated_at: '', page_count: 1, size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
        },
        content: (data.content as Record<string, unknown>) ?? {},
      };
      scripts.get(pid)!.push(s);
      return structuredClone(s) as never;
    },
    async saveScript(pid: string, sid: string, data: { color?: string; pinned?: boolean; sort_order?: number }) {
      const s = scripts.get(pid)!.find((x) => x.meta.id === sid)!;
      Object.assign(s.meta, data);
      return structuredClone(s) as never;
    },
    ...(opts.withAssets === false ? {} : {
      async getAssetBytes(pid: string, aid: string) {
        const a = assets.get(pid)?.get(aid);
        if (!a) throw new Error(`Asset not found: ${aid}`);
        return a.bytes;
      },
      async importAsset(pid: string, a: { id: string; filename: string; mime_type: string; bytes: Uint8Array }) {
        // Like SQLite's assets table: an id is unique across every project.
        for (const [otherPid, map] of assets) {
          if (otherPid !== pid && map.has(a.id)) throw new Error('UNIQUE constraint failed: assets.id');
        }
        assets.get(pid)!.set(a.id, { filename: a.filename, bytes: a.bytes });
      },
    }),
  };
  return backend;
}

const doc = (text: string, extra: Record<string, unknown>[] = []) => ({
  type: 'doc',
  content: [{ type: 'action', content: [{ type: 'text', text }] }, ...extra],
  _notes: [{ id: 'n1', text: `note for ${text}` }],
});

async function seedProject(backend: ReturnType<typeof makeBackend>) {
  const p = await backend.createProject('My Feature');
  await backend.updateProject((p as { id: string }).id, { properties: { logline: 'A writer fights a zip file.', dictionary_words: ['Zorg'] } });
  const pid = (p as { id: string }).id;
  const imageNode = { type: 'image', attrs: { assetId: 'asset-1', projectId: pid, filename: 'poster.png' } };
  backend.assets.get(pid)!.set('asset-1', { filename: 'poster.png', bytes: new Uint8Array([137, 80, 78, 71]) });

  const add = async (title: string, color: string, pinned: boolean, sort_order: number, extra: Record<string, unknown>[] = []) => {
    const s = await backend.createScript(pid, { title, content: doc(title, extra) }) as unknown as Script;
    await backend.saveScript(pid, s.meta.id, { color, pinned, sort_order });
    return s.meta.id;
  };
  // Created out of order on purpose: sort_order, not creation order, is the list order.
  await add('Act Two', '#00f', false, 1);
  await add('Act One', '#f00', true, 0, [imageNode]);
  await add('Act Three', '', false, 2);
  return pid;
}

async function roundTrip(source: ReturnType<typeof makeBackend>, pid: string, target = makeBackend()) {
  const { data } = await buildProjectZip(pid, source);
  const result = await importProjectFromZip(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, 'fallback.zip', target);
  return { result, target, data };
}

describe('project zip round trip', () => {
  let source: ReturnType<typeof makeBackend>;
  let pid: string;
  beforeEach(async () => {
    source = makeBackend();
    pid = await seedProject(source);
  });

  it('imports each script once — no "X.meta" duplicates', async () => {
    const { result, target } = await roundTrip(source, pid);
    const titles = target.scripts.get(result.projectId)!.map((s) => s.meta.title);
    expect(titles).toHaveLength(3);
    expect(titles.some((t) => t.endsWith('.meta'))).toBe(false);
    expect(result.imported).toBe(3);
    expect(result.failed).toEqual([]);
  });

  it('keeps content, order, colour and pin', async () => {
    const { result, target } = await roundTrip(source, pid);
    const list = [...target.scripts.get(result.projectId)!].sort((a, b) => a.meta.sort_order - b.meta.sort_order);
    expect(list.map((s) => s.meta.title)).toEqual(['Act One', 'Act Two', 'Act Three']);
    expect(list.map((s) => s.meta.color)).toEqual(['#f00', '#00f', '']);
    expect(list.map((s) => s.meta.pinned)).toEqual([true, false, false]);
    expect(list[1].content).toMatchObject({ type: 'doc', _notes: [{ text: 'note for Act Two' }] });
  });

  it('restores project name and properties', async () => {
    const { result, target } = await roundTrip(source, pid);
    const p = target.projects.get(result.projectId)!;
    expect(p.name).toBe('My Feature');
    expect(p.properties).toMatchObject({ logline: 'A writer fights a zip file.', dictionary_words: ['Zorg'] });
    expect(result.propertiesRestored).toBe(true);
  });

  const imageIn = (b: ReturnType<typeof makeBackend>, projectId: string) => {
    const actOne = b.scripts.get(projectId)!.find((s) => s.meta.title === 'Act One')!;
    return (actOne.content.content as Array<{ type: string; attrs?: Record<string, unknown> }>).find((n) => n.type === 'image')!;
  };

  it('carries images and points them at the new project', async () => {
    const { result, target } = await roundTrip(source, pid);
    expect(result.assetsRestored).toBe(1);
    const image = imageIn(target, result.projectId);
    expect(image.attrs).toMatchObject({ projectId: result.projectId, filename: 'poster.png' });
    const stored = target.assets.get(result.projectId)!.get(image.attrs!.assetId as string)!;
    expect(stored.bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('imports back into the library it was exported from', async () => {
    // The original project still holds asset-1; reusing that id would collide.
    const { result } = await roundTrip(source, pid, source);
    expect(result.assetsRestored).toBe(1);
    expect(result.assetsFailed).toBe(0);
    const image = imageIn(source, result.projectId);
    expect(image.attrs!.assetId).not.toBe('asset-1');
    expect(source.assets.get(result.projectId)!.has(image.attrs!.assetId as string)).toBe(true);
    // The original is untouched.
    expect(imageIn(source, pid).attrs).toMatchObject({ assetId: 'asset-1', projectId: pid });
    expect(source.projects.size).toBe(2);
  });

  it('flags archives made where image bytes cannot be read', async () => {
    const webSource = makeBackend({ withAssets: false });
    const webPid = await seedProject(webSource);
    const { data, assetsOmitted } = await buildProjectZip(webPid, webSource);
    expect(assetsOmitted).toBe(true);
    const result = await importProjectFromZip(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, '', makeBackend());
    expect(result.assetsOmitted).toBe(true);
    expect(result.assetsRestored).toBe(0);
  });

  it('refuses to export when a script cannot be read, naming it', async () => {
    const victim = source.scripts.get(pid)!.find((s) => s.meta.title === 'Act Two')!;
    source.failRead.add(victim.meta.id);
    await expect(buildProjectZip(pid, source)).rejects.toThrow(/Act Two/);
  });

  it('retries with a new name only on a name clash', async () => {
    const target = makeBackend();
    const real = target.createProject.bind(target);
    let calls = 0;
    target.createProject = async (name: string) => {
      calls++;
      if (calls === 1) throw new (ApiError as unknown as new (s: number, m: string) => Error)(409, 'exists');
      return real(name);
    };
    const { result } = await roundTrip(source, pid, target);
    expect(target.projects.get(result.projectId)!.name).toMatch(/^My Feature \(/);

    const broken = makeBackend();
    broken.createProject = async () => { throw new Error('disk full'); };
    await expect(roundTrip(source, pid, broken)).rejects.toThrow('disk full');
  });

  it('removes the new project when no script can be created', async () => {
    const target = makeBackend();
    target.createScript = async () => { throw new Error('quota'); };
    await expect(roundTrip(source, pid, target)).rejects.toThrow(/None of the 3 scripts/);
    expect(target.projects.size).toBe(0);
  });
});

describe('older and foreign archives', () => {
  it('imports a version 1 archive without duplicating scripts, in archive order', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({ id: 'old', name: 'Legacy', properties: {} }));
    // v1 stripped sort_order, colour and pin from the meta files.
    zip.file('scripts/Pilot.meta.json', JSON.stringify({ title: 'Pilot', format: 'screenplay' }));
    zip.file('scripts/Pilot.json', JSON.stringify(doc('Pilot')));
    zip.file('scripts/Episode 2.meta.json', JSON.stringify({ title: 'Episode 2', format: 'screenplay' }));
    zip.file('scripts/Episode 2.json', JSON.stringify(doc('Episode 2')));
    const data = await zip.generateAsync({ type: 'arraybuffer' });

    const target = makeBackend();
    const result = await importProjectFromZip(data, 'Legacy.zip', target);
    const list = target.scripts.get(result.projectId)!;
    expect(list.map((s) => s.meta.title)).toEqual(['Pilot', 'Episode 2']);
    expect(list.map((s) => s.meta.sort_order)).toEqual([0, 1]);
  });

  it('explains a single-script archive instead of failing obscurely', async () => {
    const zip = new JSZip();
    zip.file('Pilot.meta.json', JSON.stringify({ title: 'Pilot' }));
    zip.file('Pilot.json', JSON.stringify(doc('Pilot')));
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(importProjectFromZip(data, '', makeBackend())).rejects.toThrow(/single script/);
  });

  it('rejects a file that is not a zip', async () => {
    const data = new TextEncoder().encode('not a zip').buffer as ArrayBuffer;
    await expect(importProjectFromZip(data, '', makeBackend())).rejects.toThrow(/not a valid zip/);
  });
});

describe('groupScriptFiles', () => {
  it('pairs X.meta.json with X.json, including titles that contain dots', () => {
    const groups = groupScriptFiles([
      'scripts/My Script.meta.json',
      'scripts/My Script.json',
      'scripts/Dr. No v2.0.meta.json',
      'scripts/Dr. No v2.0.json',
      'scripts/nested/ignored.json',
      'project.json',
    ], 'scripts/');
    expect(groups.map((g) => [g.name, !!g.metaPath, !!g.contentPath])).toEqual([
      ['My Script', true, true],
      ['Dr. No v2.0', true, true],
    ]);
  });
});

describe('remapAssets', () => {
  it('moves only the images that came across, and their portraits', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { assetId: 'a', projectId: 'old' } },
        { type: 'image', attrs: { assetId: 'b', projectId: 'old' } },
      ],
      _characterProfiles: [{ name: 'SARAH', images: ['a', { assetId: 'a', caption: 'x' }, 'b'] }],
    };
    const out = remapAssets(content, new Map([['a', 'a2']]), 'new');
    expect(out.content.map((n) => n.attrs)).toEqual([
      { assetId: 'a2', projectId: 'new' },
      { assetId: 'b', projectId: 'old' },
    ]);
    expect(out._characterProfiles[0].images).toEqual(['a2', { assetId: 'a2', caption: 'x' }, 'b']);
    expect(content.content[0].attrs.assetId).toBe('a'); // input untouched
  });
});
