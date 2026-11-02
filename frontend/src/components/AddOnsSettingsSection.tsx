/**
 * Settings → Add-ons.
 *
 * Optional plugins (`optIn` in plugins/registry) the writer can turn on or
 * off. Each starts off: nothing it registers reaches the app until the writer
 * turns it on here. Turning one on first shows what it does, what leaves the
 * device, and its settings; cancelling leaves it off. Turning one off offers
 * to delete what it stored, such as an API key.
 *
 * The section is not shown at all when no add-on is installed.
 */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { pluginRegistry, type OpenDraftPlugin } from '../plugins/registry';
import { showToast } from './Toast';
import './AddOnsSettingsSection.css';

type SaveFn = () => boolean | Promise<boolean>;

function useAddOns(): OpenDraftPlugin[] {
  // getAddOns() builds a new array each call; cache it per registry revision so
  // useSyncExternalStore sees a stable snapshot.
  const cache = useRef<{ rev: number; list: OpenDraftPlugin[] }>({ rev: -1, list: [] });
  const rev = useRef(0);
  const subscribe = useCallback((onChange: () => void) => pluginRegistry.subscribe(() => {
    rev.current += 1;
    onChange();
  }), []);
  const getSnapshot = useCallback(() => {
    if (cache.current.rev !== rev.current) {
      cache.current = { rev: rev.current, list: pluginRegistry.getAddOns() };
    }
    return cache.current.list;
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Turn on / edit settings ──

interface SettingsDialogProps {
  plugin: OpenDraftPlugin;
  mode: 'activate' | 'edit';
  onClose: () => void;
}

const AddOnSettingsDialog: React.FC<SettingsDialogProps> = ({ plugin, mode, onClose }) => {
  const saveRef = useRef<SaveFn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Settings = plugin.settings;
  const registerSave = useCallback((fn: SaveFn) => { saveRef.current = fn; }, []);
  const titleId = `addon-dialog-title-${plugin.id}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (saveRef.current) {
        const ok = await saveRef.current();
        if (!ok) return; // the add-on shows its own message
      }
      if (mode === 'activate') {
        await pluginRegistry.enableAddOn(plugin.id);
        showToast(`${plugin.name} is on`, 'success');
      } else {
        showToast(`${plugin.name} settings saved`, 'success');
      }
      onClose();
    } catch (err) {
      console.error(`[add-ons] ${plugin.id}: ${mode} failed`, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="dialog-box addon-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-header" id={titleId}>
          {mode === 'activate' ? `Turn on ${plugin.name}` : `${plugin.name} settings`}
        </div>
        <div className="dialog-body">
          {mode === 'activate' && plugin.description && <p className="addon-dialog-desc">{plugin.description}</p>}
          {mode === 'activate' && (
            <div className="addon-privacy" role="note">
              <strong>What leaves your device</strong>
              <p>{plugin.privacy || 'This add-on has not said whether it sends anything off your device.'}</p>
            </div>
          )}
          {Settings && (
            <div className="addon-settings">
              <Settings mode={mode} registerSave={registerSave} />
            </div>
          )}
          {error && <p className="addon-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="dialog-primary" onClick={confirm} disabled={busy}>
            {mode === 'activate' ? 'Turn On' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Turn off ──

const AddOnDisableDialog: React.FC<{ plugin: OpenDraftPlugin; onClose: () => void }> = ({ plugin, onClose }) => {
  // Deleting what the add-on stored is the private choice, so it is the default.
  const [forget, setForget] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `addon-off-title-${plugin.id}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      await pluginRegistry.disableAddOn(plugin.id, { forgetSettings: forget });
      showToast(`${plugin.name} is off`, 'info');
      onClose();
    } catch (err) {
      // disableAddOn has already turned it off; only its clean-up failed.
      console.error(`[add-ons] ${plugin.id}: turning off reported an error`, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="dialog-box addon-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-header" id={titleId}>Turn off {plugin.name}?</div>
        <div className="dialog-body">
          <p className="addon-dialog-desc">
            Its menu items and panels are removed straight away. You can turn it on again at any time.
          </p>
          <label className="addon-forget">
            <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} disabled={busy} />{' '}
            Also delete its saved settings, such as a server address or API key
          </label>
          {error && <p className="addon-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>{error ? 'Close' : 'Cancel'}</button>
          {!error && <button className="dialog-primary" onClick={turnOff} disabled={busy}>Turn Off</button>}
        </div>
      </div>
    </div>
  );
};

// ── The section ──

type Pending =
  | { kind: 'activate' | 'edit'; plugin: OpenDraftPlugin }
  | { kind: 'disable'; plugin: OpenDraftPlugin }
  | null;

const AddOnsSettingsSection: React.FC = () => {
  const addOns = useAddOns();
  const [pending, setPending] = useState<Pending>(null);
  const close = useCallback(() => setPending(null), []);

  if (addOns.length === 0) return null;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Add-ons</h2>
      <p className="settings-section-desc">
        Optional features you can choose to use. Each one is off until you turn it on, and nothing
        it does reaches your scripts — or leaves your device — before then.
      </p>

      <ul className="addon-list">
        {addOns.map((plugin) => {
          const on = pluginRegistry.isAddOnEnabled(plugin.id);
          const toggleId = `addon-toggle-${plugin.id}`;
          return (
            <li key={plugin.id} className="addon-item">
              <div className="addon-item-text">
                <label htmlFor={toggleId} className="addon-name">
                  {plugin.name} <span className="addon-version">{plugin.version}</span>
                </label>
                {plugin.description && <div className="addon-desc">{plugin.description}</div>}
                {plugin.privacy && <div className="settings-hint">{plugin.privacy}</div>}
              </div>
              <div className="addon-item-actions">
                {on && plugin.settings && (
                  <button className="dialog-btn" onClick={() => setPending({ kind: 'edit', plugin })}>
                    Settings…
                  </button>
                )}
                <label className="addon-switch">
                  <input
                    id={toggleId}
                    type="checkbox"
                    role="switch"
                    checked={on}
                    aria-checked={on}
                    onChange={() => setPending({ kind: on ? 'disable' : 'activate', plugin })}
                  />{' '}
                  {on ? 'On' : 'Off'}
                </label>
              </div>
            </li>
          );
        })}
      </ul>

      {pending?.kind === 'disable' && <AddOnDisableDialog plugin={pending.plugin} onClose={close} />}
      {(pending?.kind === 'activate' || pending?.kind === 'edit') && (
        <AddOnSettingsDialog plugin={pending.plugin} mode={pending.kind} onClose={close} />
      )}
    </section>
  );
};

export default AddOnsSettingsSection;
