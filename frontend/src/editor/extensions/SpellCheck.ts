import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { spellChecker } from '../spellchecker';
import { useEditorStore } from '../../stores/editorStore';

export const spellCheckPluginKey = new PluginKey('spellCheck');

interface SpellCheckPluginState {
  decorations: DecorationSet;
  enabled: boolean;
  activeFrom: number;
  activeTo: number;
}

// Unicode-aware tokenizer: matches any letter (incl. Devanagari, CJK,
// Cyrillic, etc.) optionally followed by combining marks, plus straight
// and curly apostrophes for contractions.
const WORD_REGEX = /[\p{L}\p{M}'‘’]+/gu;

/** Context key builder — must match SpellChecker.buildContextKey. */
function buildContextKey(text: string, matchIndex: number, wordLength: number): string {
  const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
  const after = text.slice(matchIndex + wordLength, matchIndex + wordLength + 20);
  return `${before}>><<${after}`;
}

function shouldSkipWord(word: string): boolean {
  if (word.length < 2) return true;
  // Skip ACRONYMS (all uppercase), but only for cased scripts. Scripts without
  // case (Devanagari, Odia, Bengali, Tamil, Arabic, etc.) report
  // toUpperCase() === toLowerCase() === word, so the naive "all caps" check
  // would skip every word in those languages.
  if (
    word === word.toUpperCase() &&
    word !== word.toLowerCase() &&
    word.length > 1
  ) return true;
  return false;
}

// A word that the dictionary doesn't recognize but starts with an uppercase
// letter is almost always a proper noun (person, place, brand) rather than a
// misspelling — flagging them all is noisy in a screenplay full of names.
function looksLikeProperNoun(word: string): boolean {
  return /^\p{Lu}/u.test(word);
}

function makeDecoration(from: number, to: number, isActive: boolean): Decoration {
  return Decoration.inline(from, to, {
    class: isActive ? 'spell-error spell-active' : 'spell-error',
  });
}

/** Scan a single text node for misspellings and append decorations. */
function scanTextNode(
  text: string,
  nodePos: number,
  out: Decoration[],
  activeFrom?: number,
  activeTo?: number,
) {
  WORD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_REGEX.exec(text)) !== null) {
    const word = match[0];
    if (shouldSkipWord(word)) continue;
    if (spellChecker.check(word)) continue;
    if (!useEditorStore.getState().spellingSettings.flagProperNouns && looksLikeProperNoun(word)) continue;
    const contextKey = buildContextKey(text, match.index, word.length);
    if (spellChecker.isIgnoredOnce(word, contextKey)) continue;
    const from = nodePos + match.index;
    const to = from + word.length;
    const isActive =
      activeFrom !== undefined &&
      activeTo !== undefined &&
      from === activeFrom &&
      to === activeTo;
    out.push(makeDecoration(from, to, isActive));
  }
}

/** Scan an entire doc — used on initial enable. */
function buildSpellDecorationsFull(
  doc: ProseMirrorNode,
  activeFrom?: number,
  activeTo?: number,
): Decoration[] {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      scanTextNode(node.text, pos, decos, activeFrom, activeTo);
    }
  });
  return decos;
}

/** Scan only a range (used for incremental rescan after edits). */
function buildSpellDecorationsRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): Decoration[] {
  const decos: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      scanTextNode(node.text, pos, decos);
    }
  });
  return decos;
}

/** Expand a range to the enclosing block boundaries so we re-scan whole words. */
function expandToBlockRange(doc: ProseMirrorNode, from: number, to: number): { from: number; to: number } {
  const docSize = doc.content.size;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(safeFrom, Math.min(to, docSize));
  try {
    const $from = doc.resolve(safeFrom);
    const $to = doc.resolve(safeTo);
    const blockFrom = $from.depth > 0 ? $from.before($from.depth) : safeFrom;
    const blockTo = $to.depth > 0 ? $to.after($to.depth) : safeTo;
    return { from: Math.max(0, blockFrom), to: Math.min(docSize, blockTo) };
  } catch {
    return { from: safeFrom, to: safeTo };
  }
}

/** Compute combined changed range across all step maps in a transaction. */
function getChangedRange(tr: Transaction): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (const stepMap of tr.mapping.maps) {
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (from === -1 || newStart < from) from = newStart;
      if (newEnd > to) to = newEnd;
    });
  }
  return from === -1 ? null : { from, to };
}

