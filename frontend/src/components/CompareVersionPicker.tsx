import React, { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import type { VersionInfo } from '../services/api';

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

interface CompareVersionPickerProps {
  onSelect: (version: VersionInfo) => void;
  onClose: () => void;
}

const CompareVersionPicker: React.FC<CompareVersionPickerProps> = ({
  onSelect,
  onClose,
}) => {
  const { currentProject } = useProjectStore();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [currentProject]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box compare-version-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">Compare with Version</div>
        <div className="dialog-body">
          {!currentProject && (
            <p className="compare-version-empty">No project selected.</p>
          )}
          {error && <p className="compare-version-error">{error}</p>}
          {loading && <p className="compare-version-loading">Loading versions...</p>}

          {!loading && versions.length === 0 && currentProject && (
            <p className="compare-version-empty">
              No versions yet. Use File &gt; Check In to save a version.
            </p>
          )}

          <div className="compare-version-list">
            {versions.map((v) => (
              <div
                key={v.hash}
                className="compare-version-item"
                onClick={() => onSelect(v)}
              >
                <div className="compare-version-item-top">
                  <span className="version-hash">{v.short_hash}</span>
                  <span className="version-date">{relativeTime(v.date)}</span>
                </div>
                <div className="version-message">{v.message}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default CompareVersionPicker;
