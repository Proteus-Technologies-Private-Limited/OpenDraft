import React from 'react';

export type WelcomeChoice = 'blank' | 'sample' | 'import';

interface WelcomeDialogProps {
  onChoice: (choice: WelcomeChoice) => void;
}

const WelcomeDialog: React.FC<WelcomeDialogProps> = ({ onChoice }) => {
  return (
    <div className="dialog-overlay">
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-hero">
          <div className="welcome-logo">OD</div>
          <h1 className="welcome-title">Open Draft</h1>
          <p className="welcome-subtitle">Professional screenwriting, open source.</p>
        </div>

        <div className="welcome-tips">
          <div className="welcome-tip">
            <span className="welcome-tip-icon">&#9998;</span>
            <span>Click the editor and start writing</span>
          </div>
          <div className="welcome-tip">
            <span className="welcome-tip-icon">&#8629;</span>
            <span>Press <kbd>Enter</kbd> on a blank line to pick element type</span>
          </div>
          <div className="welcome-tip">
            <span className="welcome-tip-icon">&#8677;</span>
            <span><kbd>Tab</kbd> cycles Action &rarr; Character &rarr; Dialogue</span>
          </div>
        </div>

        <p className="welcome-choose-label">How would you like to start?</p>

        <div className="welcome-choices">
          <button className="welcome-choice-btn welcome-choice-blank" onClick={() => onChoice('blank')}>
            <span className="welcome-choice-icon">&#128196;</span>
            <span className="welcome-choice-text">
              <strong>Blank Document</strong>
              <small>Start with an empty page</small>
            </span>
          </button>
          <button className="welcome-choice-btn welcome-choice-sample" onClick={() => onChoice('sample')}>
            <span className="welcome-choice-icon">&#127916;</span>
            <span className="welcome-choice-text">
              <strong>Sample Script</strong>
              <small>Explore with a demo screenplay</small>
            </span>
          </button>
          <button className="welcome-choice-btn welcome-choice-import" onClick={() => onChoice('import')}>
            <span className="welcome-choice-icon">&#128194;</span>
            <span className="welcome-choice-text">
              <strong>Import File</strong>
              <small>.fountain, .fdx, or .txt</small>
            </span>
          </button>
        </div>

        <p className="welcome-footer">
          Explore features in the menus above
        </p>
      </div>
    </div>
  );
};

export default WelcomeDialog;
