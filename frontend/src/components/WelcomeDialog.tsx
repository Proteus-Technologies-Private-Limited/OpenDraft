import React from 'react';

interface WelcomeDialogProps {
  onClose: () => void;
}

const WelcomeDialog: React.FC<WelcomeDialogProps> = ({ onClose }) => {
  return (
    <div className="dialog-overlay" onClick={onClose}>
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

        <button className="welcome-start-btn" onClick={onClose}>
          Start Writing
        </button>

        <p className="welcome-footer">
          Import scripts via <strong>File &gt; Import</strong> &middot; Explore features in the menus above
        </p>
      </div>
    </div>
  );
};

export default WelcomeDialog;
