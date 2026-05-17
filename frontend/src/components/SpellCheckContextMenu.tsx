import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { spellChecker, PROJECT_DICT_TARGET } from '../editor/spellchecker';
import { spellCheckPluginKey } from '../editor/extensions/SpellCheck';
import { useEditorStore } from '../stores/editorStore';

interface SpellCheckContextMenuProps {
  editor: Editor;
  position: { x: number; y: number };
  word: string;
  from: number;
  to: number;
  onClose: () => void;
}

const SpellCheckContextMenu: React.FC<SpellCheckContextMenuProps> = ({
  editor,
  position,
  word,
  from,
  to,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const suggestions = spellChecker.suggest(word);
  const [addOpen, setAddOpen] = useState(false);
  const appendWordToGlobalDictionary = useEditorStore((s) => s.appendWordToGlobalDictionary);
  const activeTargets = spellChecker.getActiveAddTargets();

  // Close on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const triggerRecheck = useCallback(() => {
    // Toggle off and on to force a full re-check
    const { tr } = editor.state;
    tr.setMeta(spellCheckPluginKey, { toggle: false });
    editor.view.dispatch(tr);
    requestAnimationFrame(() => {
      const tr2 = editor.state.tr;
      tr2.setMeta(spellCheckPluginKey, { toggle: true });
      editor.view.dispatch(tr2);
    });
  }, [editor]);

  const handleSuggestion = useCallback(
    (suggestion: string) => {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.insertText(suggestion, from, to);
          return true;
        })
        .run();
      onClose();
      // Re-check after replacement
      setTimeout(triggerRecheck, 200);
    },
    [editor, from, to, onClose, triggerRecheck],
  );

  const handleIgnore = useCallback(() => {
    spellChecker.ignoreWord(word);
    onClose();
    triggerRecheck();
  }, [word, onClose, triggerRecheck]);

  const addWordTo = useCallback(
    (target: string) => {
      if (target === PROJECT_DICT_TARGET) {
        spellChecker.addToProjectDictionary(word);
      } else {
        appendWordToGlobalDictionary(target, word);
      }
      onClose();
      triggerRecheck();
    },
    [word, onClose, triggerRecheck, appendWordToGlobalDictionary],
  );

  const handleAddToDictionary = useCallback(() => {
    if (activeTargets.length === 0) {
      // Fallback: project (re-enable not necessary; addToProjectDictionary stores
      // even if the project dict is currently disabled).
      spellChecker.addToProjectDictionary(word);
      onClose();
      triggerRecheck();
      return;
    }
    if (activeTargets.length === 1) {
      addWordTo(activeTargets[0]);
      return;
    }
    setAddOpen((x) => !x);
  }, [activeTargets, addWordTo, word, onClose, triggerRecheck]);

  // Adjust position to keep menu in viewport
  const adjustedPosition = { ...position };
  if (typeof window !== 'undefined') {
    if (adjustedPosition.x + 200 > window.innerWidth) {
      adjustedPosition.x = window.innerWidth - 210;
    }
    if (adjustedPosition.y + 250 > window.innerHeight) {
      adjustedPosition.y = window.innerHeight - 260;
    }
  }

  const hasMultipleTargets = activeTargets.length > 1;

  return (
    <div
      ref={menuRef}
      className="spell-context-menu"
      style={{ top: adjustedPosition.y, left: adjustedPosition.x }}
    >
      {suggestions.length > 0 ? (
        suggestions.map((s) => (
          <div
            key={s}
            className="spell-context-item suggestion"
            onClick={() => handleSuggestion(s)}
          >
            {s}
          </div>
        ))
      ) : (
        <div className="spell-context-item" style={{ color: 'var(--fd-text-muted)', cursor: 'default' }}>
          No suggestions
        </div>
      )}
      <div className="spell-context-separator" />
      <div className="spell-context-item" onClick={handleIgnore}>
        Ignore
      </div>
      <div
        className="spell-context-item"
        onClick={handleAddToDictionary}
        style={hasMultipleTargets ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } : undefined}
      >
        <span>Add to Dictionary</span>
        {hasMultipleTargets && <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>▸</span>}
      </div>
      {hasMultipleTargets && addOpen && (
        <div style={{ borderTop: '1px solid var(--fd-border)' }}>
          {activeTargets.map((t) => {
            const label = t === PROJECT_DICT_TARGET ? 'Project dictionary' : t;
            return (
              <div
                key={t}
                className="spell-context-item"
                style={{ paddingLeft: 24 }}
                onClick={() => addWordTo(t)}
              >
                {label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SpellCheckContextMenu;