export const SpellCheck = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    let initialScanTimeout: ReturnType<typeof setTimeout> | null = null;

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
                const decos = value.enabled ? buildSpellDecorationsFull(newState.doc) : [];
                return {
                  ...value,
                  activeFrom: 0,
                  activeTo: 0,
                  decorations: DecorationSet.create(newState.doc, decos),
                };
              }
              const { from, to } = meta.activeRange;
              const decos = value.enabled ? buildSpellDecorationsFull(newState.doc, from, to) : [];
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
              // 1) Shift existing decorations through the mapping so untouched ones stay aligned.
              let mapped = value.decorations.map(tr.mapping, tr.doc);

              // 2) If the dictionary isn't ready yet, defer rescan to view.update.
              if (!spellChecker.isReady()) {
                return { ...value, decorations: mapped };
              }

              // 3) Find the changed range and expand it to enclosing block boundaries.
              const changed = getChangedRange(tr);
              if (!changed) return { ...value, decorations: mapped };
              const { from: blockFrom, to: blockTo } = expandToBlockRange(tr.doc, changed.from, changed.to);

              // 4) Remove old decorations in the affected range and rescan.
              const stale = mapped.find(blockFrom, blockTo);
              if (stale.length > 0) {
                mapped = mapped.remove(stale);
              }
              const fresh = buildSpellDecorationsRange(tr.doc, blockFrom, blockTo);
              if (fresh.length > 0) {
                mapped = mapped.add(tr.doc, fresh);
              }
              return { ...value, decorations: mapped };
            }

            return value;
          },
        },
        props: {
          decorations(state: EditorState) {
            const pluginState = spellCheckPluginKey.getState(state) as SpellCheckPluginState | undefined;
            return pluginState?.decorations || DecorationSet.empty;
          },
        },
        view(editorView: EditorView) {
          const runFullScan = async () => {
            const pluginState = spellCheckPluginKey.getState(editorView.state) as SpellCheckPluginState | undefined;
            if (!pluginState?.enabled) return;
            if (!spellChecker.isReady()) {
              const ok = await spellChecker.whenReady();
              if (!ok) return;
              const ps = spellCheckPluginKey.getState(editorView.state) as SpellCheckPluginState | undefined;
              if (!ps?.enabled) return;
            }
            const { doc } = editorView.state;
            const decorations = buildSpellDecorationsFull(doc);
            const decorationSet = DecorationSet.create(doc, decorations);
            const tr = editorView.state.tr.setMeta(spellCheckPluginKey, { decorations: decorationSet });
            editorView.dispatch(tr);
          };

          // Kick off dictionary load eagerly so it's ready when the user starts typing.
          spellChecker.init().catch(() => {});

          // Rescan when spelling settings change (e.g. user toggles proper-noun flagging).
          const unsubStore = useEditorStore.subscribe((next, prev) => {
            if (next.spellingSettings === prev.spellingSettings) return;
            const ps = spellCheckPluginKey.getState(editorView.state) as SpellCheckPluginState | undefined;
            if (!ps?.enabled) return;
            runFullScan();
          });

          // Rescan when the dictionary contents change (project words added/removed,
          // global library mutated, or enabled-set toggled).
          const unsubDict = spellChecker.onChange(() => {
            const ps = spellCheckPluginKey.getState(editorView.state) as SpellCheckPluginState | undefined;
            if (!ps?.enabled) return;
            runFullScan();
          });

          return {
            update(view: EditorView, prevState: EditorState) {
              const pluginState = spellCheckPluginKey.getState(view.state) as SpellCheckPluginState | undefined;
              if (!pluginState?.enabled) return;

              const prevPluginState = spellCheckPluginKey.getState(prevState) as SpellCheckPluginState | undefined;
              const justEnabled = pluginState.enabled && !prevPluginState?.enabled;

              // Only the initial enable triggers a full scan. Subsequent edits are handled incrementally in apply().
              // If the dictionary wasn't ready when an edit landed, we'll catch up via this same path on the next change.
              const dictWasNotReady =
                view.state.doc !== prevState.doc &&
                pluginState.decorations.find().length === 0 &&
                !spellChecker.isReady();
              if (justEnabled || dictWasNotReady) {
                if (initialScanTimeout) clearTimeout(initialScanTimeout);
                initialScanTimeout = setTimeout(runFullScan, justEnabled ? 100 : 300);
              }
            },
            destroy() {
              unsubStore();
              unsubDict();
              if (initialScanTimeout) clearTimeout(initialScanTimeout);
            },
          };
        },
      }),
    ];
  },
});
