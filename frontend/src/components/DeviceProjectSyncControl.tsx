import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { dispatchApiEvent } from '../services/api';
import {
  deviceSyncStatus, readDeviceSyncStatus, setDeviceProjectSync, subscribeDeviceSync,
} from '../services/deviceProjectSync';
import { useSettingsStore } from '../stores/settingsStore';

export function DeviceProjectSyncControl({ projectId, onSync }: { projectId: string; onSync: () => void }) {
  const { t } = useTranslation(['projects', 'toolbar']);
  const status = useSyncExternalStore(subscribeDeviceSync, () => deviceSyncStatus(projectId));
  const account = useSettingsStore(state => state.collabAuth.user?.id);
  const accessToken = useSettingsStore(state => state.collabAuth.accessToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'account' | 'linked' | 'problem' | null>(null);
  const lastSynced = status?.lastSynced ?? 0;
  useEffect(() => {
    void readDeviceSyncStatus(projectId).catch(() => setError('problem'));
  }, [projectId, account]);
  useEffect(() => { if (lastSynced) onSync(); }, [lastSynced, onSync]);

  const enabled = status?.enabled === true;
  const state = status?.state;
  const toggle = async () => {
    setError(null);
    if (!enabled && !accessToken) {
      dispatchApiEvent('opendraft:auth-required');
      return;
    }
    setBusy(true);
    try {
      const outcome = await setDeviceProjectSync(projectId, !enabled);
      if (outcome !== 'ok') setError(outcome);
    } catch {
      setError('problem');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="project-scripts-actions">
      <button className="project-action-btn" type="button" disabled={busy || !status}
        onClick={() => { void toggle(); }}>
        {t(enabled ? 'sync.stop' : 'sync.start')}
      </button>
      <span role="status">
        {error ? t(({
          account: 'sync.account',
          linked: 'sync.linked',
          problem: 'toolbar:status.save.cloudProblem',
        } as const)[error]) : enabled ? t(({
          off: 'sync.description',
          pending: 'sync.waiting',
          syncing: 'toolbar:status.save.cloudSyncing',
          synced: 'toolbar:status.save.cloudSynced',
          conflict: 'sync.conflict',
          problem: 'toolbar:status.save.cloudProblem',
        } as const)[state ?? 'off']) : t('sync.description')}
        {!!lastSynced && !error && <> · {t('toolbar:status.save.cloudLastSync', { time: new Date(lastSynced).toLocaleString() })}</>}
      </span>
    </div>
  );
}
