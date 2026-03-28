import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { spellChecker } from '../editor/spellchecker';
import { spellCheckPluginKey } from '../editor/extensions/SpellCheck';

interface SpellError {
  word: string;
  from: number;
  to: number;
  context: string;
}

interface SpellCheckModalProps {
  editor: Editor;
  onClose: () => void;
}

const SpellCheckModal: React.FC<SpellCheckModalProps> = ({ editor, onClose }) => {
  const [errors, setErrors] = useState<SpellError[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [replacementText, setReplacementText] = useState('');
  const [complete, setComplete] = useState(false);
  const [focused, setFocused] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Dragging state
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const dragRef = useRef<{ dragging: boolean; offsetX: number; offsetY: number }>({
    dragging: false, offsetX: 0, offsetY: 0,
  });

  // Initialize position to top-right
  useEffect(() => {
    setPosition({ x: window.innerWidth - 560, y: 80 });
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      dragging: true,
      offsetX: e.clientX - position.x,
      offsetY: e.clientY - position.y,
    };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      setPosition({
        x: e.clientX - dragRef.current.offsetX,
        y: e.clientY - dragRef.current.offsetY,
      });
    };
    const handleMouseUp = () => { dragRef.current.dragging = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Focus tracking — go transparent when clicking outside
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      if (modalRef.current?.contains(e.target as Node)) {
        setFocused(true);
      } else {
        setFocused(false);
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (modalRef.current?.contains(e.target as Node)) {
        setFocused(true);
      } else {
        setFocused(false);
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const rescan = useCallback(() => {
    return spellChecker.findAllErrors(editor.state.doc);
  }, [editor]);

  // Initial scan
  useEffect(() => {
    const found = rescan();
    if (found.length === 0) {
      setComplete(true);
      return;
    }
    setErrors(found);
    setCurrentIndex(0);
    const sugs = spellChecker.suggest(found[0].word);
    setSuggestions(sugs);
    setSelectedSuggestion(0);
    setReplacementText(sugs[0] || found[0].word);
    editor.chain().setTextSelection({ from: found[0].from, to: found[0].to }).scrollIntoView().run();
  }, [editor, rescan]);

  const currentError = errors[currentIndex] as SpellError | undefined;

  const goToError = useCallback((errs: SpellError[], idx: number) => {
    if (idx >= errs.length) {
      setComplete(true);
      return;
    }
    setCurrentIndex(idx);
    const err = errs[idx];
    const sugs = spellChecker.suggest(err.word);
    setSuggestions(sugs);
    setSelectedSuggestion(0);
    setReplacementText(sugs[0] || err.word);
    editor.chain().setTextSelection({ from: err.from, to: err.to }).scrollIntoView().run();
  }, [editor]);

  const triggerRecheck = useCallback(() => {
    const { tr } = editor.state;
    tr.setMeta(spellCheckPluginKey, { toggle: false });
    editor.view.dispatch(tr);
    requestAnimationFrame(() => {
      const tr2 = editor.state.tr;
      tr2.setMeta(spellCheckPluginKey, { toggle: true });
      editor.view.dispatch(tr2);
    });
  }, [editor]);

  const handleChange = useCallback(() => {
    if (!currentError) return;
    editor.chain().focus()
      .command(({ tr }) => { tr.insertText(replacementText, currentError.from, currentError.to); return true; })
      .run();
    setTimeout(() => {
      const found = rescan();
      setErrors(found);
      if (found.length === 0) { setComplete(true); triggerRecheck(); return; }
      goToError(found, Math.min(currentIndex, found.length - 1));
      triggerRecheck();
    }, 100);
  }, [currentError, replacementText, editor, rescan, currentIndex, goToError, triggerRecheck]);

  const handleChangeAll = useCallback(() => {
    if (!currentError) return;
    const word = currentError.word;
    const { tr } = editor.state;
    const allErrors = errors.filter(e => e.word.toLowerCase() === word.toLowerCase());
    for (let i = allErrors.length - 1; i >= 0; i--) {
      tr.insertText(replacementText, allErrors[i].from, allErrors[i].to);
    }
    editor.view.dispatch(tr);
    setTimeout(() => {
      const found = rescan();
      setErrors(found);
      if (found.length === 0) { setComplete(true); triggerRecheck(); return; }
      goToError(found, 0);
      triggerRecheck();
    }, 100);
  }, [currentError, replacementText, errors, editor, rescan, goToError, triggerRecheck]);

  const handleIgnore = useCallback(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= errors.length) { setComplete(true); return; }
    goToError(errors, nextIdx);
  }, [currentIndex, errors, goToError]);

  const handleIgnoreAll = useCallback(() => {
    if (!currentError) return;
    spellChecker.ignoreWord(currentError.word);
    const found = rescan();
    setErrors(found);
    if (found.length === 0) { setComplete(true); triggerRecheck(); return; }
    goToError(found, Math.min(currentIndex, found.length - 1));
    triggerRecheck();
  }, [currentError, rescan, currentIndex, goToError, triggerRecheck]);

  const handleAddToDictionary = useCallback(() => {
    if (!currentError) return;
    spellChecker.addToCustomDictionary(currentError.word);
    const found = rescan();
    setErrors(found);
    if (found.length === 0) { setComplete(true); triggerRecheck(); return; }
    goToError(found, Math.min(currentIndex, found.length - 1));
    triggerRecheck();
  }, [currentError, rescan, currentIndex, goToError, triggerRecheck]);

  const handleRecheck = useCallback(() => {
    setComplete(false);
    const found = rescan();
    if (found.length === 0) { setComplete(true); return; }
    setErrors(found);
    goToError(found, 0);
    triggerRecheck();
  }, [rescan, goToError, triggerRecheck]);

  const handleSuggestionClick = useCallback((idx: number) => {
    setSelectedSuggestion(idx);
    setReplacementText(suggestions[idx]);
  }, [suggestions]);

  if (position.x < 0) return null;

  if (complete) {
    return (
      <div
        ref={modalRef}
        className={`spell-modal spell-modal-floating${focused ? '' : ' spell-modal-inactive'}`}
        style={{ left: position.x, top: position.y }}
      >
        <div className="spell-modal-header" onMouseDown={handleMouseDown}>
          <span>Spelling</span>
        </div>
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>&#10003;</div>
          <div style={{ color: 'var(--fd-text)', fontSize: 14 }}>Spelling check is complete.</div>
        </div>
        <div className="spell-modal-actions">
          <div className="spell-modal-actions-col">
            <button onClick={handleRecheck}>Recheck</button>
          </div>
          <div className="spell-modal-actions-col">
            <button className="dialog-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={modalRef}
      className={`spell-modal spell-modal-floating${focused ? '' : ' spell-modal-inactive'}`}
      style={{ left: position.x, top: position.y }}
      onClick={() => setFocused(true)}
    >
      <div className="spell-modal-header" onMouseDown={handleMouseDown}>
        <span>Spelling: {errors.length} issue{errors.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>{currentIndex + 1} / {errors.length}</span>
      </div>

      <div className="spell-modal-body">
        <div className="spell-modal-section">
          <label className="spell-modal-label">Not in Dictionary:</label>
          <div className="spell-modal-context">
            {currentError && (
              <span dangerouslySetInnerHTML={{
                __html: currentError.context.replace(
                  new RegExp(`\\b${currentError.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
                  `<span class="spell-modal-error-word">${currentError.word}</span>`
                ),
              }} />
            )}
          </div>
        </div>

        <div className="spell-modal-section">
          <label className="spell-modal-label">Change to:</label>
          <input
            ref={inputRef}
            type="text"
            className="spell-modal-input"
            value={replacementText}
            onChange={e => setReplacementText(e.target.value)}
          />
        </div>

        <div className="spell-modal-section">
          <label className="spell-modal-label">Suggestions:</label>
          <div className="spell-modal-suggestions">
            {suggestions.length === 0 ? (
              <div className="spell-modal-no-suggestions">(no suggestions)</div>
            ) : (
              suggestions.map((s, i) => (
                <div
                  key={s}
                  className={`spell-modal-suggestion${i === selectedSuggestion ? ' selected' : ''}`}
                  onClick={() => handleSuggestionClick(i)}
                  onDoubleClick={() => { handleSuggestionClick(i); handleChange(); }}
                >
                  {s}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="spell-modal-actions">
        <div className="spell-modal-actions-col">
          <button onClick={handleIgnore}>Ignore Once</button>
          <button onClick={handleIgnoreAll}>Ignore All</button>
          <button onClick={handleAddToDictionary}>Add to Dictionary</button>
        </div>
        <div className="spell-modal-actions-col">
          <button className="dialog-primary" onClick={handleChange}>Change</button>
          <button onClick={handleChangeAll}>Change All</button>
          <button onClick={handleRecheck}>Recheck</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default SpellCheckModal;
