import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

const parentheticalAutoParens = new PluginKey('parentheticalAutoParens');

export const Parenthetical = Node.create({
  name: 'parenthetical',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      lang: { default: null },
      dir: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="parenthetical"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, string> = {
      'data-type': 'parenthetical',
      class: 'screenplay-element parenthetical',
    };
    if (node.attrs.lang) attrs.lang = node.attrs.lang;
    if (node.attrs.dir) attrs.dir = node.attrs.dir;
    return [
      'div',
      mergeAttributes(HTMLAttributes, attrs),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive('parenthetical')) return false;
        // Tab from parenthetical goes to dialogue
        return editor
          .chain()
          .splitBlock()
          .setNode('dialogue')
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: parentheticalAutoParens,
        // Like Final Draft, a new parenthetical opens as "()" with the cursor
        // between the brackets. It only fires when a line BECOMES an empty
        // parenthetical: backspacing one empty must not bring the brackets back,
        // and neither may undo or a collaborator's edit.
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta('history$') || tr.getMeta('y-sync$'))) return null;
          const { $from, empty } = newState.selection;
          if (!empty) return null;
          const parent = $from.parent;
          if (parent.type.name !== 'parenthetical' || parent.content.size !== 0) return null;
          if (oldState.selection.$from.parent.type.name === 'parenthetical') return null;
          const start = $from.start();
          const tr = newState.tr.insertText('()', start);
          tr.setSelection(TextSelection.create(tr.doc, start + 1));
          return tr;
        },
      }),
    ];
  },
});
