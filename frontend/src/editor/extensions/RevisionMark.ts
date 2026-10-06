/**
 * Revision Mode in the schema: a `revision` attribute on `textStyle`, the
 * `revised` block attribute, and the plugin that sets them while Revision Mode
 * is on. See editor/revisionMarks.ts for the rules, and for why the revision
 * rides on `textStyle` rather than a mark of its own.
 */
import { Extension } from '@tiptap/core';
import TextStyle from '@tiptap/extension-text-style';
import {
  REVISION_ATTR, REVISED_ATTR, clearRevisions, revisionMarksPlugin, type RevisionConfig,
} from '../revisionMarks';
import { revisionSlug, type RevisionSettings } from '../revisionColors';

/** Block types an edit can flag. Not the title page, sections or notes: none
 *  of them is part of the script a production prints revised pages of. */
export const REVISABLE_BLOCK_TYPES = [
  'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical', 'transition',
  'general', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList',
  'customElement', 'avPara', 'avShot', 'avDirection', 'avGraphic',
];

/**
 * TextStyle, also recognising a revised span that carries no inline style.
 * The stock rule only takes a `<span style>`, so revised text copied within
 * the app and pasted back would lose its revision — and its textStyle.
 */
export const RevisionTextStyle = TextStyle.extend({
  parseHTML() {
    return [...(this.parent?.() ?? []), { tag: 'span[data-rev-color]' }];
  },
});

export interface RevisionMarkOptions {
  /** Read on every transaction. Null: draw existing marks, add none. */
  getConfig: () => RevisionConfig | null;
  /** The marks to draw beside revised lines. Null: the default asterisk. */
  getSettings: () => RevisionSettings | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    revision: {
      /** Remove every revision mark and flag, as one undoable step. */
      clearRevisionMarks: () => ReturnType;
    };
  }
}

export const RevisionMark = Extension.create<RevisionMarkOptions>({
  name: 'revision',

  addOptions() {
    return { getConfig: () => null, getSettings: () => null };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          [REVISION_ATTR]: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-rev-color') || null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const color = attrs[REVISION_ATTR];
              if (!color) return {};
              return {
                class: 'rev-mark',
                'data-rev': revisionSlug(String(color)),
                'data-rev-color': String(color),
              };
            },
          },
        },
      },
      {
        types: REVISABLE_BLOCK_TYPES,
        attributes: {
          [REVISED_ATTR]: {
            default: null,
            // Enter in a flagged line must not flag the new one too.
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-revised') || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs[REVISED_ATTR] ? { 'data-revised': String(attrs[REVISED_ATTR]) } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      clearRevisionMarks: () => ({ state, dispatch }) => {
        if (dispatch) dispatch(clearRevisions(state));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [revisionMarksPlugin(() => this.options.getConfig(), () => this.options.getSettings())];
  },
});
