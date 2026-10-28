/**
 * Alternates — other versions of a line of dialogue or action, kept beside
 * the one in the script (editor/alternates), and of a whole scene
 * (editor/sceneAlternates).
 *
 * Adds the `alternates` and `alternateIndex` attributes to lines and
 * `sceneVersions` and `sceneVersionIndex` to scene headings, and draws a chip
 * in the margin of every element that has versions: ‹ 2/3 › on a line,
 * ‹ Sc 2/3 › on a heading, which steps through them. The chip is a widget
 * decoration, so it is never document text, never printed, never exported.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  ALTERNATE_TYPES,
  alternatesOf,
  cycleAlternateTransaction,
  versionCount,
  versionIndex,
} from '../alternates';
import {
  cycleSceneAlternateTransaction,
  sceneVersionCount,
  sceneVersionIndex,
  sceneVersionsOf,
} from '../sceneAlternates';

export const alternatesPluginKey = new PluginKey<DecorationSet>('alternates');

const DESCEND: ReadonlySet<string> = new Set(['doc', 'dualDialogue', 'dualDialogueColumn']);

type Cycle = typeof cycleAlternateTransaction;

function chip(
  view: EditorView,
  getPos: () => number | undefined,
  index: number,
  count: number,
  scene = false,
): HTMLElement {
  const el = document.createElement('span');
  el.className = scene ? 'alternate-chip alternate-chip--scene' : 'alternate-chip';
  el.contentEditable = 'false';
  el.title = scene
    ? `Version ${index + 1} of ${count} of this scene — only this one prints. Right-click the heading for more.`
    : `Version ${index + 1} of ${count} — only this one prints. Right-click the line for more.`;
  const cycle: Cycle = scene ? cycleSceneAlternateTransaction : cycleAlternateTransaction;
  const step = (direction: 1 | -1, label: string, text: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'alternate-chip-step';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    // mousedown, not click: the editor must not take the caret off the line.
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos === undefined) return;
      const tr = cycle(view.state, pos, direction);
      if (tr) view.dispatch(tr);
    });
    return b;
  };
  const label = document.createElement('span');
  label.className = 'alternate-chip-label';
  label.textContent = scene ? `Sc ${index + 1}/${count}` : `${index + 1}/${count}`;
  el.append(
    step(-1, scene ? 'Previous version of the scene' : 'Previous version', '‹'),
    label,
    step(1, scene ? 'Next version of the scene' : 'Next version', '›'),
  );
  return el;
}

/** The chips for `doc`. Exported for tests. */
export function buildAlternateDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (DESCEND.has(node.type.name)) return true;
    if (node.type.name === 'sceneHeading' && sceneVersionsOf(node).length > 0) {
      const index = sceneVersionIndex(node);
      const count = sceneVersionCount(node);
      decorations.push(
        Decoration.widget(pos + 1, (view, getPos) => chip(view, getPos, index, count, true), {
          side: -1,
          ignoreSelection: true,
          key: `scene-alternate-${index}-${count}`,
        }),
      );
    } else if (alternatesOf(node).length > 0) {
      const index = versionIndex(node);
      const count = versionCount(node);
      decorations.push(
        Decoration.widget(pos + 1, (view, getPos) => chip(view, getPos, index, count), {
          side: -1,
          ignoreSelection: true,
          // A new key when the numbers change, so the chip is redrawn.
          key: `alternate-${index}-${count}`,
        }),
      );
    }
    return false;
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/** Versions as data attributes, so copy and paste inside the editor keeps them. */
const versionAttributes = {
  alternates: {
    default: null,
    // A new line split off this one is a new line, not another copy of the versions.
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute('data-alternates');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length ? parsed : null;
      } catch {
        return null;
      }
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      Array.isArray(attributes.alternates) && attributes.alternates.length
        ? { 'data-alternates': JSON.stringify(attributes.alternates) }
        : {},
  },
  alternateIndex: {
    default: 0,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-alternate-index')) || 0,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.alternateIndex ? { 'data-alternate-index': String(attributes.alternateIndex) } : {},
  },
};

/** A scene's versions, the same way: data attributes, never copied onto a split. */
const sceneVersionAttributes = {
  sceneVersions: {
    default: null,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute('data-scene-versions');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length ? parsed : null;
      } catch {
        return null;
      }
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      Array.isArray(attributes.sceneVersions) && attributes.sceneVersions.length
        ? { 'data-scene-versions': JSON.stringify(attributes.sceneVersions) }
        : {},
  },
  sceneVersionIndex: {
    default: 0,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-scene-version-index')) || 0,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.sceneVersionIndex ? { 'data-scene-version-index': String(attributes.sceneVersionIndex) } : {},
  },
};

export const Alternates = Extension.create({
  name: 'alternates',

  addGlobalAttributes() {
    return [
      { types: [...ALTERNATE_TYPES], attributes: versionAttributes },
      { types: ['sceneHeading'], attributes: sceneVersionAttributes },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: alternatesPluginKey,
        state: {
          init: (_config, state) => buildAlternateDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildAlternateDecorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => alternatesPluginKey.getState(state),
        },
      }),
    ];
  },
});
