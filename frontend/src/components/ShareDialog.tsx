import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import type { CollabSession } from '../services/api';
import { showToast } from './Toast';

interface ShareDialogProps {
  projectId: string;
  scriptId: string;
  scriptTitle: string;
  isCollabActive: boolean;
  onStartCollab: (session: CollabSession) => void;
  onClose: () => void;
}

const ShareDialog: React.FC<ShareDialogProps> = ({
  projectId,
  scriptId,
  scriptTitle,
  isCollabActive,
  onStartCollab,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState<CollabSession[]>([]);
  const [generating, setGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.listCollabSessions(projectId, scriptId)
      .then(setSessions)
      .catch(() => {});
  }, [projectId, scriptId]);

  const handleGenerate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setGenerating(true);
    try {
      const session = await api.createCollabInvite(projectId, scriptId, trimmed);
      setSessions((prev) => [...prev, session]);
      setName('');
      inputRef.current?.focus();
      showToast(`Invite created for ${trimmed}`, 'success');

      // When first invite is created, start collab for the owner too
      if (!isCollabActive) {
        onStartCollab(session);
      }
    } catch (err) {
      showToast(`Failed to create invite: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await api.revokeCollabSession(token);
      setSessions((prev) => prev.filter((s) => s.token !== token));
    } catch {
      showToast('Failed to revoke invite', 'error');
    }
  };

  const handleRevokeAll = async () => {
    try {
      await api.revokeAllCollabSessions(projectId, scriptId);
      setSessions([]);
    } catch {
      showToast('Failed to revoke invites', 'error');
    }
  };

  const copyLink = (token: string) => {
    const link = `${window.location.origin}/collab/${token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      handleGenerate();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header">
          Collaborate — {scriptTitle}
        </div>

        <div className="dialog-body">
          {isCollabActive && (
            <div className="collab-status-badge">
              <span className="collab-dot" /> Live collaboration active
            </div>
          )}

          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--fd-text-secondary, #888)' }}>
            Generate a link for each collaborator. They can open the link to join a live editing session.
          </p>

          <label className="dialog-label">Invite a collaborator</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="dialog-input"
              style={{ flex: 1 }}
              placeholder="Person's name (e.g., John)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={generating}
            />
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleGenerate}
              disabled={!name.trim() || generating}
            >
              {generating ? 'Creating...' : 'Generate Link'}
            </button>
          </div>

          {sessions.length > 0 && (
            <div className="collab-sessions-list">
              <label className="dialog-label" style={{ marginTop: 16 }}>
                Active invites ({sessions.length})
              </label>
              {sessions.map((s) => (
                <div key={s.token} className="collab-session-item">
                  <div className="collab-session-info">
                    <span className="collab-session-name">{s.collaborator_name}</span>
                    <span className="collab-session-date">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="collab-session-actions">
                    <button
                      className="collab-copy-btn"
                      onClick={() => copyLink(s.token)}
                      title="Copy invite link"
                    >
                      {copiedToken === s.token ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      className="collab-revoke-btn"
                      onClick={() => handleRevoke(s.token)}
                      title="Revoke this invite"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {sessions.length > 1 && (
            <button
              className="dialog-btn"
              style={{ color: '#e06060' }}
              onClick={handleRevokeAll}
            >
              Revoke All
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;
