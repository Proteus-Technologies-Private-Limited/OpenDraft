import { describe, it, expect } from 'vitest';
import { buildTextRuns } from './docxExporter';
import { jsonBlockRuns } from './nodeText';
import { block } from '../test/screenplaySchema';

/** True when an OOXML element of this name appears anywhere under the node. */
function hasElement(node: unknown, rootKey: string): boolean {
  if (node === null || typeof node !== 'object') return false;
  const n = node as { rootKey?: string; root?: unknown };
  if (n.rootKey === rootKey) return true;
  const children = Array.isArray(n.root) ? n.root : n.root !== undefined ? [n.root] : [];
  if (children.some((c) => hasElement(c, rootKey))) return true;
  return Object.values(node as Record<string, unknown>).some(
    (v) => v !== n.root && hasElement(v, rootKey),
  );
}

describe('DOCX element colours', () => {
  const runsOf = () => jsonBlockRuns(block('sceneHeading', 'INT. ROOM - DAY'));

  it('writes a text colour on every run when one is given', () => {
    const runs = buildTextRuns(runsOf(), undefined, [], () => false, 'FF2600');
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(hasElement(r, 'w:color')).toBe(true);
  });

  it('writes no colour when none is given (plain black on white)', () => {
    const runs = buildTextRuns(runsOf());
    for (const r of runs) expect(hasElement(r, 'w:color')).toBe(false);
  });

  it('also colours the text around a footnote reference', () => {
    const refs = [{ noteId: 'n1', number: 1, charOffset: 4 }];
    const runs = buildTextRuns(runsOf(), undefined, refs as never, () => false, 'FF2600');
    const textRuns = runs.filter((r) => hasElement(r, 'w:t'));
    expect(textRuns.length).toBeGreaterThan(0);
    for (const r of textRuns) expect(hasElement(r, 'w:color')).toBe(true);
  });
});
