/**
 * Which title pages the Title Page dialog must not rebuild from its fields.
 */
import { describe, it, expect } from 'vitest';
import { isFreeFormTitlePage, type TitlePageBuildSource } from './titlePageDialogBlocks';

const source = (nodes: Array<{ type: string; attrs?: Record<string, unknown> }>): TitlePageBuildSource => ({
  state: {
    doc: { forEach: (cb: (n: unknown) => void) => nodes.forEach((n) => cb({ type: { name: n.type }, attrs: n.attrs })) },
  },
} as unknown as TitlePageBuildSource);

describe('isFreeFormTitlePage', () => {
  it('is true for a page of free lines from a Final Draft file', () => {
    expect(isFreeFormTitlePage(source([{ type: 'titlePage', attrs: { field: 'blank' } }, { type: 'titlePage', attrs: { field: 'free' } }]))).toBe(true);
  });

  it('is true when only the title line carries the file\'s own XML', () => {
    expect(isFreeFormTitlePage(source([{ type: 'titlePage', attrs: { field: 'title', fdxXml: '<Paragraph/>' } }]))).toBe(true);
  });

  it('is false for a page built from the dialog\'s fields', () => {
    expect(isFreeFormTitlePage(source([
      { type: 'titlePage', attrs: { field: 'blank' } },
      { type: 'titlePage', attrs: { field: 'title' } },
      { type: 'titlePage', attrs: { field: 'author' } },
    ]))).toBe(false);
  });

  it('is false for a script with no title page', () => {
    expect(isFreeFormTitlePage(source([{ type: 'sceneHeading' }, { type: 'action' }]))).toBe(false);
  });
});
