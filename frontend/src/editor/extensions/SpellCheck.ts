import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { spellChecker } from '../spellchecker';

export const spellCheckPluginKey = new PluginKey('spellCheck');

interface SpellCheckPluginState {
  decorations: DecorationSet;
  enabled: boolean;
}

export const SpellCheck = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    return [
      new Plugin({
        key: spellCheckPluginKey,
        state: {
          init(): SpellCheckPluginState {
            return { decorations: DecorationSet.empty, enabled: false };
          },
          apply(
            tr: Transaction,
            value: SpellCheckPluginState,
            _oldState: EditorState,
            _newState: EditorState,
          ): SpellCheckPluginState {
            const meta = tr.getMeta(spellCheckPluginKey) as
              | { toggle?: boolean; decorations?: DecorationSet }
              | undefined;
            if (meta?.toggle !== undefined) {
              const enabled = meta.toggle;
              if (!enabled) {
                return { decorations: DecorationSet.empty, enabled: false };
              }
              return { ...value, enabled };
            }
            if (meta?.decorations !== undefined) {
              return { ...value, decorations: meta.decorations };
            }
            if (tr.docChanged && value.enabled) {
              return {
                ...value,
                decorations: value.decorations.map(tr.mapping, tr.doc),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state: EditorState) {
            const pluginState = spellCheckPluginKey.getState(state) as
              | SpellCheckPluginState
              | undefined;
            return pluginState?.decorations || DecorationSet.empty;
          },
        },
        view(editorView: EditorView) {
          const runCheck = () => {
            const pluginState = spellCheckPluginKey.getState(
              editorView.state,
            ) as SpellCheckPluginState | undefined;
            if (!pluginState?.enabled || !spellChecker.isReady()) return;

            const decorations: Decoration[] = [];
            const { doc } = editorView.state;

            doc.descendants((node, pos) => {
              if (!node.isText) return;
              const text = node.text || '';
              // Match words (letters including accented, plus apostrophes)
              const wordRegex = /[a-zA-Z\u00C0-\u024F']+/g;
              let match: RegExpExecArray | null;
              while ((match = wordRegex.exec(text)) !== null) {
                const word = match[0];
                // Skip very short words
                if (word.length < 2) continue;
                // Skip ALL CAPS words (character names in screenplays)
                if (word === word.toUpperCase() && word.length > 1) continue;

                if (!spellChecker.check(word)) {
                  const from = pos + match.index;
                  const to = from + word.length;
                  decorations.push(
                    Decoration.inline(from, to, { class: 'spell-error' }),
                  );
                }
              }
            });

            const decorationSet = DecorationSet.create(doc, decorations);
            const tr = editorView.state.tr.setMeta(spellCheckPluginKey, {
              decorations: decorationSet,
            });
            editorView.dispatch(tr);
          };

          return {
            update(view: EditorView, prevState: EditorState) {
              const pluginState = spellCheckPluginKey.getState(view.state) as
                | SpellCheckPluginState
                | undefined;
              if (!pluginState?.enabled) return;

              // Run check when toggled on (decorations empty) or doc changed
              const prevPluginState = spellCheckPluginKey.getState(
                prevState,
              ) as SpellCheckPluginState | undefined;
              const justEnabled =
                pluginState.enabled && !prevPluginState?.enabled;

              if (justEnabled || !view.state.doc.eq(prevState.doc)) {
                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(runCheck, justEnabled ? 100 : 500);
              }
            },
            destroy() {
              if (timeout) clearTimeout(timeout);
            },
          };
        },
      }),
    ];
  },
});
