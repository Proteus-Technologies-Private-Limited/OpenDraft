import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useEditorStore } from '../stores/editorStore';

const searchPluginKey = new PluginKey('searchHighlight');

interface MatchResult {
  from: number;
  to: number;
}

/** Walk the ProseMirror doc and build a flat text string + a position map
 *  so we can do plain-string search and map results back to PM positions. */
function buildTextMap(doc: import('@tiptap/pm/state').EditorState['doc']) {
  let text = '';
  const map: number[] = []; // map[flatIndex] → PM position

  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text!;
      for (let i = 0; i < t.length; i++) {
        map.push(pos + i);
      }
      text += t;
    } else if (node.isBlock && text.length > 0) {
      // Insert a sentinel so searches don't span across blocks
      map.push(-1);
      text += '\n';
    }
  });

  return { text, map };
}

function findAllMatches(
  doc: import('@tiptap/pm/state').EditorState['doc'],
  searchTerm: string,
  matchCase: boolean,
  wholeWord: boolean,
): MatchResult[] {
  if (!searchTerm) return [];

  const { text, map } = buildTextMap(doc);
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? searchTerm : searchTerm.toLowerCase();
  const results: MatchResult[] = [];

  if (wholeWord) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, matchCase ? 'g' : 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      const from = map[m.index];
      const to = map[m.index + needle.length - 1] + 1;
      if (from >= 0 && to > from) results.push({ from, to });
    }
  } else {
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      const from = map[idx];
      const to = map[idx + needle.length - 1] + 1;
      if (from >= 0 && to > from) results.push({ from, to });
      idx += 1;
    }
  }

  return results;
}

/** Create the search-highlight ProseMirror plugin (once). */
export function createSearchPlugin() {
  return new Plugin({
    key: searchPluginKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, old) {
        const meta = tr.getMeta(searchPluginKey);
        if (meta !== undefined) return meta;
        // Map existing decorations through document changes
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations(state) {
        return searchPluginKey.getState(state);
      },
    },
  });
}

interface SearchReplaceProps {
  editor: Editor | null;
}

