import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { dispatchApiEvent } from '../services/api';
import {
  deviceSyncStatus, readDeviceSyncStatus, DeviceSyncMessage, resolveDeviceSyncIssue, restartDeviceProjectSync, setDeviceProjectSync,
  subscribeDeviceSync, type DeviceSyncIssue,
} from '../services/deviceProjectSync';
import { useSettingsStore } from '../stores/settingsStore';

type Outcome = 'account' | 'linked' | 'problem';

export function DeviceProjectSyncControl({ projectId, onSync }: { projectId: string; onSync: () => void }) {
  const { t } = useTranslation(['projects', 'toolbar']);
  const status = useSyncExternalStore(subscribeDeviceSync, () => deviceSyncStatus(projectId));
  const account = useSettingsStore(state => state.collabAuth.user?.id);
  const accessToken = useSettingsStore(state => state.collabAuth.accessToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome | string | null>(null);
  const lastSynced = status?.lastSynced ?? 0;
  useEffect(() => {
    void readDeviceSyncStatus(projectId).catch(() => setError('problem'));
  }, [projectId, account]);
  useEffect(() => { if (lastSynced) onSync(); }, [lastSynced, onSync]);

  const enabled = status?.enabled === true;
  const state = status?.state;
  const issues = status?.issues ?? [];
  const attention = status?.attention ?? null;

  const run = async (task: () => Promise<Outcome | 'ok' | void>, resolving = false) => {
    setError(null);
    setBusy(true);
    try {
      const outcome = await task();
      if (outcome && outcome !== 'ok') setError(outcome);
    } catch (failure) {
      // A message the sync service wrote for the writer, else a generic one.
      setError(failure instanceof DeviceSyncMessage ? failure.message : resolving ? t('sync.resolveFailed') : 'problem');
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => {
    if (!enabled && !accessToken) {
      dispatchApiEvent('opendraft:auth-required');
      return;
    }
    void run(() => setDeviceProjectSync(projectId, !enabled));
  };
  const resolve = (issue: DeviceSyncIssue, keep: 'device' | 'cloud') =>
    void run(() => resolveDeviceSyncIssue(projectId, issue.id, keep), true);

  const summary = error
    ? (error === 'account' ? t('sync.account') : error === 'linked' ? t('sync.linked')
      : error === 'problem' ? t('toolbar:status.save.cloudProblem') : error)
    : !enabled ? t('sync.description')
    : attention === 'account' ? t('sync.attentionAccount')
    : attention === 'missing' ? t('sync.attentionMissing')
    : attention === 'linked' ? t('sync.linked')
    : t(({
      off: 'sync.description',
      pending: 'sync.waiting',
      syncing: 'toolbar:status.save.cloudSyncing',
      synced: 'toolbar:status.save.cloudSynced',
      conflict: 'sync.conflict',
      problem: 'toolbar:status.save.cloudProblem',
    } as const)[state ?? 'off']);

  return (
    <div className="device-sync">
      <div className="project-scripts-actions">
        <button className="project-action-btn" type="button" disabled={busy || !status}
          onClick={toggle}>
          {t(enabled ? 'sync.stop' : 'sync.start')}
        </button>
        {enabled && attention === 'account' && (
          <button className="project-action-btn" type="button" disabled={busy}
            onClick={() => void run(() => restartDeviceProjectSync(projectId))}>{t('sync.accountSwitch')}</button>
        )}
        {enabled && attention === 'missing' && (
          <button className="project-action-btn" type="button" disabled={busy}
            onClick={() => void run(() => restartDeviceProjectSync(projectId))}>{t('sync.restart')}</button>
        )}
        <span role="status">
          {summary}
          {!!lastSynced && !error && <> · {t('toolbar:status.save.cloudLastSync', { time: new Date(lastSynced).toLocaleString() })}</>}
        </span>
      </div>
      {enabled && !error && !attention && status?.onOpen && state === 'synced' && (
        <p className="device-sync-note">{t('sync.updatesOnOpen')}</p>
      )}
      {enabled && !attention && issues.length > 0 && (
        <ul className="device-sync-issues" aria-label={t('sync.conflict')}>
          {issues.map(issue => (
            <li key={issue.id}>
              <span className="device-sync-issue-title">{issue.title || issue.id}</span>
              {' · '}
              <span>{t(({
                conflict: 'sync.issueConflict',
                quota: 'sync.issueQuota',
                problem: 'sync.issueProblem',
              } as const)[issue.kind])}</span>
              {issue.kind !== 'quota' && (
                <>
                  {' '}
                  <button className="project-action-btn" type="button" disabled={busy}
                    onClick={() => resolve(issue, 'device')}>{t('sync.keepDevice')}</button>
                  <button className="project-action-btn" type="button" disabled={busy}
                    onClick={() => resolve(issue, 'cloud')}>{t('sync.keepCloud')}</button>
                </>
              )}
            </li>
          ))}
          {issues.some(issue => issue.kind !== 'quota') && <li className="device-sync-note">{t('sync.resolveNote')}</li>}
        </ul>
      )}
    </div>
  );
}
