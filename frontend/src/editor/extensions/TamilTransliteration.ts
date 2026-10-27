import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { transliterateToTamil } from '../../utils/tamilTransliteration';
import { useEditorStore } from '../../stores/editorStore';

export const tamilTransliterationPluginKey = new PluginKey('tamilTransliteration');

export interface TamilTransliterationOptions {
  getEnabled?: () => boolean;
}

/**
 * Creates the underlying ProseMirror plugin for Tamil transliteration.
 */
export function createTamilTransliterationPlugin(options?: TamilTransliterationOptions): Plugin {
  const isExtensionEnabled = () => {
    if (options?.getEnabled) {
      return options.getEnabled();
    }
    return useEditorStore.getState().tamilTypingEnabled;
  };

  return new Plugin({
    key: tamilTransliterationPluginKey,

    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (!isExtensionEnabled()) {
          return false;
        }

        // If the typed character is a delimiter (e.g. space, punctuation)
        if (text === ' ' || text === '\t' || /^[\s,.;:!?\-()[\]{}<>"'/\\|@#$%^&*+=~`]$/.test(text)) {
          const { state } = view;
          const $from = state.doc.resolve(from);
          const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');

          // Extract trailing ASCII word immediately before insertion point
          const match = /[a-zA-Z0-9]+$/.exec(textBefore);
          if (match) {
            const asciiWord = match[0];
            const wordStart = from - asciiWord.length;
            const tamilWord = transliterateToTamil(asciiWord);

            if (tamilWord && tamilWord !== asciiWord) {
              const tr = state.tr;
              // Tamil script is styled at 11pt
              const textStyleMarkType = state.schema.marks.textStyle;
              const tamilMarks = textStyleMarkType
                ? [textStyleMarkType.create({ fontSize: '11pt' })]
                : undefined;
              const tamilNode = state.schema.text(tamilWord, tamilMarks);
              const delimiterNode = state.schema.text(text);

              tr.replaceWith(wordStart, to, [tamilNode, delimiterNode]);
              view.dispatch(tr);
              return true;
            }
          }
        }

        return false;
      },

      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // Quick shortcut: Ctrl+M / Cmd+M to toggle Tamil typing
        if ((event.ctrlKey || event.metaKey) && (event.key === 'm' || event.key === 'M')) {
          event.preventDefault();
          const store = useEditorStore.getState();
          store.toggleTamilTyping();
          return true;
        }

        if (!isExtensionEnabled()) {
          return false;
        }

        // On Enter or Space or Tab: commit word if cursor is at end of Latin word
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab') {
          const { state } = view;
          const { selection } = state;
          if (!selection.empty) {
            return false;
          }

          const $cursor = selection.$from;
          const textBefore = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\ufffc');
          const match = /[a-zA-Z0-9]+$/.exec(textBefore);

          if (match) {
            const asciiWord = match[0];
            const wordStart = selection.from - asciiWord.length;
            const tamilWord = transliterateToTamil(asciiWord);

            if (tamilWord && tamilWord !== asciiWord) {
              const textStyleMarkType = state.schema.marks.textStyle;
              const tamilMarks = textStyleMarkType
                ? [textStyleMarkType.create({ fontSize: '11pt' })]
                : undefined;
              const tamilNode = state.schema.text(tamilWord, tamilMarks);

              if (event.key === ' ') {
                event.preventDefault();
                const tr = state.tr.replaceWith(wordStart, selection.from, [
                  tamilNode,
                  state.schema.text(' '),
                ]);
                view.dispatch(tr);
                return true;
              }

              const tr = state.tr.replaceWith(wordStart, selection.from, tamilNode);
              view.dispatch(tr);
              return false; // let normal Enter/Tab action proceed
            }
          }
        }

        return false;
      },
    },
  });
}

export const TamilTransliteration = Extension.create<TamilTransliterationOptions>({
  name: 'tamilTransliteration',

  addOptions() {
    return {
      getEnabled: () => useEditorStore.getState().tamilTypingEnabled,
    };
  },

  addProseMirrorPlugins() {
    return [createTamilTransliterationPlugin(this.options)];
  },
});

export default TamilTransliteration;
