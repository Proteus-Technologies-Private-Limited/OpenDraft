import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { spellChecker } from '../editor/spellchecker';
import { spellCheckPluginKey } from '../editor/extensions/SpellCheck';

interface SpellError {
  word: string;
  from: number;
  to: number;
  context: string;
  contextKey: string;
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
  const [dictError, setDictError] = useState(false);
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

  // Clear the active highlight in the editor when the modal closes
  useEffect(() => {
    return () => {
      if (!editor.isDestroyed) {
        const tr = editor.state.tr.setMeta(spellCheckPluginKey, { activeRange: null });
        editor.view.dispatch(tr);
      }
    };
  }, [editor]);

  const rescan = useCallback(() => {
    return spellChecker.findAllErrors(editor.state.doc);
  }, [editor]);

  // Initial scan — wait for dictionary to load first
  useEffect(() => {
    let cancelled = false;
    const doScan = async () => {
      const ready = await spellChecker.whenReady();
      if (cancelled) return;
      if (!ready) {
        setDictError(true);
        return;
      }
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
      // Single transaction: highlight active word + scroll into view
      const tr = editor.state.tr;
      tr.setMeta(spellCheckPluginKey, { activeRange: { from: found[0].from, to: found[0].to } });
      tr.setSelection(TextSelection.near(editor.state.doc.resolve(found[0].from)));
      tr.scrollIntoView();
      editor.view.dispatch(tr);
    };
    doScan();
    return () => { cancelled = true; };
  }, [editor, rescan]);

  const currentError = errors[currentIndex] as SpellError | undefined;

  /** Navigate to an error: highlight it in the editor, update suggestions, scroll into view. */
  const goToError = useCallback((errs: SpellError[], idx: number) => {
    if (errs.length === 0 || idx < 0 || idx >= errs.length) {
      setComplete(true);
      // Clear active highlight and rebuild plain spell-error decorations
      const tr = editor.state.tr.setMeta(spellCheckPluginKey, { activeRange: null });
      editor.view.dispatch(tr);
      return;
    }
    setCurrentIndex(idx);
    const err = errs[idx];
    const sugs = spellChecker.suggest(err.word);
    setSuggestions(sugs);
    setSelectedSuggestion(0);
    setReplacementText(sugs[0] || err.word);
    // Single transaction: set active highlight + scroll into view
    // activeRange rebuilds ALL decorations, so no separate triggerRecheck needed
    const tr = editor.state.tr;
    tr.setMeta(spellCheckPluginKey, { activeRange: { from: err.from, to: err.to } });
    tr.setSelection(TextSelection.near(editor.state.doc.resolve(err.from)));
    tr.scrollIntoView();
    editor.view.dispatch(tr);
  }, [editor]);

  const handleChange = useCallback(() => {
    if (!currentError) return;
    const { tr } = editor.state;
    tr.insertText(replacementText, currentError.from, currentError.to);
    editor.view.dispatch(tr);
    setTimeout(() => {
      const found = rescan();
      setErrors(found);
      goToError(found, Math.min(currentIndex, found.length - 1));
    }, 100);
  }, [currentError, replacementText, editor, rescan, currentIndex, goToError]);

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
      goToError(found, 0);
    }, 100);
  }, [currentError, replacementText, errors, editor, rescan, goToError]);

  const handleIgnore = useCallback(() => {
    if (!currentError) return;
    // Ignore this specific occurrence (persisted with the document)
    spellChecker.ignoreOnce(currentError.word, currentError.contextKey);
    const found = rescan();
    setErrors(found);
    goToError(found, Math.min(currentIndex, found.length - 1));
  }, [currentError, currentIndex, rescan, goToError]);

  const handleIgnoreAll = useCallback(() => {
    if (!currentError) return;
    spellChecker.ignoreWord(currentError.word);
    const found = rescan();
    setErrors(found);
    goToError(found, Math.min(currentIndex, found.length - 1));
  }, [currentError, rescan, currentIndex, goToError]);

  const handleAddToDictionary = useCallback(() => {
    if (!currentError) return;
    spellChecker.addToCustomDictionary(currentError.word);
    const found = rescan();
    setErrors(found);
    goToError(found, Math.min(currentIndex, found.length - 1));
  }, [currentError, rescan, currentIndex, goToError]);

  const handleRecheck = useCallback(() => {
    setComplete(false);
    const found = rescan();
    if (found.length === 0) { setComplete(true); return; }
    setErrors(found);
    goToError(found, 0);
  }, [rescan, goToError]);

  const handleSuggestionClick = useCallback((idx: number) => {
    setSelectedSuggestion(idx);
    setReplacementText(suggestions[idx]);
  }, [suggestions]);

  if (position.x < 0) return null;

  if (dictError) {
    return (
      <div
        ref={modalRef}
        className="spell-modal spell-modal-floating"
        style={{ left: position.x, top: position.y }}
      >
        <div className="spell-modal-header" onMouseDown={handleMouseDown}>
          <span>Spelling</span>
        </div>
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>&#9888;</div>
          <div style={{ color: 'var(--fd-text)', fontSize: 14 }}>
            Dictionary could not be loaded.<br />
            <span style={{ fontSize: 12, color: 'var(--fd-text-muted)' }}>Spell check is not available in this environment.</span>
          </div>
        </div>
        <div className="spell-modal-actions">
          <div className="spell-modal-actions-col" />
          <div className="spell-modal-actions-col">
            <button className="dialog-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (complete) {
    return (
      <div
        ref={modalRef}
        className="spell-modal spell-modal-floating"
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
      tabIndex={-1}
      className="spell-modal spell-modal-floating"
      style={{ left: position.x, top: position.y }}
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
