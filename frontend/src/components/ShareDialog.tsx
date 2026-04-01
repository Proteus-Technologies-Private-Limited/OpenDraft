import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import type { CollabSession } from '../services/api';
import { SERVER_BASE } from '../config';
import { useSettingsStore } from '../stores/settingsStore';
import { collabAuthApi } from '../services/collabAuth';
import { showToast } from './Toast';

interface ShareDialogProps {
  projectId: string;
  scriptId: string;
  scriptTitle: string;
  isCollabActive: boolean;
  onStartCollab: (session: CollabSession) => void;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: '30 min', hours: 0.5 },
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '12 hours', hours: 12 },
  { label: '24 hours', hours: 24 },
  { label: '48 hours', hours: 48 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

function formatExpiry(expiresAt: string): string {
  if (!expiresAt) return '';
  const exp = new Date(expiresAt);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  if (diffMs <= 0) return 'Expired';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m left`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h left`;
  return `${Math.floor(diffHrs / 24)}d left`;
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
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [expiryHours, setExpiryHours] = useState(
    useSettingsStore.getState().defaultInviteExpiry || 1,
  );
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
      // Verify the collab server is reachable before creating an invite
      const serverOk = await collabAuthApi.testConnection();
      if (!serverOk) {
        showToast('Cannot reach the collaboration server. Make sure it is running.', 'error');
        setGenerating(false);
        return;
      }

      // Reuse the session nonce from the first invite so all guests join the same Yjs room
      const existingNonce = sessions.length > 0 ? sessions[0].session_nonce || '' : '';
      const session = await api.createCollabInvite(projectId, scriptId, trimmed, role, expiryHours, existingNonce);
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
    // Use SERVER_BASE for the collab link so it works from Tauri desktop
    // (window.location.origin would give tauri://localhost which isn't a valid URL for collaborators)
    const base = window.location.origin.startsWith('tauri://') ? SERVER_BASE : window.location.origin;
    const link = `${base}/collab/${token}`;
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
        style={{ maxWidth: 560 }}
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

          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--fd-text-muted)' }}>
            Generate a link for each collaborator. They can open the link to join a live editing session.
          </p>

          <label className="dialog-label" style={{ fontSize: 14 }}>Invite a collaborator</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="dialog-input"
              style={{ flex: 1 }}
              placeholder="Person's name (e.g., John)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={generating}
              aria-label="Collaborator name"
            />
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleGenerate}
              disabled={!name.trim() || generating}
            >
              {generating ? 'Creating...' : 'Invite'}
            </button>
          </div>

          {/* Role and expiry options */}
          <div className="collab-invite-options">
            <div className="collab-role-selector">
              <label className="dialog-label" style={{ fontSize: 14, marginTop: 12 }}>Permission</label>
              <div className="collab-role-radios">
                <label className="collab-radio-label">
                  <input
                    type="radio"
                    name="role"
                    value="editor"
                    checked={role === 'editor'}
                    onChange={() => setRole('editor')}
                  />
                  Co-Edit
                </label>
                <label className="collab-radio-label">
                  <input
                    type="radio"
                    name="role"
                    value="viewer"
                    checked={role === 'viewer'}
                    onChange={() => setRole('viewer')}
                  />
                  Read Only
                </label>
              </div>
            </div>

            <div className="collab-expiry-selector">
              <label className="dialog-label" style={{ fontSize: 14, marginTop: 12 }}>Token Valid For</label>
              <select
                className="dialog-input collab-expiry-select"
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                aria-label="Invite expiry duration"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.hours} value={opt.hours}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sessions.length > 0 && (
            <div className="collab-sessions-list">
              <label className="dialog-label" style={{ fontSize: 14, marginTop: 16 }}>
                Active invites ({sessions.length})
              </label>
              {sessions.map((s) => (
                <div key={s.token} className="collab-session-item">
                  <div className="collab-session-info">
                    <span className="collab-session-name">
                      {s.collaborator_name}
                      <span className={`collab-role-badge collab-role-${s.role || 'editor'}`}>
                        {s.role === 'viewer' ? 'Read Only' : 'Co-Edit'}
                      </span>
                    </span>
                    <span className="collab-session-date">
                      {new Date(s.created_at).toLocaleString()}
                      {s.expires_at && (
                        <span className="collab-session-expiry"> · {formatExpiry(s.expires_at)}</span>
                      )}
                    </span>
                  </div>
                  <div className="collab-session-actions">
                    <button
                      className="collab-copy-btn"
                      onClick={() => copyLink(s.token)}
                      title="Copy invite link"
                      aria-label={`Copy invite link for ${s.collaborator_name}`}
                    >
                      {copiedToken === s.token ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      className="collab-revoke-btn"
                      onClick={() => handleRevoke(s.token)}
                      title="Revoke this invite"
                      aria-label={`Revoke invite for ${s.collaborator_name}`}
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
