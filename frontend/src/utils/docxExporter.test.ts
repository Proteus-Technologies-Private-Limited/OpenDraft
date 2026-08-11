import { describe, it, expect } from 'vitest';
import { buildTextRuns } from './docxExporter';
import { jsonBlockRuns } from './nodeText';
import { block, BR } from '../test/screenplaySchema';

/**
 * The docx package builds an OOXML element tree of `{ rootKey, root }` nodes.
 * Assert against the OOXML element names (`w:br`, `w:b`, `w:t`) rather than
 * any private field — the element names are the format and don't move between
 * package versions.
 */
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

const countBreaks = (runs: unknown[]) => runs.filter((r) => hasElement(r, 'w:br')).length;

describe('DOCX buildTextRuns with hard breaks', () => {
  it('emits a Word line break for a hard break', () => {
    const runs = buildTextRuns(jsonBlockRuns(block('action', 'one', BR, 'two')));
    expect(runs).toHaveLength(3);
    expect(hasElement(runs[1], 'w:br')).toBe(true);
  });

  it('does not filter the break out as an empty run', () => {
    expect(countBreaks(buildTextRuns(jsonBlockRuns(block('action', 'a', BR, 'b'))))).toBe(1);
  });

  it('does not swallow a block whose only content is a break', () => {
    const runs = buildTextRuns(jsonBlockRuns(block('action', BR)));
    expect(runs).toHaveLength(1);
    expect(hasElement(runs[0], 'w:br')).toBe(true);
  });

  it('still returns a single break-free run for a genuinely empty block', () => {
    const runs = buildTextRuns(jsonBlockRuns(block('action')));
    expect(runs).toHaveLength(1);
    expect(hasElement(runs[0], 'w:br')).toBe(false);
  });

  it('emits one break per consecutive hard break', () => {
    expect(countBreaks(buildTextRuns(jsonBlockRuns(block('action', 'a', BR, BR, 'b'))))).toBe(2);
  });

  it('keeps marks on the surrounding text runs and none on the break', () => {
    const runs = buildTextRuns(jsonBlockRuns({
      type: 'action',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'plain' },
      ],
    }));
    expect(hasElement(runs[0], 'w:b')).toBe(true);
    expect(hasElement(runs[1], 'w:br')).toBe(true);
    expect(hasElement(runs[2], 'w:b')).toBe(false);
  });
});

/**
 * Fonts. The OOXML element for a run's typeface is `w:rFonts`, whose
 * attributes name the face; read it back rather than trusting the input.
 */
function fontOf(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const n = node as { rootKey?: string; root?: unknown; key?: string; value?: string };
  // w:rFonts carries the face on its w:ascii attribute.
  if (n.key === 'w:ascii' && typeof n.value === 'string') return n.value;
  const children = Array.isArray(n.root) ? n.root : n.root !== undefined ? [n.root] : [];
  for (const child of children) {
    const found = fontOf(child);
    if (found !== undefined) return found;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (value === n.root) continue;
    const found = fontOf(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('DOCX buildTextRuns and fonts', () => {
  it('writes the screenplay Courier when nothing says otherwise', () => {
    const runs = buildTextRuns(jsonBlockRuns(block('action', 'plain')));
    expect(fontOf(runs[0])).toBe('Courier Prime');
  });

  it('writes the document font it is given', () => {
    const runs = buildTextRuns(jsonBlockRuns(block('action', 'plain')), 'Times New Roman');
    expect(fontOf(runs[0])).toBe('Times New Roman');
  });

  it("lets a run's own typeface win over the document's", () => {
    const styled = {
      type: 'action',
      content: [
        { type: 'text', text: 'plain ' },
        { type: 'text', text: 'styled', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia' } }] },
      ],
    };
    const runs = buildTextRuns(jsonBlockRuns(styled), 'Times New Roman');

    expect(fontOf(runs[0])).toBe('Times New Roman');
    expect(fontOf(runs[1])).toBe('Georgia');
  });
});
