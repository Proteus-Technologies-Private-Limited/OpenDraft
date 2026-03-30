import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import type { CollabSession } from '../services/api';
import { showToast } from './Toast';

interface JoinCollabDialogProps {
  onJoin: (session: CollabSession, token: string) => void;
  onClose: () => void;
}

/**
 * Extract the collab token from a pasted link or raw token.
 * Supports formats:
 *   - Full URL: http://localhost:8000/collab/TOKEN
 *   - Full URL: https://example.com/collab/TOKEN
 *   - Path only: /collab/TOKEN
 *   - Raw token: TOKEN
 */
function extractToken(input: string): string {
  const trimmed = input.trim();
  // Try to match /collab/<token> in a URL or path
  const match = trimmed.match(/\/collab\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  // If no slashes, treat the whole thing as a raw token
  if (!trimmed.includes('/') && trimmed.length > 10) return trimmed;
  return trimmed;
}

const JoinCollabDialog: React.FC<JoinCollabDialogProps> = ({ onJoin, onClose }) => {
  const [linkInput, setLinkInput] = useState('');
  const [joining, setJoining] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleJoin = async () => {
    const token = extractToken(linkInput);
    if (!token) {
      showToast('Please paste a collaboration link or token', 'error');
      return;
    }

    setJoining(true);
    try {
      const session = await api.validateCollabSession(token);
      onJoin(session, token);
    } catch {
      showToast('Invalid or expired collaboration link', 'error');
    } finally {
      setJoining(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && linkInput.trim()) {
      handleJoin();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        style={{ maxWidth: 500 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header">
          Join Collaboration Session
        </div>

        <div className="dialog-body">
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--fd-text-muted)' }}>
            Paste the collaboration link or token you received from the session host.
          </p>

          <div className="settings-field">
            <label>Collaboration Link or Token</label>
            <input
              ref={inputRef}
              className="dialog-input"
              style={{ fontSize: 14, height: 40, padding: '0 12px' }}
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://example.com/collab/... or paste token"
              disabled={joining}
            />
          </div>
        </div>

        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
          <button
            className="dialog-btn dialog-btn-primary"
            style={{ background: 'var(--fd-accent)', color: '#fff', border: 'none', fontWeight: 600 }}
            onClick={handleJoin}
            disabled={!linkInput.trim() || joining}
          >
            {joining ? 'Joining...' : 'Join Session'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default JoinCollabDialog;
