import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ rowsAffected: 1 })),
  select: vi.fn(async () => [] as unknown[]),
}));
vi.mock('./db', () => ({ getDb: async () => db }));

const { pullDeviceContent } = await import('./deviceSyncStore');

const binding = {
  project_id: 'project', scope: 'scope', binding_id: 'binding', enabled: 1, generation: 'g1', published: 1, last_synced: 0,
};
const meta = (format: string) => ({
  id: 'script', title: 'Pilot', author: '', format, created_at: '', updated_at: '',
  page_count: 0, size_bytes: 0, color: '', pinned: false, sort_order: 0, preview: '',
});
const screenplay: Record<string, unknown> = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'Rain.' }] }] };
const treatment: Record<string, unknown> = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It rains.' }] }] };
const original = (content: Record<string, unknown>) => ({ raw: JSON.stringify(content), updated_at: '', content });

beforeEach(() => {
  db.execute.mockClear();
});

describe('pullDeviceContent', () => {
  it('never writes a treatment into a screenplay, nor a screenplay into a treatment', async () => {
    expect(await pullDeviceContent(binding, meta('screenplay'), treatment, original(screenplay))).toBe(false);
    expect(await pullDeviceContent(binding, meta('treatment'), screenplay, original(treatment))).toBe(false);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('writes a body that fits its format', async () => {
    expect(await pullDeviceContent(binding, meta('treatment'), treatment, original(treatment))).toBe(true);
    expect(await pullDeviceContent(binding, meta('screenplay'), screenplay, original(screenplay))).toBe(true);
    // An empty placeholder block is neither, and fits a new, empty treatment.
    const empty: Record<string, unknown> = { type: 'doc', content: [{ type: 'sceneHeading', content: [] }] };
    expect(await pullDeviceContent(binding, meta('treatment'), empty, original({ type: 'doc', content: [] }))).toBe(true);
  });
});
