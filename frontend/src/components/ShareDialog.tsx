import React, { useState, useEffect, useRef } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDateTime } from '../i18n/format';
import { api } from '../services/api';
import type { CollabSession } from '../services/api';
import { useSettingsStore } from '../stores/settingsStore';
import { collabAuthApi, ensureCollabAuthenticated, collabAuthUnavailableMessage } from '../services/collabAuth';
import { showToast } from './Toast';
import Select from './Select';

interface ShareDialogProps {
  projectId: string;
  scriptId: string;
  scriptTitle: string;
  isCollabActive: boolean;
  onStartCollab: (session: CollabSession) => void;
  onClose: () => void;
}

// Built lazily (never at module scope) so the labels follow the interface language.
function expiryOptions(t: TFunction<'collab'>): Array<{ label: string; hours: number }> {
  return [
    { label: t('share.expiry.m30'), hours: 0.5 },
    { label: t('share.expiry.h1'), hours: 1 },
    { label: t('share.expiry.h6'), hours: 6 },
    { label: t('share.expiry.h12'), hours: 12 },
    { label: t('share.expiry.h24'), hours: 24 },
    { label: t('share.expiry.h48'), hours: 48 },
    { label: t('share.expiry.d7'), hours: 168 },
    { label: t('share.expiry.d30'), hours: 720 },
  ];
}

function formatExpiry(expiresAt: string, t: TFunction<'collab'>): string {
  if (!expiresAt) return '';
  const exp = new Date(expiresAt);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  if (diffMs <= 0) return t('share.expired');
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return t('share.minutesLeft', { count: diffMin });
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return t('share.hoursLeft', { count: diffHrs });
  return t('share.daysLeft', { count: Math.floor(diffHrs / 24) });
}

function roleLabel(role: string | undefined, t: TFunction<'collab'>): string {
  if (role === 'viewer') return t('share.role.viewer');
  if (role === 'suggester') return t('share.role.suggester');
  return t('share.role.editor');
}

