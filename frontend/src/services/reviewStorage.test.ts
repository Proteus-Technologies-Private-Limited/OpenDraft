import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  reviewDataDirectory,
  findReviewStateFile,
  deleteReviewStateFiles,
} from '../../../collab-server/src/services/reviewStorage';
describe('persisted collaborative state across server versions', () => {
  it('reads legacy state on upgrade but isolates new updates from downgraded servers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-'));
    try {
      const filename = 'project--script--nonce.yjs';
      const legacy = path.join(root, filename);
      fs.writeFileSync(legacy, 'legacy state');
      expect(
        fs.readFileSync(findReviewStateFile(root, filename)!, 'utf8'),
      ).toBe('legacy state');
      fs.mkdirSync(reviewDataDirectory(root), { recursive: true });
      const current = path.join(reviewDataDirectory(root), filename);
      fs.writeFileSync(current, 'new review state');
      expect(
        fs.readFileSync(findReviewStateFile(root, filename)!, 'utf8'),
      ).toBe('new review state');
      expect(fs.readFileSync(legacy, 'utf8')).toBe('legacy state');
      expect(current).not.toBe(legacy);
      deleteReviewStateFiles(root, filename);
      expect(findReviewStateFile(root, filename)).toBeUndefined();
      expect(fs.existsSync(legacy)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
