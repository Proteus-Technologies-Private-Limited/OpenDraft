import React, { useEffect, useState } from 'react';
import {
  scheduleUpdateCheck,
  onUpdateAvailable,
  openUpdatePage,
  snoozeUpdate,
  dismissUpdate,
  type AvailableUpdate,
} from '../services/updateCheck';
import { getAppVersion } from '../services/diagnostics';

/**
 * A newer OpenDraft is out (issue #106).
 *
 * A strip along the bottom rather than a dialog: a writer who opened the app
 * to write should not have to clear a modal first, and nothing here is urgent.
 * Dismiss is deliberately the last and plainest of the three, because it is
 * the only one that cannot be undone from here.
 *
 * All of the once-only reasoning lives in services/updateCheck.ts; this
 * component only renders what that decides and reports back which button was
 * pressed.
 */
const UpdateBanner: React.FC = () => {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < 600,
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    // Subscribe before scheduling, so a manual Help → Check for Updates and
    // the launch check both land here.
    const unsubscribe = onUpdateAvailable(setUpdate);
    scheduleUpdateCheck();
    return unsubscribe;
  }, []);

  if (!update) return null;

  const later = () => {
    snoozeUpdate();
    setUpdate(null);
  };

  const never = () => {
    dismissUpdate(update.version);
    setUpdate(null);
  };

  const update_ = () => {
    void openUpdatePage(update);
    setUpdate(null);
  };

  const button = (primary: boolean): React.CSSProperties => ({
    background: primary ? '#e67e22' : 'transparent',
    color: '#fff',
    border: primary ? 'none' : '1px solid rgba(255,255,255,0.35)',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: primary ? 600 : 400,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: isMobile ? 1 : 'none',
  });

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 150000,
        background: '#1a1a2e',
        borderTop: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.35)',
        padding: '12px 16px',
        // iPhone home indicator; harmless everywhere else.
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, color: '#fff', fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ fontWeight: 600 }}>OpenDraft {update.version} is available.</strong>
        {` You are on ${getAppVersion()}.`}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={update_} style={button(true)}>Update</button>
        <button onClick={later} style={button(false)}>Remind me later</button>
        <button onClick={never} style={button(false)}>Dismiss</button>
      </div>
    </div>
  );
};

export default UpdateBanner;
