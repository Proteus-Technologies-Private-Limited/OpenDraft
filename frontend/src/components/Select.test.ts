import { afterEach, describe, expect, it, vi } from 'vitest';
import { choiceLineFor } from './Select';

afterEach(() => vi.unstubAllGlobals());

const toolbarBox = { left: 505, top: 24, width: 362, height: 106 };
function stubDom(classes: string[]) {
  vi.stubGlobal('document', { documentElement: { classList: { contains: (c: string) => classes.includes(c) } } });
  vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '8px', paddingLeft: '10px', paddingRight: '10px', rowGap: '4px' }));
}
const trigger = (inToolbar: boolean) => ({
  closest: () => (inToolbar ? { getBoundingClientRect: () => toolbarBox } : null),
}) as unknown as HTMLElement;

describe('Select choice line (foldable held as a book)', () => {
  it('lays a toolbar pulldown across the toolbar\'s second row', () => {
    stubDom(['foldable', 'fold-book']);
    expect(choiceLineFor(trigger(true))).toEqual({
      left: 515, top: 24 + 8 + 44 + 4, minWidth: 342, maxWidth: 342, maxHeight: 44, line: { width: 342, height: 44 },
    });
  });

  it('leaves every other pulldown as a list', () => {
    stubDom(['foldable', 'fold-book']);
    expect(choiceLineFor(trigger(false))).toBeNull();
    stubDom(['foldable', 'wide']);
    expect(choiceLineFor(trigger(true))).toBeNull();
    stubDom([]);
    expect(choiceLineFor(trigger(true))).toBeNull();
  });
});
