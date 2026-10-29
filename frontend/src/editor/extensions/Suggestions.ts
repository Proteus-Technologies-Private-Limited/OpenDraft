/**
 * Suggest mode in the editor (editor/suggestions holds the logic).
 *
 * - The `suggestionInsert` and `suggestionDelete` marks. Neither is
 *   inclusive: typing beside a suggestion is not part of it unless the
 *   typist is suggesting too, in which case the edit is marked explicitly.
 * - The `suggestedSplit`, `suggestedJoin` and `suggestedType` attributes on
 *   every text element.
 * - A label beside a line that is suggested to join the one before, or to
 *   change type — the only suggestions with no text of their own to colour.
 * - While suggesting, every edit the writer makes is rewritten as suggestions
 *   before it is applied, by wrapping the view's dispatch. Remote changes,
 *   undo and this module's own transactions pass through untouched.
 */
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { BOOKMARKABLE_TYPES } from '../../utils/bookmarks';
import { ALTERNATES_META } from '../alternates';
import {
  SUGGEST_DELETE, SUGGEST_INSERT, SUGGESTED_JOIN, SUGGESTED_SPLIT, SUGGESTED_TYPE,
  isHousekeeping, isLocalEdit, suggestTransaction, type Blocked, type SuggestionStamp, type TypeStamp,
} from '../suggestions';

const when = (at: unknown) => {
  const n = Number(at);
  if (!n) return '';
  try { return new Date(n).toLocaleString(); } catch { return ''; }
};

export const SuggestionInsert = Mark.create({
  name: SUGGEST_INSERT,
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-suggestion-id'), renderHTML: (a) => ({ 'data-suggestion-id': a.id }) },
      by: { default: '', parseHTML: (el) => el.getAttribute('data-suggestion-by') || '', renderHTML: (a) => ({ 'data-suggestion-by': a.by }) },
      at: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-suggestion-at')) || 0, renderHTML: (a) => ({ 'data-suggestion-at': String(a.at || 0) }) },
    };
  },
  parseHTML() { return [{ tag: 'ins[data-suggestion-id]' }]; },
  renderHTML({ HTMLAttributes, mark }) {
    return ['ins', mergeAttributes(HTMLAttributes, {
      class: 'suggestion-insert',
      title: `Suggested by ${mark.attrs.by || 'someone'}${when(mark.attrs.at) ? ` · ${when(mark.attrs.at)}` : ''}`,
    }), 0];
  },
});

export const SuggestionDelete = Mark.create({
  name: SUGGEST_DELETE,
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-suggestion-id'), renderHTML: (a) => ({ 'data-suggestion-id': a.id }) },
      by: { default: '', parseHTML: (el) => el.getAttribute('data-suggestion-by') || '', renderHTML: (a) => ({ 'data-suggestion-by': a.by }) },
      at: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-suggestion-at')) || 0, renderHTML: (a) => ({ 'data-suggestion-at': String(a.at || 0) }) },
    };
  },
  parseHTML() { return [{ tag: 'del[data-suggestion-id]' }]; },
  renderHTML({ HTMLAttributes, mark }) {
    return ['del', mergeAttributes(HTMLAttributes, {
      class: 'suggestion-delete',
      title: `${mark.attrs.by || 'Someone'} suggested deleting this${when(mark.attrs.at) ? ` · ${when(mark.attrs.at)}` : ''}`,
    }), 0];
  },
});

/** A stamp as a data attribute, so copy and paste inside the editor keeps it. */
const stampAttribute = (attr: string, dataName: string) => ({
  default: null,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => {
    const raw = el.getAttribute(dataName);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const v = attributes[attr] as SuggestionStamp | null;
    return v && typeof v === 'object' ? { [dataName]: JSON.stringify(v), [`${dataName}-by`]: v.by } : {};
  },
});

export const suggestionsPluginKey = new PluginKey<DecorationSet>('suggestions');

