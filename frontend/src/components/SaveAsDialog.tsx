import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaCloud, FaDesktop } from 'react-icons/fa';
import { api } from '../services/api';
import { cloudApi } from '../services/cloudApi';
import { isWeb } from '../services/platform';
import type { ProjectInfo } from '../services/api';
import { useSettingsStore } from '../stores/settingsStore';

export type SaveDestination = 'local' | 'cloud';

const LAST_PROJECT_KEY = 'opendraft:lastProject';

function getLastProjectName(): string {
  try { return localStorage.getItem(LAST_PROJECT_KEY) || ''; } catch { return ''; }
}
function saveLastProjectName(name: string) {
  try { localStorage.setItem(LAST_PROJECT_KEY, name); } catch { /* noop */ }
}

interface SaveAsDialogProps {
  defaultProjectName: string;
  defaultFileName: string;
  /** Pre-select the destination tab. Pass 'cloud' when the user came from a
   *  cloud project — otherwise the dialog defaults to 'local' and the
   *  cloud-only project name will not match anything in the local list,
   *  silently filing the new screenplay under a random local project. */
  defaultDestination?: SaveDestination;
  onSaved: (
    projectId: string,
    projectName: string,
    scriptId: string,
    scriptTitle: string,
    destination: SaveDestination,
  ) => void;
  onClose: () => void;
  buildContent: () => Record<string, unknown> | undefined;
}

/** Web is always cloud-backed; the device/cloud toggle would be misleading. */
const WEB_ONLY_CLOUD = isWeb();

