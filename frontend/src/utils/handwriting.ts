/**
 * The handwriting panel: how it is asked for, and the arithmetic it floats by.
 *
 * The request is a window event rather than a prop, because the two places that
 * offer it — the Edit menu and the touch context menu — are neither of them
 * parents of the editor that owns the panel. It follows the pattern
 * `opendraft:auth-required` already set.
 *
 * Its own module rather than a second export from `ScribbleInput`: a file that
 * exports both a component and a constant loses fast refresh. The placement and
 * paragraph rules live here too, where they can be tested without a document,
 * a Pencil or an iPad.
 */
export const HANDWRITING_EVENT = 'opendraft:handwriting';

/** Ask the editor to open the handwriting panel at the current selection. */
export function requestHandwriting(): void {
  window.dispatchEvent(new CustomEvent(HANDWRITING_EVENT));
}

export interface PanelSize { width: number; height: number }
export interface PanelPos { left: number; top: number }
export interface Viewport { width: number; height: number }

/** Breathing room between the panel and the edge of the screen. */
export const PANEL_MARGIN = 8;

/**
 * Keep the panel on screen.
 *
 * It is dragged with a Pencil or a fingertip, the window rotates, and the
 * software keyboard changes the visible height under it — any of which can
 * leave a freely positioned panel with its header, and so its drag handle and
 * its close button, past the edge with no way back. The whole panel is kept
 * inside the viewport while it fits; when it does not fit — a phone in
 * landscape, an iPad with the keyboard up — the top-left corner wins, because
 * that is the end the controls are on.
 */
export function clampPanelPosition(
  pos: PanelPos,
  size: PanelSize,
  viewport: Viewport,
  margin: number = PANEL_MARGIN,
): PanelPos {
  const maxLeft = viewport.width - size.width - margin;
  const maxTop = viewport.height - size.height - margin;
  return {
    left: Math.round(Math.min(Math.max(pos.left, margin), Math.max(margin, maxLeft))),
    top: Math.round(Math.min(Math.max(pos.top, margin), Math.max(margin, maxTop))),
  };
}

/**
 * Where the panel opens when the writer has never moved it: centred across the
 * foot of the window. Low, because what it must not cover is the line being
 * written into, and the script runs down from the top; centred, because the
 * iPad is held either way up.
 */
export function defaultPanelPosition(
  size: PanelSize,
  viewport: Viewport,
  margin: number = PANEL_MARGIN,
): PanelPos {
  return clampPanelPosition(
    {
      left: Math.round((viewport.width - size.width) / 2),
      top: Math.round(viewport.height - size.height - margin),
    },
    size,
    viewport,
    margin,
  );
}

/**
 * What was written, as paragraphs.
 *
 * Blank lines are the writer separating thoughts rather than empty paragraphs
 * to reproduce, so runs of them collapse. A single line comes back as one
 * entry, which the caller inserts as text so it joins the sentence the caret
 * was in instead of breaking the block in two.
 */
export function splitHandwriting(text: string): string[] {
  return text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Characters that hug the word before them: an insert starting with one of
 * these wants no space in front of it, or a comma ends up adrift.
 */
const ATTACHES_LEFT = /[,.;:!?)\]}…’”%]/;

/**
 * Characters that hug what follows them: text inserted straight after an open
 * bracket or quote wants no space, and neither does the next character when the
 * insert itself ends in one.
 */
const ATTACHES_RIGHT = /[([{“‘/]/;

/**
 * Space a handwritten insert into the sentence around it.
 *
 * What comes back from handwriting recognition is trimmed, because Scribble
 * puts strays either end of almost everything it converts (issue #90). That is
 * right for a line of its own and wrong in the middle of one: a writer adding
 * "(CONTINUOUS)" to the end of a scene heading got `DAY(CONTINUOUS)`, and the
 * panel now exists to make exactly those small in-line revisions, so it happens
 * constantly rather than occasionally.
 *
 * `prevChar` and `nextChar` are the characters the insert lands between —
 * empty at the start or end of a block, since nothing there needs joining.
 * Punctuation is left alone in both directions: a space is added only where two
 * pieces of ordinary text would otherwise run together.
 */
export function joinHandwriting(insert: string, prevChar: string, nextChar: string): string {
  if (insert === '') return insert;

  const needsBefore = prevChar !== ''
    && !/\s/.test(prevChar)
    && !ATTACHES_RIGHT.test(prevChar)
    && !ATTACHES_LEFT.test(insert[0]);

  const needsAfter = nextChar !== ''
    && !/\s/.test(nextChar)
    && !ATTACHES_LEFT.test(nextChar)
    && !ATTACHES_RIGHT.test(insert[insert.length - 1]);

  return `${needsBefore ? ' ' : ''}${insert}${needsAfter ? ' ' : ''}`;
}
