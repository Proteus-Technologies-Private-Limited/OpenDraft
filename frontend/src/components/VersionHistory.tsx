import React, { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import type { VersionInfo } from '../services/api';
import DiffViewer from './DiffViewer';

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

const VersionHistory: React.FC = () => {
  const { currentProject, versions, setVersions, versionHistoryOpen, setVersionHistoryOpen } =
    useProjectStore();

  const [selectedVersion, setSelectedVersion] = useState<VersionInfo | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load versions when panel opens
  const loadVersions = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getVersions(currentProject.id);
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [currentProject, setVersions]);

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
        setDiffText('(Initial version -- no previous version to compare against)');
        return;
      }

      const prevVersion = versions[index + 1]; // versions are newest-first
      try {
        const result = await api.getVersionDiff(currentProject.id, prevVersion.hash, version.hash);
        setDiffText(result.diff || '(No changes)');
      } catch (err) {
        setDiffText(`Error loading diff: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    },
    [currentProject, versions]
  );

  const handleRestore = useCallback(
    async (version: VersionInfo) => {
      if (!currentProject) return;
      if (!confirm(`Restore to version ${version.short_hash}? This will create a new version with the restored content.`)) {
        return;
      }
      try {
        await api.restoreVersion(currentProject.id, version.hash);
        await loadVersions();
        setSelectedVersion(null);
        setDiffText(null);
      } catch (err) {
        alert(`Restore failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    },
    [currentProject, loadVersions]
  );

  if (!versionHistoryOpen) return null;

  return (
    <div className="version-history-panel">
      <div className="version-history-header">
        <span className="version-history-title">Version History</span>
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
          No project selected. Import or create a screenplay first.
        </div>
      )}

      {error && <div className="version-history-error">{error}</div>}

      {loading && <div className="version-history-loading">Loading versions...</div>}

      <div className="version-history-content">
        <div className="version-history-list">
          {versions.length === 0 && !loading && currentProject && (
            <div className="version-history-empty">
              No versions yet. Use File &gt; Check In to save a version.
            </div>
          )}
          {versions.map((v, i) => (
            <div
              key={v.hash}
              className={`version-item ${selectedVersion?.hash === v.hash ? 'selected' : ''}`}
              onClick={() => handleViewDiff(v, i)}
            >
              <div className="version-item-top">
                <span className="version-hash">{v.short_hash}</span>
                <span className="version-date">{relativeTime(v.date)}</span>
              </div>
              <div className="version-message">{v.message}</div>
              <button
                className="version-restore-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRestore(v);
                }}
                title="Restore this version"
              >
                Restore
              </button>
            </div>
          ))}
        </div>

        {diffText !== null && selectedVersion && (
          <div className="version-diff-area">
            <div className="version-diff-header">
              <span>
                Changes in {selectedVersion.short_hash}: {selectedVersion.message}
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
    </div>
  );
};

export default VersionHistory;