const SaveAsDialog: React.FC<SaveAsDialogProps> = ({
  defaultProjectName,
  defaultFileName,
  defaultDestination,
  onSaved,
  onClose,
  buildContent,
}) => {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectName, setProjectName] = useState('');
  const [fileName, setFileName] = useState(defaultFileName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);  // true when user is actively typing to filter
  const [destination, setDestination] = useState<SaveDestination>(
    WEB_ONLY_CLOUD ? 'cloud' : (defaultDestination ?? 'local'),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-fetch projects when the signed-in user changes. The dialog can open
  // while the user is anonymous (we got a 401 on the initial listProjects),
  // AuthGate then prompts a sign-in, and when the token lands we want to
  // reload the list so a subsequent save doesn't hit 409 on a project the
  // user actually already owns.
  const accessToken = useSettingsStore((s) => s.collabAuth.accessToken);
  const authVerified = useSettingsStore((s) => s.authVerified);
  const signedIn = Boolean(accessToken && authVerified);

  // Load projects and pick the best default project name. Re-runs when the
  // destination tab flips so cloud projects appear when the user switches to
  // the Cloud tab and vice versa.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Cloud listing requires a verified login. Without one, just leave the
        // projects list empty and let the user sign in via the warning banner;
        // a fallback to local would silently mis-route a "Save to Cloud".
        if (destination === 'cloud' && !signedIn) {
          if (!cancelled) setProjects([]);
          return;
        }
        const client = destination === 'cloud' ? cloudApi : api;
        const list = await client.listProjects();
        if (cancelled) return;
        setProjects(list);

        // Only overwrite the project-name field the first time it is populated;
        // preserve what the user is typing on subsequent refetches.
        setProjectName((current) => {
          if (current) return current;
          const lastUsed = getLastProjectName();
          if (defaultProjectName && list.some((p) => p.name.toLowerCase() === defaultProjectName.toLowerCase())) {
            return defaultProjectName;
          }
          if (lastUsed && list.some((p) => p.name.toLowerCase() === lastUsed.toLowerCase())) {
            return lastUsed;
          }
          if (list.length > 0) {
            const sorted = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            return sorted[0].name;
          }
          return defaultProjectName || 'My Project';
        });
      } catch {
        if (!cancelled) {
          setProjectName((current) => current || defaultProjectName || 'My Project');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [defaultProjectName, accessToken, destination, signedIn]);

  // Focus the file name input once project name is set
  useEffect(() => {
    if (projectName) {
      // Small delay to let React render the field
      const t = setTimeout(() => {
        fileInputRef.current?.focus();
        fileInputRef.current?.select();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [projectName ? 'set' : 'unset']); // only fire once project is populated

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredProjects = isTyping && projectName.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(projectName.toLowerCase()))
    : projects;

  const handleSelectProject = useCallback((name: string) => {
    setProjectName(name);
    setIsTyping(false);
    setDropdownOpen(false);
    // Focus filename after selection
    setTimeout(() => {
      fileInputRef.current?.focus();
      fileInputRef.current?.select();
    }, 30);
  }, []);

  const handleSave = async () => {
    const trimmedProject = projectName.trim();
    const trimmedFile = fileName.trim();
    if (!trimmedProject || !trimmedFile) return;

    if (destination === 'cloud' && !signedIn) {
      // AuthGate handles dispatching the login dialog. The user can re-click
      // Save once they're back; the projects list will refresh automatically
      // via the auth-token effect dependency.
      window.dispatchEvent(new CustomEvent('opendraft:auth-required'));
      return;
    }

    setSaving(true);
    setError('');

    const client = destination === 'cloud' ? cloudApi : api;

    try {
      // Create or find existing project. The cached `projects` list can be
      // stale (e.g. empty because an earlier listProjects returned 401 before
      // sign-in), so if create fails with 409 we refetch and look up the
      // conflicting project instead of giving up.
      let project: ProjectInfo | undefined;
      const cached = projects.find(
        (p) => p.name.toLowerCase() === trimmedProject.toLowerCase()
      );
      if (cached) {
        project = cached;
      } else {
        try {
          project = await client.createProject(trimmedProject);
        } catch (err: any) {
          if (err?.status === 409) {
            const fresh = await client.listProjects().catch(() => [] as ProjectInfo[]);
            setProjects(fresh);
            project = fresh.find(
              (p) => p.name.toLowerCase() === trimmedProject.toLowerCase(),
            );
          }
          if (!project) {
            if (!(err as any)?.handled) {
              const msg = err instanceof Error ? err.message : String(err);
              setError(`Could not create project: ${msg}`);
            }
            setSaving(false);
            return;
          }
        }
      }

      // Create script in the project
      const content = buildContent();
      const scriptResp = await client.createScript(project.id, {
        title: trimmedFile,
        content: content || undefined,
      });

      saveLastProjectName(trimmedProject);
      onSaved(project.id, trimmedProject, scriptResp.meta.id, trimmedFile, destination);
    } catch (err) {
      // AuthGate / QuotaExceededDialog already showed a dialog for these —
      // don't duplicate the raw message inline.
      if (!(err as any)?.handled) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && projectName.trim() && fileName.trim()) {
      setDropdownOpen(false);
      handleSave();
    } else if (e.key === 'Escape') {
      if (dropdownOpen) {
        setDropdownOpen(false);
      } else {
        onClose();
      }
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="dialog-header">Save Screenplay</div>
        <div className="dialog-body">
          {!WEB_ONLY_CLOUD && (
            <div className="dialog-row" style={{ marginBottom: 12 }}>
              <label>Save to</label>
              <div className="open-file-source-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={destination === 'local'}
                  className={`open-file-source-tab ${destination === 'local' ? 'active' : ''}`}
                  onClick={() => setDestination('local')}
                >
                  <FaDesktop /> This device
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={destination === 'cloud'}
                  className={`open-file-source-tab ${destination === 'cloud' ? 'active' : ''}`}
                  onClick={() => setDestination('cloud')}
                >
                  <FaCloud /> OpenDraft Cloud
                </button>
              </div>
              {destination === 'cloud' && !signedIn && (
                <div style={{ fontSize: 12, color: '#ff9966', marginTop: 6 }}>
                  Sign in to save to OpenDraft Cloud — pressing Save will open the login dialog.
                </div>
              )}
            </div>
          )}
          <div className="dialog-row">
            <label>Project</label>
            <div ref={comboRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 0 }}>
                <input
                  ref={inputRef}
                  value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    setIsTyping(true);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => { setIsTyping(false); setDropdownOpen(true); }}
                  placeholder="Project name"
                  style={{ flex: 1, borderRadius: '4px 0 0 4px' }}
                />
                <button
                  type="button"
                  onClick={() => { setIsTyping(false); setDropdownOpen((v) => !v); }}
                  style={{
                    width: 32,
                    border: '1px solid var(--fd-border)',
                    borderLeft: 'none',
                    borderRadius: '0 4px 4px 0',
                    background: 'var(--fd-bg)',
                    color: 'var(--fd-text)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    padding: 0,
                  }}
                  tabIndex={-1}
                >
                  &#9662;
                </button>
              </div>
              {dropdownOpen && filteredProjects.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    maxHeight: 160,
                    overflowY: 'auto',
                    background: 'var(--fd-menu-bg, var(--fd-bg))',
                    border: '1px solid var(--fd-border)',
                    borderRadius: 4,
                    marginTop: 2,
                    zIndex: 10,
                    boxShadow: '0 4px 12px rgba(0,0,0,.3)',
                  }}
                >
                  {filteredProjects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectProject(p.name)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: 'var(--fd-text)',
                        background:
                          p.name.toLowerCase() === projectName.toLowerCase()
                            ? 'var(--fd-menu-hover)'
                            : 'transparent',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--fd-menu-hover)')}
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          p.name.toLowerCase() === projectName.toLowerCase()
                            ? 'var(--fd-menu-hover)'
                            : 'transparent')
                      }
                    >
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="dialog-row" style={{ marginTop: 12 }}>
            <label>File Name</label>
            <input
              ref={fileInputRef}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="First Draft"
            />
          </div>
          {error && (
            <div style={{ color: '#ff6b6b', fontSize: 12, marginTop: 8 }}>{error}</div>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="dialog-primary"
            onClick={handleSave}
            disabled={saving || !projectName.trim() || !fileName.trim()}
          >
            {saving
              ? 'Saving...'
              : destination === 'cloud' ? 'Save to Cloud' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveAsDialog;