const SearchReplace: React.FC<SearchReplaceProps> = ({ editor }) => {
  const { searchOpen, setSearchOpen } = useEditorStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (searchOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [searchOpen]);

  // Clear highlights when panel closes
  useEffect(() => {
    if (!searchOpen && editor) {
      clearDecorations();
      setSearchTerm('');
      setReplaceTerm('');
      setMatches([]);
      setCurrentIndex(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  const clearDecorations = useCallback(() => {
    if (!editor) return;
    const { tr } = editor.state;
    tr.setMeta(searchPluginKey, DecorationSet.empty);
    editor.view.dispatch(tr);
  }, [editor]);

  const updateDecorations = useCallback(
    (found: MatchResult[], activeIdx: number) => {
      if (!editor) return;
      const decorations = found.map((m, i) =>
        Decoration.inline(m.from, m.to, {
          class: i === activeIdx ? 'search-highlight-current' : 'search-highlight',
        }),
      );
      const { tr } = editor.state;
      tr.setMeta(
        searchPluginKey,
        DecorationSet.create(editor.state.doc, decorations),
      );
      editor.view.dispatch(tr);
    },
    [editor],
  );

  // Re-run search whenever term/options change
  useEffect(() => {
    if (!editor || !searchOpen) return;
    const found = findAllMatches(editor.state.doc, searchTerm, matchCase, wholeWord);
    setMatches(found);
    const idx = found.length > 0 ? 0 : -1;
    setCurrentIndex(idx);
    updateDecorations(found, idx);
    if (found.length > 0) {
      scrollToMatch(found[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, matchCase, wholeWord, editor, searchOpen]);

  // Also refresh when editor content changes
  useEffect(() => {
    if (!editor || !searchOpen || !searchTerm) return;
    const onUpdate = () => {
      const found = findAllMatches(editor.state.doc, searchTerm, matchCase, wholeWord);
      setMatches(found);
      setCurrentIndex((prev) => {
        const next = Math.min(prev, found.length - 1);
        const idx = next >= 0 ? next : found.length > 0 ? 0 : -1;
        updateDecorations(found, idx);
        return idx;
      });
    };
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); };
  }, [editor, searchOpen, searchTerm, matchCase, wholeWord, updateDecorations]);

  const scrollToMatch = useCallback(
    (match: MatchResult) => {
      if (!editor) return;
      // Select the match text so the user sees it
      editor.chain().setTextSelection({ from: match.from, to: match.to }).run();
      // Scroll into view
      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(match.from);
        const scrollEl = editor.view.dom.closest('.editor-main');
        if (scrollEl) {
          const rect = scrollEl.getBoundingClientRect();
          const target = scrollEl.scrollTop + (coords.top - rect.top) - rect.height / 3;
          scrollEl.scrollTo({ top: target, behavior: 'smooth' });
        }
      });
    },
    [editor],
  );

  const findNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = currentIndex < matches.length - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(next);
    updateDecorations(matches, next);
    scrollToMatch(matches[next]);
  }, [matches, currentIndex, updateDecorations, scrollToMatch]);

  const findPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = currentIndex > 0 ? currentIndex - 1 : matches.length - 1;
    setCurrentIndex(prev);
    updateDecorations(matches, prev);
    scrollToMatch(matches[prev]);
  }, [matches, currentIndex, updateDecorations, scrollToMatch]);

  const replaceOne = useCallback(() => {
    if (!editor || matches.length === 0 || currentIndex < 0) return;
    const match = matches[currentIndex];

    // Replace the current match
    editor
      .chain()
      .setTextSelection({ from: match.from, to: match.to })
      .deleteSelection()
      .insertContent(replaceTerm)
      .run();

    // Re-search after replacement
    const found = findAllMatches(editor.state.doc, searchTerm, matchCase, wholeWord);
    setMatches(found);
    const nextIdx = found.length > 0 ? Math.min(currentIndex, found.length - 1) : -1;
    setCurrentIndex(nextIdx);
    updateDecorations(found, nextIdx);
    if (nextIdx >= 0) scrollToMatch(found[nextIdx]);
  }, [editor, matches, currentIndex, replaceTerm, searchTerm, matchCase, wholeWord, updateDecorations, scrollToMatch]);

  const replaceAll = useCallback(() => {
    if (!editor || matches.length === 0) return;

    // Apply replacements in reverse order to keep positions valid
    const { tr } = editor.state;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { from, to } = matches[i];
      if (replaceTerm) {
        tr.replaceWith(from, to, editor.state.schema.text(replaceTerm));
      } else {
        tr.delete(from, to);
      }
    }
    editor.view.dispatch(tr);

    // Clear results
    const found = findAllMatches(editor.state.doc, searchTerm, matchCase, wholeWord);
    setMatches(found);
    setCurrentIndex(found.length > 0 ? 0 : -1);
    updateDecorations(found, found.length > 0 ? 0 : -1);
  }, [editor, matches, replaceTerm, searchTerm, matchCase, wholeWord, updateDecorations]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+F to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (!searchOpen) return;
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchOpen(false);
        editor?.commands.focus();
        return;
      }
      // Cmd/Ctrl+G or F3 — Find Next
      if (e.key === 'F3' || ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey)) {
        e.preventDefault();
        findNext();
        return;
      }
      // Shift+F3 or Cmd/Ctrl+Shift+G — Find Previous
      if ((e.key === 'F3' && e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.key === 'g' && e.shiftKey)) {
        e.preventDefault();
        findPrev();
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, setSearchOpen, editor, findNext, findPrev]);

  if (!searchOpen) return null;

  return (
    <div className="search-replace-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="search-replace-header">
        <span>Find & Replace</span>
        <button
          className="search-close-btn"
          onClick={() => setSearchOpen(false)}
        >
          ✕
        </button>
      </div>
      <div className="search-replace-body">
        <div className="search-row">
          <label>Find:</label>
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                findPrev();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                findNext();
              }
            }}
            placeholder="Search text..."
          />
          <span className="match-info">
            {searchTerm
              ? `${matches.length > 0 ? currentIndex + 1 : 0} / ${matches.length}`
              : ''}
          </span>
        </div>
        <div className="search-row">
          <label>Replace:</label>
          <input
            type="text"
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceOne();
              }
            }}
            placeholder="Replace with..."
          />
        </div>
        <div className="search-options">
          <label className="search-checkbox">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
            Match Case
          </label>
          <label className="search-checkbox">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
            />
            Whole Word
          </label>
        </div>
        <div className="search-actions">
          <button onClick={findPrev} disabled={!searchTerm || matches.length === 0}>
            ◀ Prev
          </button>
          <button onClick={findNext} disabled={!searchTerm || matches.length === 0}>
            Next ▶
          </button>
          <button onClick={replaceOne} disabled={!searchTerm || matches.length === 0}>
            Replace
          </button>
          <button onClick={replaceAll} disabled={!searchTerm || matches.length === 0}>
            Replace All
          </button>
        </div>
      </div>
    </div>
  );
};

export default SearchReplace;