function label(text: string, title: string, kind: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `suggestion-label suggestion-label--${kind}`;
  el.contentEditable = 'false';
  el.textContent = text;
  el.title = title;
  return el;
}

const TYPE_NAMES: Record<string, string> = {
  sceneHeading: 'Scene Heading', action: 'Action', character: 'Character', dialogue: 'Dialogue',
  parenthetical: 'Parenthetical', transition: 'Transition', general: 'General', shot: 'Shot',
  lyrics: 'Lyrics', newAct: 'New Act', endOfAct: 'End of Act',
};
const typeName = (t: string) => TYPE_NAMES[t] ?? t;

/** Labels for the suggestions that have no text of their own. Exported for tests. */
export function buildSuggestionDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const join = node.attrs[SUGGESTED_JOIN] as SuggestionStamp | null;
    if (join && typeof join === 'object') {
      decorations.push(Decoration.widget(pos + 1, () => label('⤒ join', `${join.by || 'Someone'} suggested joining this line to the one before`, 'join'), {
        side: -1, ignoreSelection: true, key: `join-${join.id}`,
      }));
    }
    const type = node.attrs[SUGGESTED_TYPE] as TypeStamp | null;
    if (type && typeof type === 'object' && type.from) {
      decorations.push(Decoration.widget(pos + 1, () => label(`was ${typeName(type.from)}`, `${type.by || 'Someone'} suggested changing this from ${typeName(type.from)} to ${typeName(node.type.name)}`, 'type'), {
        side: -1, ignoreSelection: true, key: `type-${type.id}-${type.from}-${node.type.name}`,
      }));
    }
    return false;
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

export interface SuggestionsOptions {
  /** Who is suggesting now, or null when edits go straight in. Read on every edit. */
  suggester: () => string | null;
  /** Told when part of an edit was dropped because a suggestion cannot carry it. */
  onBlocked: (what: Blocked) => void;
  /** True in a suggester's session: the app's own housekeeping changes are not applied (see isHousekeeping). */
  dropHousekeeping: () => boolean;
}

export const Suggestions = Extension.create<SuggestionsOptions>({
  name: 'suggestions',

  addOptions() {
    return { suggester: () => null, onBlocked: () => {}, dropHousekeeping: () => false };
  },

  addExtensions() {
    return [SuggestionInsert, SuggestionDelete];
  },

  addGlobalAttributes() {
    return [{
      types: [...BOOKMARKABLE_TYPES],
      attributes: {
        [SUGGESTED_SPLIT]: stampAttribute(SUGGESTED_SPLIT, 'data-suggested-split'),
        [SUGGESTED_JOIN]: stampAttribute(SUGGESTED_JOIN, 'data-suggested-join'),
        [SUGGESTED_TYPE]: stampAttribute(SUGGESTED_TYPE, 'data-suggested-type'),
      },
    }];
  },

  onCreate() {
    const view = this.editor.view;
    const original = view.props.dispatchTransaction;
    if (!original) return;
    const options = this.options;
    view.setProps({
      dispatchTransaction(tr) {
        if (options.dropHousekeeping() && isHousekeeping(tr)) return;
        const by = options.suggester();
        // Adding, switching or dropping a version of a line or scene is not
        // something a suggestion can carry (editor/alternates): refused whole,
        // not half-applied.
        if (by && tr.getMeta(ALTERNATES_META) && isLocalEdit(tr)) {
          options.onBlocked('alternates');
          return;
        }
        const next = by && isLocalEdit(tr)
          ? suggestTransaction(view.state, tr, { by, onBlocked: options.onBlocked })
          : tr;
        original.call(view, next);
      },
    });
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: suggestionsPluginKey,
        state: {
          init: (_c, state) => buildSuggestionDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildSuggestionDecorations(tr.doc) : old),
        },
        props: { decorations: (state) => suggestionsPluginKey.getState(state) },
      }),
    ];
  },
});
