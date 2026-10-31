import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  destination: '/separate-copy.fountain',
  writes: [] as string[],
}));
vi.mock('../services/platform', () => ({
  isTauri: () => true,
  getOS: () => 'windows',
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: async () => fake.destination,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === 'same_file_path') return args.first === args.second;
    if (command === 'stat_path') return { exists: false };
    if (command.startsWith('save_')) {
      fake.writes.push(args.path as string);
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  },
}));
import { saveDocumentInPlace } from './fileOps';
import {
  ExternalSaveCancelled,
  useExternalSaveReview,
} from '../services/externalSave';
// Load the converter before timing consent; cold transforms can exceed a second in the full suite.
beforeAll(async () => {
  await import('./importScreenplay');
});
beforeEach(() => {
  fake.destination = '/separate-copy.fountain';
  fake.writes = [];
  useExternalSaveReview.setState({ queue: [] });
});
describe('file operation protection', () => {
  it('does not call a write adapter when cancelled', async () => {
    const result = expect(
      saveDocumentInPlace('/Original.fountain', 'INT. ROOM - DAY\n\nEdited.', {
        name: 'Original.fountain',
      }),
    ).rejects.toBeInstanceOf(ExternalSaveCancelled);
    await vi.waitFor(() =>
      expect(useExternalSaveReview.getState().queue).toHaveLength(1),
    );
    useExternalSaveReview.getState().answer('cancel');
    await result;
    expect(fake.writes).toEqual([]);
  });
  it('writes a separate copy and leaves the source pending', async () => {
    const result = expect(
      saveDocumentInPlace('/Original.fountain', 'INT. ROOM - DAY\n\nEdited.', {
        name: 'Original.fountain',
      }),
    ).rejects.toMatchObject({ copySaved: true });
    await vi.waitFor(() =>
      expect(useExternalSaveReview.getState().queue).toHaveLength(1),
    );
    useExternalSaveReview.getState().answer('copy');
    await result;
    expect(fake.writes).toEqual(['/separate-copy.fountain']);
  });
  it('rejects Save a Copy targeting the original, before any write', async () => {
    fake.destination = '/Original.fountain';
    const result = expect(
      saveDocumentInPlace('/Original.fountain', 'INT. ROOM - DAY\n\nEdited.', {
        name: 'Original.fountain',
      }),
    ).rejects.toThrow('Choose a different destination');
    await vi.waitFor(() =>
      expect(useExternalSaveReview.getState().queue).toHaveLength(1),
    );
    useExternalSaveReview.getState().answer('copy');
    await result;
    expect(fake.writes).toEqual([]);
  });
});
