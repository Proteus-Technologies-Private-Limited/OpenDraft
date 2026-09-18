/**
 * The drag session builds DOM that only a stylesheet makes visible, and the two
 * live in different files with nothing connecting them.
 *
 * That gap has already cost one regression: a careless range replacement in
 * avScript.css took `.av-col-guide` out with it. The session went on creating
 * the element, so nothing threw, no test failed and the build was clean — the
 * guide was simply an unstyled div, and dragging a divider showed no live
 * preview at all. These assertions are the link.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../styles/avScript.css', import.meta.url)),
  'utf8',
);
/** Comments stripped: several of them name the very selectors asserted below,
 *  and a prose mention is not a rule. */
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first rule whose selector list contains `selector`. */
function ruleFor(selector: string): string | null {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return open < 0 || close < 0 ? null : css.slice(open + 1, close);
}

describe('avScript.css carries what the drag session needs', () => {
  it('styles the guide line the session appends to <body>', () => {
    const rule = ruleFor('.av-col-guide');
    expect(rule, '.av-col-guide is missing — the live preview will be invisible').not.toBeNull();
    // Parented to <body> and positioned from viewport coordinates, so it must
    // be fixed; and it needs a width and a colour or it draws nothing.
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/width:/);
    expect(rule).toMatch(/background:/);
    // It sits over the editor and must never swallow the pointer mid-drag.
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  it('holds the resize cursor while the class the session sets is on', () => {
    expect(css).toContain('.av-col-resizing');
    expect(ruleFor('.av-col-resizing .ProseMirror')).toMatch(/cursor:\s*col-resize/);
  });

  it('lights the one handle being dragged', () => {
    expect(ruleFor('.av-col-handle--active::before')).toMatch(/background:/);
  });

  it('draws a divider at rest, at the weight the audio cell used to', () => {
    const rule = ruleFor('.av-col-handle::before');
    expect(rule).toMatch(/width:\s*1px/);
    // The cell border is gone; this is the only thing drawing a column divider,
    // so it cannot be transparent or conditional on hover.
    expect(rule).not.toMatch(/opacity:\s*0\b/);
    expect(css).not.toMatch(/\.av-cell-audio\s*\{[^}]*border-left:/);
  });
});
