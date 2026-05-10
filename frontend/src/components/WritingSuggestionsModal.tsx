import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { grammarPluginKey } from '../editor/extensions/Grammar';
import { grammarIgnore, GrammarIgnore } from '../editor/grammar/grammarIgnore';
import { useEditorStore } from '../stores/editorStore';
import { RETEXT_CATEGORY_META } from '../editor/grammar/retextProvider';
import type { GrammarIssue } from '../plugins/registry';

interface WritingSuggestionsModalProps {
  editor: Editor;
  onClose: () => void;
}

const WritingSuggestionsModal: React.FC<WritingSuggestionsModalProps> = ({ editor, onClose }) => {
  const [issues, setIssues] = useState<GrammarIssue[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const setGrammarRuleEnabled = useEditorStore((s) => s.setGrammarRuleEnabled);
  const modalRef = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [positioned, setPositioned] = useState(false);
  const dragRef = useRef<{ dragging: boolean; offsetX: number; offsetY: number }>({
    dragging: false, offsetX: 0, offsetY: 0,
  });

  const clampPosition = useCallback((x: number, y: number) => {
    const modalW = modalRef.current?.offsetWidth || 490;
    const modalH = modalRef.current?.offsetHeight || 380;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.max(0, Math.min(x, vw - Math.min(modalW, vw))),
      y: Math.max(0, Math.min(y, vh - Math.min(modalH, vh))),
    };
  }, []);

  useEffect(() => {
    const preferred = { x: window.innerWidth - 560, y: 80 };
    setPosition(clampPosition(preferred.x, preferred.y));
    setPositioned(true);
  }, [clampPosition]);

  useEffect(() => {
    const handleResize = () => {
      if (dragRef.current.dragging) return;
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = {
      dragging: true,
      offsetX: clientX - position.x,
      offsetY: clientY - position.y,
    };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current.dragging) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      const raw = { x: clientX - dragRef.current.offsetX, y: clientY - dragRef.current.offsetY };
      setPosition(clampPosition(raw.x, raw.y));
    };
    const handlePointerUp = () => { dragRef.current.dragging = false; };
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [clampPosition]);

  // Pull current issues from the plugin state and stay in sync as edits happen.
  useEffect(() => {
    const pull = () => {
      const ps = grammarPluginKey.getState(editor.state) as { issues?: GrammarIssue[] } | undefined;
      const next = ps?.issues ? [...ps.issues].sort((a, b) => a.from - b.from) : [];
      setIssues(next);
      setCurrentIndex((idx) => Math.min(idx, Math.max(0, next.length - 1)));
    };
    pull();
    editor.on('transaction', pull);
    return () => {
      editor.off('transaction', pull);
    };
  }, [editor]);

  // Highlight current issue + scroll into view.
  useEffect(() => {
    if (editor.isDestroyed) return;
    const issue = issues[currentIndex];
    if (!issue) {
      const tr = editor.state.tr.setMeta(grammarPluginKey, { activeRange: null });
      editor.view.dispatch(tr);
      return;
    }
    const tr = editor.state.tr;
    tr.setMeta(grammarPluginKey, { activeRange: { from: issue.from, to: issue.to } });
    try {
      tr.setSelection(TextSelection.near(editor.state.doc.resolve(issue.from)));
      tr.scrollIntoView();
    } catch { /* position may be transiently invalid mid-edit */ }
    editor.view.dispatch(tr);
  }, [editor, issues, currentIndex]);

  // Clear highlight when modal closes.
  useEffect(() => {
    return () => {
      if (editor.isDestroyed) return;
      const tr = editor.state.tr.setMeta(grammarPluginKey, { activeRange: null });
      editor.view.dispatch(tr);
    };
  }, [editor]);

  const currentIssue: GrammarIssue | undefined = issues[currentIndex];

  const goNext = useCallback(() => {
    if (issues.length === 0) return;
    setCurrentIndex((idx) => Math.min(idx + 1, issues.length - 1));
  }, [issues.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const handleApplySuggestion = useCallback((replacement: string) => {
    if (!currentIssue) return;
    const tr = editor.state.tr;
    tr.insertText(replacement, currentIssue.from, currentIssue.to);
    editor.view.dispatch(tr);
    // Issues list will refresh via the transaction subscription. Stay at the
    // same index — after the rescan it will land on the next remaining issue.
  }, [currentIssue, editor]);

  const handleIgnoreOnce = useCallback(() => {
    if (!currentIssue) return;
    const text = editor.state.doc.textBetween(
      Math.max(0, currentIssue.from - 30),
      Math.min(editor.state.doc.content.size, currentIssue.to + 30),
      ' ',
    );
    // Approximate the local index inside that snippet — we strip the leading
    // padding when rebuilding the fingerprint. The fingerprint is forgiving
    // of small whitespace differences.
    const snippetStart = Math.max(0, currentIssue.from - 30);
    const localIdx = currentIssue.from - snippetStart;
    const length = currentIssue.to - currentIssue.from;
    const ctxKey = GrammarIgnore.buildContextKey(text, localIdx, length);
    grammarIgnore.ignoreOnce(currentIssue.ruleId, ctxKey);
    // Force rescan so the ignored issue disappears.
    const tr = editor.state.tr.setMeta(grammarPluginKey, { rescanAll: true });
    editor.view.dispatch(tr);
  }, [currentIssue, editor]);

  const handleIgnoreRuleForDoc = useCallback(() => {
    if (!currentIssue) return;
    grammarIgnore.ignoreRuleForDoc(currentIssue.ruleId);
    const tr = editor.state.tr.setMeta(grammarPluginKey, { rescanAll: true });
    editor.view.dispatch(tr);
  }, [currentIssue, editor]);

  const handleDisableRuleEverywhere = useCallback(() => {
    if (!currentIssue) return;
    setGrammarRuleEnabled(currentIssue.ruleId, false);
    // Store subscriber inside Grammar extension will trigger a rescan automatically.
  }, [currentIssue, setGrammarRuleEnabled]);

  if (!positioned) return null;

  if (issues.length === 0) {
    return (
      <div
        ref={modalRef}
        className="spell-modal spell-modal-floating"
        style={{ left: position.x, top: position.y }}
      >
        <div className="spell-modal-header" onMouseDown={handlePointerDown} onTouchStart={handlePointerDown}>
          <span>Writing Suggestions</span>
        </div>
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>&#10003;</div>
          <div style={{ color: 'var(--fd-text)', fontSize: 14 }}>No writing suggestions found.</div>
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

  const ruleLabel = currentIssue
    ? RETEXT_CATEGORY_META[currentIssue.ruleId as keyof typeof RETEXT_CATEGORY_META]?.label || currentIssue.ruleId
    : '';

  // Build a small context snippet around the issue.
  const contextSnippet = currentIssue
    ? (() => {
        const start = Math.max(0, currentIssue.from - 30);
        const end = Math.min(editor.state.doc.content.size, currentIssue.to + 30);
        const text = editor.state.doc.textBetween(start, end, ' ');
        const offsetIntoSnippet = currentIssue.from - start;
        const issueLen = currentIssue.to - currentIssue.from;
        return {
          before: text.slice(0, offsetIntoSnippet),
          match: text.slice(offsetIntoSnippet, offsetIntoSnippet + issueLen),
          after: text.slice(offsetIntoSnippet + issueLen),
        };
      })()
    : null;

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="spell-modal spell-modal-floating"
      style={{ left: position.x, top: position.y }}
    >
      <div className="spell-modal-header" onMouseDown={handlePointerDown} onTouchStart={handlePointerDown}>
        <span>Writing Suggestions: {issues.length} issue{issues.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>{currentIndex + 1} / {issues.length}</span>
      </div>

      <div className="spell-modal-body">
        <div className="spell-modal-section">
          <label className="spell-modal-label">{ruleLabel}:</label>
          <div className="spell-modal-context">
            {contextSnippet && (
              <>
                <span>{contextSnippet.before}</span>
                <span className="spell-modal-error-word">{contextSnippet.match}</span>
                <span>{contextSnippet.after}</span>
              </>
            )}
          </div>
        </div>

        <div className="spell-modal-section">
          <label className="spell-modal-label">Why:</label>
          <div style={{ fontSize: 13, color: 'var(--fd-text)', lineHeight: 1.4 }}>
            {currentIssue?.message}
          </div>
        </div>

        <div className="spell-modal-section">
          <label className="spell-modal-label">Suggestions:</label>
          <div className="spell-modal-suggestions">
            {!currentIssue?.suggestions || currentIssue.suggestions.length === 0 ? (
              <div className="spell-modal-no-suggestions">(no automatic replacement — edit manually or skip)</div>
            ) : (
              currentIssue.suggestions.map((s, i) => (
                <div
                  key={`${s}-${i}`}
                  className="spell-modal-suggestion"
                  onClick={() => handleApplySuggestion(s)}
                  onDoubleClick={() => handleApplySuggestion(s)}
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
          <button onClick={handleIgnoreOnce}>Ignore Once</button>
          <button onClick={handleIgnoreRuleForDoc}>Ignore in Document</button>
          <button onClick={handleDisableRuleEverywhere}>Disable Rule</button>
        </div>
        <div className="spell-modal-actions-col">
          <button onClick={goPrev} disabled={currentIndex === 0}>Previous</button>
          <button className="dialog-primary" onClick={goNext} disabled={currentIndex >= issues.length - 1}>Next</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default WritingSuggestionsModal;
