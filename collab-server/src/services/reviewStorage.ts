import * as path from 'path';
import * as fs from 'fs';
import { REVIEW_PROTOCOL } from './reviewProtocol';

/** Old servers must never load persisted Yjs updates containing new schema marks. */
export function reviewDataDirectory(dataDir: string): string {
  return path.join(dataDir, `review-v${REVIEW_PROTOCOL}`);
}

/** Read older state on upgrade, but write only into the current namespace. */
export function reviewStatePaths(dataDir: string, filename: string): string[] {
  const safeFile = path.basename(filename);
  return [
    ...Array.from({ length: REVIEW_PROTOCOL }, (_, index) =>
      path.join(dataDir, `review-v${REVIEW_PROTOCOL - index}`, safeFile),
    ),
    path.join(dataDir, safeFile),
  ];
}

export function findReviewStateFile(
  dataDir: string,
  filename: string,
): string | undefined {
  return reviewStatePaths(dataDir, filename).find((candidate) =>
    fs.existsSync(candidate),
  );
}

/** Reset/close must not resurrect an older room through the upgrade fallback. */
export function deleteReviewStateFiles(
  dataDir: string,
  filename: string,
): void {
  for (const file of reviewStatePaths(dataDir, filename)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
