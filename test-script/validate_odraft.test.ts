/**
 * Validate a converted .odraft file against OpenDraft's own parser and schema.
 *
 * Writing valid-looking JSON is not the same as writing a file the app can
 * open: `parseOdraft` rejects a bad envelope, and ProseMirror rejects a node
 * type or attribute the screenplay schema does not declare — silently dropping
 * the content in the editor rather than erroring. Running the file through both
 * is the only real proof the conversion worked.
 *
 * Point it at a file with ODRAFT_FILE and run it from `frontend/`:
 *   ODRAFT_FILE="../test-script/output/NAME.odraft" \
 *     npx vitest run ../test-script/validate_odraft.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOdraft } from '../frontend/src/utils/odraftFormat';
import { stripSaveMetadata } from '../frontend/src/utils/saveContent';
import { testSchema } from '../frontend/src/test/screenplaySchema';
import { findTitlePageRegion, titlePageAttrsCarryData } from '../frontend/src/utils/titlePageRegion';

const FILE = process.env.ODRAFT_FILE;

describe('converted .odraft', () => {
  if (!FILE) {
    it.skip('needs ODRAFT_FILE', () => {});
    return;
  }

  const raw = readFileSync(FILE, 'utf-8');
  const parsed = parseOdraft(raw);
  const { pmDoc } = stripSaveMetadata(parsed.content);

  it('is accepted by parseOdraft', () => {
    expect(parsed.version).toBe(2);
    expect(parsed.meta.title).toBeTruthy();
  });

  it('builds a valid ProseMirror document against the screenplay schema', () => {
    const node = testSchema.nodeFromJSON(pmDoc);
    expect(() => node.check()).not.toThrow();
    expect(node.childCount).toBeGreaterThan(0);
  });

  it('round-trips through the schema without losing a node or a character', () => {
    const node = testSchema.nodeFromJSON(pmDoc);
    const back = node.toJSON() as { content?: unknown[] };
    const source = pmDoc.content as unknown[];
    expect(back.content?.length).toBe(source.length);
    expect(node.textBetween(0, node.content.size, '\n').length).toBeGreaterThan(0);
  });

  it('uses only element types the editor knows', () => {
    const known = new Set(Object.keys(testSchema.nodes));
    const types = new Set((pmDoc.content as { type: string }[]).map((n) => n.type));
    expect([...types].filter((t) => !known.has(t))).toEqual([]);
  });

  it('opens with a title page the app recognises as one', () => {
    const node = testSchema.nodeFromJSON(pmDoc);
    const infos = node.content.content.map((n) => ({
      type: n.type.name,
      hasText: n.textContent.trim().length > 0,
      hasTitleData: titlePageAttrsCarryData(n.attrs),
    }));
    const region = findTitlePageRegion(infos);
    expect(region.length).toBeGreaterThan(0);
    expect(region.isReal).toBe(true);
    // The body has to start after it — a title page that swallowed the script
    // would also pass the two assertions above.
    expect(infos.slice(region.length).some((i) => i.type === 'sceneHeading')).toBe(true);
  });

  it('never leaves a character cue without dialogue under it', () => {
    const blocks = pmDoc.content as { type: string }[];
    const orphans = blocks.filter(
      (b, i) =>
        b.type === 'character' &&
        !['dialogue', 'parenthetical'].includes(blocks[i + 1]?.type ?? ''),
    );
    expect(orphans).toHaveLength(0);
  });
});
