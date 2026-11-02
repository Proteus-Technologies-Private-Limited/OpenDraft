import { create } from 'zustand';
export type ExternalSaveChoice = 'copy' | 'cancel' | 'overwrite';
interface Review {
  id: number;
  name: string;
  warnings: string[];
  resolve(choice: ExternalSaveChoice): void;
}
export const useExternalSaveReview = create<{
  queue: Review[];
  answer(choice: ExternalSaveChoice): void;
}>((set, get) => ({
  queue: [],
  answer: (choice) => {
    const [request, ...queue] = get().queue;
    set({ queue });
    request?.resolve(choice);
  },
}));
let nextReviewId = 0;
export function reviewExternalSave(
  name: string,
  warnings: string[] = [],
): Promise<ExternalSaveChoice> {
  return new Promise((resolve) =>
    useExternalSaveReview.setState((s) => ({
      queue: [...s.queue, { id: nextReviewId++, name, warnings, resolve }],
    })),
  );
}
export const externalScreenplay = (name: string): boolean =>
  /\.(fdx|fadein|osf|fountain|txt|highland|wdz|celtx)$/i.test(name);

/**
 * Files OpenDraft has overwritten in this session with the writer's consent,
 * mapped to the modification time its own save left (0 where the platform has
 * no way to read one back).
 *
 * The original was backed up on that first overwrite, so a later save is only
 * replacing OpenDraft's own output: it neither asks again nor copies the file
 * again. If the time no longer matches, something else has written the file
 * since, and the next save is treated as a first overwrite once more.
 */
const ownWrites = new Map<string, number>();
export function recordOwnWrite(bookmark: string, modifiedMs: number): void {
  ownWrites.set(bookmark, modifiedMs);
}
export function ownWriteTime(bookmark: string): number | undefined {
  return ownWrites.get(bookmark);
}
export function forgetOwnWrite(bookmark: string): void {
  ownWrites.delete(bookmark);
}
export class ExternalSaveCancelled extends Error {
  readonly copySaved: boolean;
  constructor(copySaved = false) {
    super(
      copySaved
        ? 'A separate copy was saved. The original is unchanged.'
        : 'Save cancelled. The original is unchanged.',
    );
    this.copySaved = copySaved;
  }
}
export async function validateExternalReplacement(
  name: string,
  contents: string | Uint8Array,
): Promise<void> {
  const { parseScreenplayImport } = await import('../utils/importScreenplay');
  if (!contents.length)
    throw new Error(
      'Refusing to overwrite an original screenplay with empty output. Use Save As for an intentionally empty document.',
    );
  const data =
    typeof contents === 'string'
      ? contents
      : (contents.slice().buffer as ArrayBuffer);
  await parseScreenplayImport(name, data, { hydrateStores: false });
}
/** Validation and consent happen before the adapter can back up or replace anything. */
export async function guardedExternalSave(options: {
  name: string;
  warnings?: string[];
  contents: string | Uint8Array;
  validate?: typeof validateExternalReplacement;
  review?: typeof reviewExternalSave;
  saveCopy(): Promise<boolean>;
  write(): Promise<void>;
}): Promise<void> {
  await (options.validate ?? validateExternalReplacement)(
    options.name,
    options.contents,
  );
  const choice = await (options.review ?? reviewExternalSave)(
    options.name,
    options.warnings,
  );
  if (choice === 'cancel') throw new ExternalSaveCancelled();
  if (choice === 'copy')
    throw new ExternalSaveCancelled(await options.saveCopy());
  await options.write();
}
