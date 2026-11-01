import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  destination: '/separate-copy.fountain',
  /** Every save command: where it wrote and whether it asked for a backup. */
  writes: [] as { path: string; backup: unknown }[],
  /** Modification time per path; a write moves the clock on. */
  mtimes: new Map<string, number>(),
  clock: 1000,
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
    if (command === 'stat_path') {
      const mtime = fake.mtimes.get(args.path as string);
      return mtime === undefined
        ? { exists: false, modified_ms: 0 }
        : { exists: true, modified_ms: mtime };
    }
    if (command.startsWith('save_')) {
      fake.writes.push({ path: args.path as string, backup: args.backup });
      fake.clock += 10;
      fake.mtimes.set(args.path as string, fake.clock);
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  },
}));
import { saveDocumentInPlace, saveFile } from './fileOps';
import {
  ExternalSaveCancelled,
  forgetOwnWrite,
  useExternalSaveReview,
} from '../services/externalSave';
// Load the converter before timing consent; cold transforms can exceed a second in the full suite.
beforeAll(async () => {
  await import('./importScreenplay');
});
const ORIGINAL = '/Original.fountain';
const TEXT = 'INT. ROOM - DAY\n\nEdited.';
beforeEach(() => {
  fake.destination = '/separate-copy.fountain';
  fake.writes = [];
  fake.mtimes = new Map([[ORIGINAL, 500]]);
  forgetOwnWrite(ORIGINAL);
  useExternalSaveReview.setState({ queue: [] });
});
const paths = () => fake.writes.map((w) => w.path);
async function saveAnswering(choice: 'cancel' | 'copy' | 'overwrite', text = TEXT) {
  const saving = saveDocumentInPlace(ORIGINAL, text, { name: 'Original.fountain' });
  await vi.waitFor(() =>
    expect(useExternalSaveReview.getState().queue).toHaveLength(1),
  );
  useExternalSaveReview.getState().answer(choice);
  return saving;
}
describe('file operation protection', () => {
  it('does not call a write adapter when cancelled', async () => {
    await expect(saveAnswering('cancel')).rejects.toBeInstanceOf(ExternalSaveCancelled);
    expect(fake.writes).toEqual([]);
  });
  it('writes a separate copy and leaves the source pending', async () => {
    await expect(saveAnswering('copy')).rejects.toMatchObject({ copySaved: true });
    expect(paths()).toEqual(['/separate-copy.fountain']);
  });
  it('rejects Save a Copy targeting the original, before any write', async () => {
    fake.destination = ORIGINAL;
    await expect(saveAnswering('copy')).rejects.toThrow('Choose a different destination');
    expect(fake.writes).toEqual([]);
  });
});
describe('asking once per file', () => {
  it('backs up on the approved overwrite, then saves without asking or backing up again', async () => {
    await saveAnswering('overwrite');
    expect(fake.writes).toEqual([{ path: ORIGINAL, backup: true }]);

    await saveDocumentInPlace(ORIGINAL, `${TEXT} Again.`, { name: 'Original.fountain' });
    await saveDocumentInPlace(ORIGINAL, `${TEXT} And again.`, { name: 'Original.fountain' });
    expect(useExternalSaveReview.getState().queue).toHaveLength(0);
    expect(fake.writes.slice(1)).toEqual([
      { path: ORIGINAL, backup: false },
      { path: ORIGINAL, backup: false },
    ]);
  });
  it('asks again, and backs up again, once something else has written the file', async () => {
    await saveAnswering('overwrite');
    fake.mtimes.set(ORIGINAL, 99_999); // saved by another application
    await saveAnswering('overwrite', `${TEXT} After.`);
    expect(fake.writes).toEqual([
      { path: ORIGINAL, backup: true },
      { path: ORIGINAL, backup: true },
    ]);
  });
  it('an automatic save never asks, and writes nothing until the writer has agreed', async () => {
    await expect(
      saveDocumentInPlace(ORIGINAL, TEXT, { name: 'Original.fountain', background: true }),
    ).rejects.toBeInstanceOf(ExternalSaveCancelled);
    expect(useExternalSaveReview.getState().queue).toHaveLength(0);
    expect(fake.writes).toEqual([]);

    await saveAnswering('overwrite');
    await saveDocumentInPlace(ORIGINAL, `${TEXT} Auto.`, { name: 'Original.fountain', background: true });
    expect(fake.writes.at(-1)).toEqual({ path: ORIGINAL, backup: false });
  });
  it('never asks about OpenDraft\'s own format', async () => {
    await saveDocumentInPlace('/Script.odraft', '{}', { name: 'Script.odraft' });
    expect(useExternalSaveReview.getState().queue).toHaveLength(0);
    expect(paths()).toEqual(['/Script.odraft']);
  });
});
describe('Export over an existing file', () => {
  it('does not ask again after the save dialog, and backs the file up', async () => {
    fake.destination = ORIGINAL;
    expect(await saveFile(TEXT, 'Original.fountain')).toBe(true);
    expect(useExternalSaveReview.getState().queue).toHaveLength(0);
    // No backup flag: the command's default, which backs up another app's file.
    expect(fake.writes).toEqual([{ path: ORIGINAL, backup: undefined }]);
  });
  it('makes the next in-place save of that file ask again', async () => {
    await saveAnswering('overwrite');
    fake.destination = ORIGINAL;
    await saveFile(`${TEXT} Exported.`, 'Original.fountain');
    const asking = saveAnswering('overwrite', `${TEXT} Then saved.`);
    await asking;
    expect(fake.writes.at(-1)).toEqual({ path: ORIGINAL, backup: true });
  });
});
