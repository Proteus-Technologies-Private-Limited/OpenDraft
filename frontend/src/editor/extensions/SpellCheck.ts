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
  activeFrom: number;
  activeTo: number;
}

/** Shared scan logic: find misspelled words in a doc and build decorations. */
function buildSpellDecorations(
  doc: EditorState['doc'],
  activeFrom?: number,
  activeTo?: number,
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || '';
    const wordRegex = /[a-zA-Z\u00C0-\u024F']+/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(text)) !== null) {
      const word = match[0];
      if (word.length < 2) continue;
      if (word === word.toUpperCase() && word.length > 1) continue;
      if (!spellChecker.check(word)) {
        // Build the same context key used by findAllErrors / ignoreOnce
        const contextKey = buildContextKey(text, match.index, word.length);
        if (spellChecker.isIgnoredOnce(word, contextKey)) continue;
        const from = pos + match.index;
        const to = from + word.length;
        const isActive = activeFrom !== undefined && from === activeFrom && to === activeTo;
        decorations.push(
          Decoration.inline(from, to, {
            class: isActive ? 'spell-error spell-active' : 'spell-error',
          }),
        );
      }
    }
  });
  return decorations;
}

/** Context key builder — must match SpellChecker.buildContextKey */
function buildContextKey(text: string, matchIndex: number, wordLength: number): string {
  const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
  const after = text.slice(matchIndex + wordLength, matchIndex + wordLength + 20);
  return `${before}>><<${after}`;
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
            return { decorations: DecorationSet.empty, enabled: false, activeFrom: 0, activeTo: 0 };
          },
          apply(
            tr: Transaction,
            value: SpellCheckPluginState,
            _oldState: EditorState,
            newState: EditorState,
          ): SpellCheckPluginState {
            const meta = tr.getMeta(spellCheckPluginKey) as
              | { toggle?: boolean; decorations?: DecorationSet; activeRange?: { from: number; to: number } | null }
              | undefined;
            if (meta?.toggle !== undefined) {
              const enabled = meta.toggle;
              if (!enabled) {
                return { decorations: DecorationSet.empty, enabled: false, activeFrom: 0, activeTo: 0 };
              }
              return { ...value, enabled };
            }
            if (meta?.activeRange !== undefined) {
              if (meta.activeRange === null) {
                const decos = value.enabled
                  ? buildSpellDecorations(newState.doc)
                  : [];
                return {
                  ...value,
                  activeFrom: 0,
                  activeTo: 0,
                  decorations: DecorationSet.create(newState.doc, decos),
                };
              }
              const { from, to } = meta.activeRange;
              const decos = value.enabled
                ? buildSpellDecorations(newState.doc, from, to)
                : [];
              return {
                ...value,
                activeFrom: from,
                activeTo: to,
                decorations: DecorationSet.create(newState.doc, decos),
              };
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
          const runCheck = async () => {
            const pluginState = spellCheckPluginKey.getState(
              editorView.state,
            ) as SpellCheckPluginState | undefined;
            if (!pluginState?.enabled) return;

            // Wait for dictionary to finish loading if still in progress
            if (!spellChecker.isReady()) {
              const ok = await spellChecker.whenReady();
              if (!ok) return;
              const ps = spellCheckPluginKey.getState(editorView.state) as
                | SpellCheckPluginState
                | undefined;
              if (!ps?.enabled) return;
            }

            const { doc } = editorView.state;
            const decorations = buildSpellDecorations(doc);
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
