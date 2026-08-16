/**
 * Offers to bring an older script up to the standard two blank lines before a
 * scene heading (issue #76).
 *
 * OpenDraft used to render and paginate one blank line while its own FDX and
 * OSF exporters wrote two — so a script sent to Final Draft came back longer
 * than the app had shown. Fixing that changes where pages break, which is not
 * something to do to a draft behind the writer's back: a script mid-submission
 * has a page count someone is counting on.
 *
 * So the change is offered rather than applied. Asked once per document, and
 * the answer is saved either way, so a writer who says no is never asked again.
 * Deliberately sequenced after the recovery prompt (#68) — the same reporter
 * pointed out that stacking launch dialogs trains people to dismiss them.
 */
import React, { useEffect, useRef, useState } from 'react';

interface Props {
  /** Raised once the writer answers: true to adopt the standard spacing. */
  onAnswer: (adoptStandard: boolean) => void;
}

const SceneSpacingPromptDialog: React.FC<Props> = ({ onAnswer }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    // Focus the primary action so Enter accepts and Escape keeps — both without
    // reaching for the mouse mid-sentence.
    const btn = boxRef.current?.querySelector<HTMLElement>('.dialog-btn-primary');
    btn?.focus();
  }, []);

  const answer = (adoptStandard: boolean) => {
    if (answered) return;
    setAnswered(true);
    onAnswer(adoptStandard);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      // Escape is the conservative answer: change nothing about the draft.
      answer(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = boxRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (answered) return null;

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div
        className="dialog-box"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-spacing-dialog-title"
        ref={boxRef}
      >
        <div className="dialog-header" id="scene-spacing-dialog-title">
          Use standard scene heading spacing?
        </div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>
            This script puts <strong>one blank line</strong> before each scene
            heading. Industry standard — and Final Draft&rsquo;s default — is{' '}
            <strong>two</strong>.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted)' }}>
            Reformatting changes where pages break, so the script will get
            slightly longer. You can change it at any time under Format &rsaquo;
            Formatting Template, and this script keeps whichever you choose.
          </p>
        </div>
        <div className="dialog-footer" style={{ display: 'flex', gap: 8 }}>
          <button className="dialog-btn" onClick={() => answer(false)}>
            Keep one line
          </button>
          <div style={{ flex: 1 }} />
          <button className="dialog-btn dialog-btn-primary" onClick={() => answer(true)}>
            Reformat
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneSpacingPromptDialog;
