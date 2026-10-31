import { describe, expect, it, vi } from 'vitest';
import {
  ExternalSaveCancelled,
  guardedExternalSave,
  reviewExternalSave,
  useExternalSaveReview,
} from './externalSave';
describe('external source overwrite review', () => {
  for (const choice of ['cancel', 'copy', 'overwrite'] as const)
    it(`handles ${choice} without writing before consent`, async () => {
      const original = new Uint8Array([0, 255, 2, 100]);
      let disk = original.slice();
      const write = vi.fn(async () => {
        disk = new Uint8Array([5]);
      });
      const saveCopy = vi.fn(async () => true);
      const review = vi.fn(async () => {
        expect(disk).toEqual(original);
        expect(write).not.toHaveBeenCalled();
        return choice;
      });
      const promise = guardedExternalSave({
        name: 'script.fadein',
        contents: new Uint8Array([5]),
        validate: async () => {},
        review,
        saveCopy,
        write,
      });
      if (choice === 'overwrite') {
        await promise;
        expect(write).toHaveBeenCalledOnce();
      } else {
        await expect(promise).rejects.toBeInstanceOf(ExternalSaveCancelled);
        expect(disk).toEqual(original);
      }
      expect(saveCopy).toHaveBeenCalledTimes(choice === 'copy' ? 1 : 0);
    });
  it('never requests consent or writes after output validation fails', async () => {
    const review = vi.fn(),
      write = vi.fn(),
      saveCopy = vi.fn();
    await expect(
      guardedExternalSave({
        name: 'script.osf',
        contents: 'broken',
        validate: async () => {
          throw Error('Invalid XML');
        },
        review,
        write,
        saveCopy,
      }),
    ).rejects.toThrow('Invalid XML');
    expect(review).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it('keeps repeated reviews distinct and resolves them in order', async () => {
    const a = reviewExternalSave('same.fdx', ['Unsupported property']);
    const b = reviewExternalSave('same.fdx');
    const queue = useExternalSaveReview.getState().queue;
    expect(queue[0].id).not.toBe(queue[1].id);
    useExternalSaveReview.getState().answer('cancel');
    await expect(a).resolves.toBe('cancel');
    useExternalSaveReview.getState().answer('copy');
    await expect(b).resolves.toBe('copy');
  });
});
