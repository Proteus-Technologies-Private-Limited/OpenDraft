import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import type { CollabSession } from '../services/api';
import { getCollabWsUrl } from '../config';
import { platformFetch } from '../services/platform';
import { showToast } from './Toast';

interface JoinCollabDialogProps {
  onJoin: (session: CollabSession, token: string, collabServerUrl?: string) => void;
  onClose: () => void;
}

/**
 * Extract the collab token and collab server URL from a pasted invite link.
 * Supports formats:
 *   - Full URL: http://192.168.1.102:4000/collab/TOKEN
 *   - Full URL: https://collab.example.com/collab/TOKEN
 *   - Path only: /collab/TOKEN
 *   - Raw token: TOKEN
 *
 * Returns { token, collabServerUrl } where collabServerUrl is the WebSocket URL
 * of the collab server (e.g. "ws://192.168.1.102:4000") or null for raw tokens.
 */
function extractTokenAndServer(input: string): { token: string; collabServerUrl: string | null } {
  const trimmed = input.trim();
  // Try to match /collab/<token> in a URL or path
  const match = trimmed.match(/\/collab\/([A-Za-z0-9_-]+)/);
  if (match) {
    // Try to extract the collab server URL from the full URL
    try {
      const url = new URL(trimmed);
      // Convert http(s) origin to ws(s) URL for the collab server
      const wsUrl = url.origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
      return { token: match[1], collabServerUrl: wsUrl };
    } catch {
      // Path only — no origin available
      return { token: match[1], collabServerUrl: null };
    }
  }
  // If no slashes, treat the whole thing as a raw token
  if (!trimmed.includes('/') && trimmed.length > 10) return { token: trimmed, collabServerUrl: null };
  return { token: trimmed, collabServerUrl: null };
}

const JoinCollabDialog: React.FC<JoinCollabDialogProps> = ({ onJoin, onClose }) => {
  const [linkInput, setLinkInput] = useState('');
  const [joining, setJoining] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleJoin = async () => {
    const { token, collabServerUrl } = extractTokenAndServer(linkInput);
    console.log('[JoinCollab] Extracted:', { token: token?.slice(0, 8) + '...', collabServerUrl });
    if (!token) {
      showToast('Please paste a collaboration link or token', 'error');
      return;
    }

    setJoining(true);
    try {
      let session: CollabSession | null = null;

      // Use the collab server URL extracted from the invite link if available,
      // otherwise fall back to the local setting.
      const wsUrl = collabServerUrl || getCollabWsUrl();
      const collabHttpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      console.log('[JoinCollab] Step 1: trying collab server at', collabHttpUrl);
      try {
        const res = await platformFetch(`${collabHttpUrl}/api/collab/session/${token}`);
        console.log('[JoinCollab] Step 1 response:', res.status);
        if (res.ok) {
          session = await res.json();
          console.log('[JoinCollab] Step 1 session found:', session?.project_id);
        } else {
          const errBody = await res.text().catch(() => '');
          console.warn('[JoinCollab] Step 1 failed:', res.status, errBody);
        }
      } catch (err) {
        console.error('[JoinCollab] Step 1 error (collab server unreachable):', err);
      }

      // Fall back to the local backend
      if (!session) {
        console.log('[JoinCollab] Step 2: falling back to api.validateCollabSession');
        try {
          session = await api.validateCollabSession(token);
          console.log('[JoinCollab] Step 2 session found:', session?.project_id);
        } catch (err) {
          console.error('[JoinCollab] Step 2 failed:', err);
          throw err;
        }
      }

      onJoin(session, token, collabServerUrl || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[JoinCollab] All attempts failed:', msg);
      showToast(`Failed to join: ${msg}`, 'error');
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