const ShareDialog: React.FC<ShareDialogProps> = ({
  projectId,
  scriptId,
  scriptTitle,
  isCollabActive,
  onStartCollab,
  onClose,
}) => {
  const { t } = useTranslation(['collab', 'common']);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'editor' | 'suggester' | 'viewer'>('editor');
  const [expiryHours, setExpiryHours] = useState(
    useSettingsStore.getState().defaultInviteExpiry || 1,
  );
  const [sessions, setSessions] = useState<CollabSession[]>([]);
  const [generating, setGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track whether pointerdown started on the overlay itself (not on the dialog box).
  // On iPad, keyboard dismissal can shift the dialog, causing a synthetic click
  // to land on the overlay even though the user tapped inside the dialog.
  const overlayPointerDown = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    // Only load existing sessions if collab is already active (host inviting more guests).
    // When starting a fresh session, don't show stale invitations from previous sessions.
    if (isCollabActive) {
      api.listCollabSessions(projectId, scriptId)
        .then(setSessions)
        .catch(() => {});
    }
  }, [projectId, scriptId, isCollabActive]);

  const handleGenerate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Verify the user is still signed in, renewing an expired access token
    const authStatus = await ensureCollabAuthenticated();
    if (authStatus === 'unavailable') {
      // Still signed in — keep the dialog open so they can simply retry.
      showToast(collabAuthUnavailableMessage(), 'error');
      return;
    }
    if (authStatus === 'signed-out') {
      showToast(t('share.toast.sessionExpired'), 'error');
      onClose();
      return;
    }

    setGenerating(true);
    try {
      // Verify the collab server is reachable before creating an invite
      const serverOk = await collabAuthApi.testConnection();
      if (!serverOk) {
        showToast(t('share.toast.serverUnreachable'), 'error');
        setGenerating(false);
        return;
      }

      // Reuse the session nonce from the first invite so all guests join the same Yjs room
      const existingNonce = sessions.length > 0 ? sessions[0].session_nonce || '' : '';
      const session = await api.createCollabInvite(projectId, scriptId, trimmed, role, expiryHours, existingNonce);
      setSessions((prev) => [...prev, session]);
      setName('');
      inputRef.current?.focus();
      showToast(t('share.toast.inviteCreated', { name: trimmed }), 'success');

      // When first invite is created, start collab for the owner too
      if (!isCollabActive) {
        onStartCollab(session);
      }
    } catch (err) {
      showToast(t('share.toast.inviteFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await api.revokeCollabSession(token);
      setSessions((prev) => prev.filter((s) => s.token !== token));
    } catch {
      showToast(t('share.toast.revokeFailed'), 'error');
    }
  };

  const handleRevokeAll = async () => {
    try {
      await api.revokeAllCollabSessions(projectId, scriptId);
      setSessions([]);
    } catch {
      showToast(t('share.toast.revokeAllFailed'), 'error');
    }
  };

  const copyLink = async (token: string) => {
    // Build invite link from the collab server URL in Settings.
    // The guest will open this on the collab server (which may be on a different
    // machine than the frontend/backend).
    const collabWs = useSettingsStore.getState().collabServerUrl;
    const collabHttp = collabWs.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const link = `${collabHttp}/collab/${token}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      showToast(t('share.toast.copyFailed'), 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      handleGenerate();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <ModalOverlay
      className="dialog-overlay"
      onPointerDown={(e) => { overlayPointerDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayPointerDown.current) onClose(); overlayPointerDown.current = false; }}
    >
      <div
        className="dialog-box"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header">
          {t('share.title', { title: scriptTitle })}
        </div>

        <div className="dialog-body">
          {isCollabActive && (
            <div className="collab-status-badge">
              <span className="collab-dot" /> {t('share.liveActive')}
            </div>
          )}

          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--fd-text-muted)' }}>
            {t('share.intro')}
          </p>

          <label className="dialog-label" style={{ fontSize: 14 }}>{t('share.inviteLabel')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="dialog-input"
              style={{ flex: 1 }}
              placeholder={t('share.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={generating}
              aria-label={t('share.nameAria')}
            />
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleGenerate}
              disabled={!name.trim() || generating}
            >
              {generating ? t('share.creating') : t('share.invite')}
            </button>
          </div>

          {/* Role and expiry options */}
          <div className="collab-invite-options">
            <div className="collab-role-selector">
              <label className="dialog-label" style={{ fontSize: 14, marginTop: 12 }}>{t('share.permission')}</label>
              <div className="collab-role-radios">
                <label className="collab-radio-label">
                  <input
                    type="radio"
                    name="role"
                    value="editor"
                    checked={role === 'editor'}
                    onChange={() => setRole('editor')}
                  />
                  {t('share.role.editor')}
                </label>
                <label className="collab-radio-label" title={t('share.suggestTitle')}>
                  <input
                    type="radio"
                    name="role"
                    value="suggester"
                    checked={role === 'suggester'}
                    onChange={() => setRole('suggester')}
                  />
                  {t('share.role.suggester')}
                </label>
                <label className="collab-radio-label">
                  <input
                    type="radio"
                    name="role"
                    value="viewer"
                    checked={role === 'viewer'}
                    onChange={() => setRole('viewer')}
                  />
                  {t('share.role.viewer')}
                </label>
              </div>
            </div>

            <div className="collab-expiry-selector">
              <label className="dialog-label" style={{ fontSize: 14, marginTop: 12 }}>{t('share.validFor')}</label>
              <Select
                className="dialog-input collab-expiry-select"
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                aria-label={t('share.expiryAria')}
              >
                {expiryOptions(t).map((opt) => (
                  <option key={opt.hours} value={opt.hours}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {sessions.length > 0 && (
            <div className="collab-sessions-list">
              <label className="dialog-label" style={{ fontSize: 14, marginTop: 16 }}>
                {t('share.activeInvites', { count: sessions.length })}
              </label>
              {sessions.map((s) => (
                <div key={s.token} className="collab-session-item">
                  <div className="collab-session-info">
                    <span className="collab-session-name">
                      {s.collaborator_name}
                      <span className={`collab-role-badge collab-role-${s.role || 'editor'}`}>
                        {roleLabel(s.role, t)}
                      </span>
                    </span>
                    <span className="collab-session-date">
                      {formatDateTime(s.created_at, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                      {s.expires_at && (
                        <span className="collab-session-expiry"> · {formatExpiry(s.expires_at, t)}</span>
                      )}
                    </span>
                  </div>
                  <div className="collab-session-actions">
                    <button
                      className="collab-copy-btn"
                      onClick={() => copyLink(s.token)}
                      title={t('share.copyLinkTitle')}
                      aria-label={
                        copiedToken === s.token
                          ? t('share.copiedAria', { name: s.collaborator_name })
                          : t('share.copyAria', { name: s.collaborator_name })
                      }
                    >
                      {copiedToken === s.token ? t('share.copied') : t('share.copyLink')}
                    </button>
                    <button
                      className="collab-revoke-btn"
                      onClick={() => handleRevoke(s.token)}
                      title={t('share.revokeTitle')}
                      aria-label={t('share.revokeAria', { name: s.collaborator_name })}
                    >
                      {t('share.revoke')}
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
              {t('share.revokeAll')}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>
            {t('common:close')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ShareDialog;
