/**
 * Focus Mode's two editor behaviours (View → Focus Mode):
 *
 * - **Typewriter scrolling** — the line being written is held at a fixed
 *   height in the window, so the eye stays in one place and the page moves.
 * - **Dimming** — everything but the current element, or the current scene,
 *   is faded.
 *
 * The chrome itself (menus, panels, full screen) is handled in
 * ScreenplayEditor; this extension only reads whether Focus Mode is on and how
 * it is set up, through `getConfig`, so it never imports the store.
 *
 * Dimming marks the *current* text elements with `focus-current` and lets CSS
 * fade the rest, rather than decorating every other element: a feature script
 * has thousands of them, and a cursor move would rebuild them all.
 */
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type FocusDim = 'off' | 'element' | 'scene';

export interface FocusModeConfig {
  typewriter: boolean;
  dim: FocusDim;
}

export interface FocusModeOptions {
  /** Focus Mode's settings while it is on, null while it is off. */
  getConfig: () => FocusModeConfig | null;
}

/** Toggles Focus Mode (utils/shortcuts notation). */
export const FOCUS_MODE_SHORTCUT = 'Mod-Shift-f';

/** Transaction meta asking the plugin to re-read `getConfig`. */
export const FOCUS_MODE_REFRESH = 'focusModeRefresh';

export const focusModePluginKey = new PluginKey<DecorationSet>('focusMode');

/** Where the caret line is held, as a fraction of the visible height from the top. */
export const TYPEWRITER_LINE = 0.4;

/**
 * Positions of the text elements that stay bright for `dim` with the caret at
 * `pos`: the element itself, or every element of its scene — from the scene
 * heading to the next one (or to the next act), or from the top of the script
 * when there is no heading above.
 */
export function focusTextblocks(doc: PMNode, pos: number, dim: FocusDim): number[] {
  if (dim === 'off') return [];
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if (dim === 'element') {
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).isTextblock) return [$pos.before(d)];
    }
    return [];
  }
  const index = $pos.index(0);
  const isBoundary = (n: PMNode) => n.type.name === 'sceneHeading' || n.type.name === 'newAct';
  let start = Math.min(index, doc.childCount - 1);
  while (start > 0 && !isBoundary(doc.child(start))) start--;
  let end = Math.min(index, doc.childCount - 1) + 1;
  while (end < doc.childCount && !isBoundary(doc.child(end))) end++;

  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < end; i++) {
    const child = doc.child(i);
    if (i >= start) {
      if (child.isTextblock) out.push(offset);
      else child.descendants((n, p) => {
        if (n.isTextblock) { out.push(offset + 1 + p); return false; }
        return true;
      });
    }
    offset += child.nodeSize;
  }
  return out;
}

function buildDecorations(doc: PMNode, pos: number, config: FocusModeConfig | null): DecorationSet {
  if (!config || config.dim === 'off') return DecorationSet.empty;
  const decos = focusTextblocks(doc, pos, config.dim).map((p) => {
    const node = doc.nodeAt(p)!;
    return Decoration.node(p, p + node.nodeSize, { class: 'focus-current' });
  });
  return DecorationSet.create(doc, decos);
}

/** Scroll so the caret sits at TYPEWRITER_LINE of the scrolling container. */
function holdCaretLine(view: EditorView): void {
  const container = view.dom.closest('.editor-main');
  if (!container) return;
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const rect = container.getBoundingClientRect();
  const lineMiddle = (coords.top + coords.bottom) / 2;
  const delta = lineMiddle - (rect.top + rect.height * TYPEWRITER_LINE);
  if (Math.abs(delta) > 2) container.scrollTop += delta;
}

export const FocusMode = Extension.create<FocusModeOptions>({
  name: 'focusMode',

  addOptions() {
    return { getConfig: () => null };
  },

  addProseMirrorPlugins() {
    const { getConfig } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: focusModePluginKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, state.selection.head, getConfig()),
          apply: (tr, old, _oldState, newState) => {
            if (!tr.docChanged && !tr.selectionSet && !tr.getMeta(FOCUS_MODE_REFRESH)) return old;
            const config = getConfig();
            if (!config || config.dim === 'off') return old === DecorationSet.empty ? old : DecorationSet.empty;
            return buildDecorations(newState.doc, newState.selection.head, config);
          },
        },
        props: {
          decorations: (state) => focusModePluginKey.getState(state),
        },
        view: () => {
          let frame = 0;
          return {
            update: (view, prevState) => {
              const config = getConfig();
              if (!config?.typewriter || !view.hasFocus()) return;
              if (view.state.selection.eq(prevState.selection) && view.state.doc === prevState.doc) return;
              // After the browser has laid out the edit, and after ProseMirror's
              // own scroll-into-view, which would otherwise undo this.
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => holdCaretLine(view));
            },
            destroy: () => cancelAnimationFrame(frame),
          };
        },
      }),
    ];
  },
});
