import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDate } from '../i18n/format';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import type { VersionInfo } from '../services/api';

function relativeTime(dateStr: string, t: TFunction<'collab'>): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
  if (diffHr < 24) return t('time.hoursAgo', { count: diffHr });
  if (diffDay < 30) return t('time.daysAgo', { count: diffDay });
  return formatDate(date, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

interface CompareVersionPickerProps {
  onSelect: (version: VersionInfo) => void;
  onClose: () => void;
}

const CompareVersionPicker: React.FC<CompareVersionPickerProps> = ({
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation(['collab', 'common']);
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
      setError(err instanceof Error ? err.message : t('compareVersion.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentProject, t]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box compare-version-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">{t('compareVersion.title')}</div>
        <div className="dialog-body">
          {!currentProject && (
            <p className="compare-version-empty">{t('compareVersion.noProject')}</p>
          )}
          {error && <p className="compare-version-error">{error}</p>}
          {loading && <p className="compare-version-loading">{t('compareVersion.loading')}</p>}

          {!loading && versions.length === 0 && currentProject && (
            <p className="compare-version-empty">
              {t('compareVersion.empty')}
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
                  <span className="version-date">{relativeTime(v.date, t)}</span>
                </div>
                <div className="version-message">{v.message}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:cancel')}</button>
        </div>
      </div>
    </div>
  );
};

export default CompareVersionPicker;
