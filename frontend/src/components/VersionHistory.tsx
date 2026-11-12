import React, { useEffect, useState, useCallback } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { JSONContent } from '@tiptap/react';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import type { VersionInfo } from '../services/api';
import DiffViewer from './DiffViewer';
import ScriptDiffView from './ScriptDiffView';
import { showToast } from './Toast';
import { relativeTime } from '../utils/relativeTime';


const VersionHistory: React.FC = () => {
  const { t } = useTranslation(['collab', 'common']);
  const navigate = useNavigate();
  const { currentProject, currentScriptId, versions, setVersions, versionHistoryOpen, setVersionHistoryOpen, triggerScriptReload } =
    useProjectStore();

  const [selectedVersion, setSelectedVersion] = useState<VersionInfo | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compare mode — checkboxes on version rows
  const [compareSelection, setCompareSelection] = useState<string[]>([]);  // commit hashes
  const [scriptDiff, setScriptDiff] = useState<{
    docA: Record<string, unknown>;
    docB: Record<string, unknown>;
    labelA: string;
    labelB: string;
  } | null>(null);

  const toggleCompareSelect = useCallback((hash: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(hash)) return prev.filter((h) => h !== hash);
      if (prev.length >= 2) return [prev[1], hash]; // drop oldest, keep rolling window of 2
      return [...prev, hash];
    });
  }, []);

  const runScriptCompare = useCallback(async () => {
    if (!currentProject || !currentScriptId || compareSelection.length !== 2) return;
    try {
      const vA = versions.find((v) => v.hash === compareSelection[0]);
      const vB = versions.find((v) => v.hash === compareSelection[1]);
      if (!vA || !vB) {
        showToast(t('versions.toast.unavailable'), 'error');
        return;
      }
      // Order: earlier version = A, later = B
      const aIsEarlier = new Date(vA.date).getTime() < new Date(vB.date).getTime();
      const earlier = aIsEarlier ? vA : vB;
      const later = aIsEarlier ? vB : vA;

      // Fetch each version independently so a 404 on one side shows as an
      // "Added in this version" / "Removed before this version" state rather
      // than killing the whole compare.
      const fetchOrNull = async (hash: string) => {
        try {
          return await api.getScriptAtVersion(currentProject.id, hash, currentScriptId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('404') || /not found/i.test(msg)) return null;
          throw e;
        }
      };

      const [respA, respB] = await Promise.all([
        fetchOrNull(earlier.hash),
        fetchOrNull(later.hash),
      ]);

      if (!respA && !respB) {
        showToast(
          t('versions.toast.notInEither'),
          'error',
        );
        return;
      }
      if (!respA) {
        showToast(
          t('versions.toast.addedIn', { later: later.short_hash, earlier: earlier.short_hash }),
          'info',
        );
      }
      if (!respB) {
        showToast(
          t('versions.toast.removedBefore', { later: later.short_hash, earlier: earlier.short_hash }),
          'info',
        );
      }

      const emptyDoc = { type: 'doc', content: [] };
      setScriptDiff({
        docA: (respA?.content || emptyDoc) as Record<string, unknown>,
        docB: (respB?.content || emptyDoc) as Record<string, unknown>,
        labelA: respA
          ? `${earlier.short_hash} · ${earlier.message}`
          : `${earlier.short_hash} · ${t('versions.scriptNotInVersion')}`,
        labelB: respB
          ? `${later.short_hash} · ${later.message}`
          : `${later.short_hash} · ${t('versions.scriptNotInVersion')}`,
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : t('versions.toast.compareFailed'),
        'error',
      );
    }
  }, [currentProject, currentScriptId, compareSelection, versions, t]);

  // Load versions when panel opens
  const loadVersions = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getVersions(currentProject.id, currentScriptId || undefined);
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('versions.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentProject, currentScriptId, setVersions, t]);

  useEffect(() => {
    if (versionHistoryOpen && currentProject) {
      loadVersions();
    }
  }, [versionHistoryOpen, currentProject, loadVersions]);

  const handleViewDiff = useCallback(
    async (version: VersionInfo, index: number) => {
      if (!currentProject) return;
      setSelectedVersion(version);

      // Diff against previous commit (or show first commit as-is)
      if (index >= versions.length - 1) {
        setDiffText(t('versions.initial'));
        return;
      }

      const prevVersion = versions[index + 1]; // versions are newest-first
      try {
        const result = await api.getVersionDiff(currentProject.id, prevVersion.hash, version.hash);
        setDiffText(result.diff || t('versions.noChanges'));
      } catch (err) {
        setDiffText(t('versions.diffError', { message: err instanceof Error ? err.message : t('versions.unknownError') }));
      }
    },
    [currentProject, versions, t]
  );

  const [restoreConfirm, setRestoreConfirm] = useState<VersionInfo | null>(null);

  const handleRestore = useCallback(
    (version: VersionInfo) => {
      setRestoreConfirm(version);
    },
    []
  );

  const handleRestoreConfirm = useCallback(
    async () => {
      if (!currentProject || !restoreConfirm) return;
      const version = restoreConfirm;
      setRestoreConfirm(null);
      try {
        await api.restoreVersion(currentProject.id, version.hash);
        await loadVersions();
        setSelectedVersion(null);
        setDiffText(null);

        // Check if the current script still exists after restore
        if (currentScriptId) {
          try {
            await api.getScript(currentProject.id, currentScriptId);
            // Script still exists — reload it in the editor
            triggerScriptReload();
          } catch {
            // Script was removed by the restore — go to project view
            setVersionHistoryOpen(false);
            navigate(`/project/${currentProject.id}`, { replace: true });
            showToast(t('versions.toast.restoredScriptGone', { hash: version.short_hash }), 'info');
            return;
          }
        } else {
          triggerScriptReload();
        }
        showToast(t('versions.toast.restored', { hash: version.short_hash }), 'success');
      } catch (err) {
        showToast(t('versions.toast.restoreFailed', { message: err instanceof Error ? err.message : t('versions.unknownError') }), 'error');
      }
    },
    [currentProject, currentScriptId, restoreConfirm, loadVersions, navigate, setVersionHistoryOpen, triggerScriptReload, t]
  );

  // ── Delete a version (discussion #183) ──
  const [deleteConfirm, setDeleteConfirm] = useState<VersionInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentProject || !deleteConfirm) return;
    const version = deleteConfirm;
    setDeleting(true);
    try {
      await api.deleteVersion(currentProject.id, version.hash);
      setDeleteConfirm(null);
      // Later versions can be re-hashed by the delete (git backend), so any
      // selection pointing into the list is stale either way.
      setCompareSelection([]);
      setSelectedVersion(null);
      setDiffText(null);
      await loadVersions();
      showToast(t('versions.toast.deleted', { hash: version.short_hash }), 'success');
    } catch (err) {
      console.error('[VersionHistory] delete failed', err);
      showToast(t('versions.toast.deleteFailed', { message: err instanceof Error ? err.message : t('versions.unknownError') }), 'error');
    } finally {
      setDeleting(false);
    }
  }, [currentProject, deleteConfirm, loadVersions, t]);

  if (!versionHistoryOpen) return null;

  return (
    <div className="version-history-panel">
      <div className="version-history-header">
        <span className="version-history-title">{t('versions.title')}</span>
        <button
          className="version-history-close"
          onClick={() => {
            setVersionHistoryOpen(false);
            setSelectedVersion(null);
            setDiffText(null);
          }}
        >
          x
        </button>
      </div>

      {!currentProject && (
        <div className="version-history-empty">
          {t('versions.noProject')}
        </div>
      )}

      {error && <div className="version-history-error">{error}</div>}

      {loading && <div className="version-history-loading">{t('versions.loading')}</div>}

      {currentScriptId && versions.length >= 2 && (
        <div className="version-compare-bar">
          <span className="version-compare-info">
            {compareSelection.length === 0 && t('versions.compareHint0')}
            {compareSelection.length === 1 && t('versions.compareHint1')}
            {compareSelection.length === 2 && t('versions.compareHint2')}
          </span>
          <button
            className="version-compare-btn"
            disabled={compareSelection.length !== 2}
            onClick={runScriptCompare}
          >
            {t('versions.compareSelected')}
          </button>
          {compareSelection.length > 0 && (
            <button
              className="version-compare-clear"
              onClick={() => setCompareSelection([])}
            >
              {t('common:clear')}
            </button>
          )}
        </div>
      )}

      <div className="version-history-content">
        <div className="version-history-list">
          {versions.length === 0 && !loading && currentProject && (
            <div className="version-history-empty">
              {t('versions.empty')}
            </div>
          )}
          {versions.map((v, i) => (
            <div
              key={v.hash}
              className={`version-item ${selectedVersion?.hash === v.hash ? 'selected' : ''}${compareSelection.includes(v.hash) ? ' compare-selected' : ''}`}
              onClick={() => handleViewDiff(v, i)}
            >
              <div className="version-item-top">
                {currentScriptId && (
                  <input
                    type="checkbox"
                    className="version-compare-checkbox"
                    checked={compareSelection.includes(v.hash)}
                    onChange={(e) => { e.stopPropagation(); toggleCompareSelect(v.hash); }}
                    onClick={(e) => e.stopPropagation()}
                    title={t('versions.selectForCompare')}
                  />
                )}
                <span className="version-hash">{v.short_hash}</span>
                <span className="version-date">{relativeTime(v.date)}</span>
              </div>
              <div className="version-message">{v.message}</div>
              <div className="version-item-actions">
                {currentScriptId && (
                  <button
                    className="version-view-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (currentProject && currentScriptId) {
                        setVersionHistoryOpen(false);
                        setSelectedVersion(null);
                        setDiffText(null);
                        // Record where read-only history mode was entered from
                        // so its "Back to Current Version" can unwind rather
                        // than push another editor entry (issue #66).
                        navigate(
                          `/project/${currentProject.id}/history/${currentScriptId}/${v.hash}`,
                          { state: { from: `/project/${currentProject.id}/edit/${currentScriptId}` } },
                        );
                      }
                    }}
                    title={t('versions.viewTitle')}
                  >
                    {t('versions.view')}
                  </button>
                )}
                <button
                  className="version-restore-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRestore(v);
                  }}
                  title={t('versions.restoreTitle')}
                >
                  {t('versions.restore')}
                </button>
                <button
                  className="version-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(v);
                  }}
                  title={t('versions.deleteTitle')}
                >
                  {t('common:delete')}
                </button>
              </div>
            </div>
          ))}
        </div>

        {diffText !== null && selectedVersion && (
          <div className="version-diff-area">
            <div className="version-diff-header">
              <span>
                {t('versions.changesIn', { hash: selectedVersion.short_hash, message: selectedVersion.message })}
              </span>
              <button
                className="version-diff-close"
                onClick={() => {
                  setSelectedVersion(null);
                  setDiffText(null);
                }}
              >
                x
              </button>
            </div>
            <DiffViewer diff={diffText} />
          </div>
        )}
      </div>
      {scriptDiff && (
        <div className="script-diff-overlay">
          <ScriptDiffView
            docA={scriptDiff.docA as JSONContent}
            docB={scriptDiff.docB as JSONContent}
            labelA={scriptDiff.labelA}
            labelB={scriptDiff.labelB}
            onClose={() => setScriptDiff(null)}
          />
        </div>
      )}
      {deleteConfirm && (
        <ModalOverlay className="dialog-overlay" onClick={() => { if (!deleting) setDeleteConfirm(null); }}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{t('versions.deleteDialogTitle')}</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>
                {deleteConfirm.message ? (
                  <Trans
                    ns="collab"
                    i18nKey="versions.deleteConfirmWithMessage"
                    values={{ hash: deleteConfirm.short_hash, message: deleteConfirm.message }}
                    components={{ strong: <strong /> }}
                  />
                ) : (
                  <Trans
                    ns="collab"
                    i18nKey="versions.deleteConfirm"
                    values={{ hash: deleteConfirm.short_hash }}
                    components={{ strong: <strong /> }}
                  />
                )}
              </p>
              <p style={{ margin: '8px 0 0' }}>
                {t('versions.deleteNote')}
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setDeleteConfirm(null)} disabled={deleting}>{t('common:cancel')}</button>
              <button className="dialog-danger" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? t('versions.deleting') : t('common:delete')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {restoreConfirm && (
        <ModalOverlay className="dialog-overlay" onClick={() => setRestoreConfirm(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{t('versions.restoreDialogTitle')}</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>
                <Trans
                  ns="collab"
                  i18nKey="versions.restoreConfirm"
                  values={{ hash: restoreConfirm.short_hash }}
                  components={{ strong: <strong /> }}
                />
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setRestoreConfirm(null)}>{t('common:cancel')}</button>
              <button className="dialog-primary" onClick={handleRestoreConfirm}>
                {t('versions.restore')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default VersionHistory;
