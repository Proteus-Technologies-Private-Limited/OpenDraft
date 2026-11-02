/**
 * Alternates — other versions of a line of dialogue or action, or of a whole
 * scene, kept beside the one in the script (editor/alternates,
 * editor/sceneAlternates).
 *
 * Adds the `alternates` and `alternateIndex` attributes to lines and
 * `sceneAlternates` and `sceneAlternateIndex` to scene headings, and draws a
 * chip in the margin of every element that has versions: ‹ 2/3 › beside a
 * line, ‹ Scene 2/3 › above a heading, which step through them. The chip is
 * a widget decoration, so it is never document text, never printed, never
 * exported.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  ALTERNATE_TYPES,
  ALTERNATES_META,
  alternatesOf,
  cycleAlternateTransaction,
  versionCount,
  versionIndex,
} from '../alternates';
import {
  SCENE_ALTERNATES_ATTR,
  SCENE_ALTERNATE_INDEX_ATTR,
  cycleSceneAlternateTransaction,
  duplicateSceneAlternates,
  freshSceneAlternateIds,
  sceneAlternatesOf,
  sceneVersionCount,
  sceneVersionIndex,
} from '../sceneAlternates';
import { REVISION_SKIP_META } from '../revisionMarks';

export const alternatesPluginKey = new PluginKey<DecorationSet>('alternates');

const DESCEND: ReadonlySet<string> = new Set(['doc', 'dualDialogue', 'dualDialogueColumn']);

type Cycle = (state: EditorState, pos: number, direction: 1 | -1) => Transaction | null;

function chip(
  view: EditorView,
  getPos: () => number | undefined,
  index: number,
  count: number,
  scene = false,
): HTMLElement {
  const el = document.createElement('span');
  el.className = scene ? 'alternate-chip scene-alternate-chip' : 'alternate-chip';
  el.contentEditable = 'false';
  el.title = scene
    ? `Scene version ${index + 1} of ${count} — only this one prints. Right-click in the scene for more.`
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
      else console.warn('[alternates] could not switch version at', pos);
    });
    return b;
  };
  const label = document.createElement('span');
  label.className = 'alternate-chip-label';
  label.textContent = scene ? `Scene ${index + 1}/${count}` : `${index + 1}/${count}`;
  const what = scene ? 'scene version' : 'version';
  el.append(step(-1, `Previous ${what}`, '‹'), label, step(1, `Next ${what}`, '›'));
  return el;
}

/** The chips for `doc`. Exported for tests. */
export function buildAlternateDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (DESCEND.has(node.type.name)) return true;
    // Scenes are top-level only (editor/omitScene sceneRangeAt); an omitted
    // one has nothing left to have versions of.
    if (node.type.name === 'sceneHeading' && node.attrs.omitted !== true && sceneAlternatesOf(node).length > 0) {
      const index = sceneVersionIndex(node);
      const count = sceneVersionCount(node);
      decorations.push(
        Decoration.widget(pos + 1, (view, getPos) => chip(view, getPos, index, count, true), {
          side: -1,
          ignoreSelection: true,
          key: `scene-alternate-${index}-${count}`,
        }),
      );
      return false;
    }
    if (alternatesOf(node).length > 0) {
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

/** Scene versions as data attributes, for the same reason. */
const sceneVersionAttributes = {
  [SCENE_ALTERNATES_ATTR]: {
    default: null,
    // A heading split off this one starts a new scene, with no versions.
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute('data-scene-alternates');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length ? parsed : null;
      } catch (err) {
        console.warn('[alternates] dropped unreadable scene versions from pasted HTML', err);
        return null;
      }
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[SCENE_ALTERNATES_ATTR];
      return Array.isArray(value) && value.length ? { 'data-scene-alternates': JSON.stringify(value) } : {};
    },
  },
  [SCENE_ALTERNATE_INDEX_ATTR]: {
    default: 0,
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-scene-alternate-index')) || 0,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[SCENE_ALTERNATE_INDEX_ATTR]
        ? { 'data-scene-alternate-index': String(attributes[SCENE_ALTERNATE_INDEX_ATTR]) }
        : {},
  },
};

/**
 * Clears scene versions an edit has copied onto a second heading
 * (duplicateSceneAlternates). Not for a load, nor for a collaborator's steps —
 * their own client does this for them, as it does for scene numbers.
 */
export function dedupeSceneAlternates(trs: readonly Transaction[], state: EditorState): Transaction | null {
  if (!trs.some((tr) => tr.docChanged)) return null;
  const remote = trs.some((t) => (t.getMeta('y-sync$') as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin);
  const wholeDoc = trs.some((t) => t.steps.some((s) => s instanceof ReplaceStep
    && (s as ReplaceStep).from === 0 && (s as ReplaceStep).to === t.before.content.size));
  if (remote || wholeDoc) return null;
  const extra = duplicateSceneAlternates(state.doc);
  if (!extra.length) return null;
  const tr = state.tr;
  for (const pos of extra) {
    tr.setNodeAttribute(pos, SCENE_ALTERNATES_ATTR, null);
    tr.setNodeAttribute(pos, SCENE_ALTERNATE_INDEX_ATTR, 0);
  }
  return tr.setMeta(REVISION_SKIP_META, true);
}

/** Replacing shared text concurrently is not an atomic version selection in Yjs. */
export function alternateSessionGuard(isCollaborating: () => boolean, onBlocked: () => void): Plugin {
  return new Plugin({
    filterTransaction(tr) {
      if (tr.getMeta(ALTERNATES_META) && isCollaborating()) {
        onBlocked();
        return false;
      }
      return true;
    },
  });
}

export const Alternates = Extension.create<{
  isCollaborating: () => boolean;
  onBlocked: () => void;
}>({
  name: 'alternates',

  addOptions() {
    return { isCollaborating: () => false, onBlocked: () => {} };
  },

  addGlobalAttributes() {
    return [
      { types: [...ALTERNATE_TYPES], attributes: versionAttributes },
      { types: ['sceneHeading'], attributes: sceneVersionAttributes },
    ];
  },

  addProseMirrorPlugins() {
    return [
      alternateSessionGuard(this.options.isCollaborating, this.options.onBlocked),
      new Plugin<DecorationSet>({
        key: alternatesPluginKey,
        state: {
          init: (_config, state) => buildAlternateDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildAlternateDecorations(tr.doc) : old),
        },
        appendTransaction: (trs, _oldState, newState) => dedupeSceneAlternates(trs, newState),
        props: {
          decorations: (state) => alternatesPluginKey.getState(state),
          // A copied scene is a new scene with versions of its own.
          transformPasted: (slice) => freshSceneAlternateIds(slice),
        },
      }),
    ];
  },
});
