/**
 * OpenFile — unified Open dialog replacing the separate Open-from-Project and
 * Open-from-Cloud dialogs.
 *
 * On the desktop / mobile app:
 *   - Source toggle at the top (This device / OpenDraft Cloud).
 *   - "This device" reads via `api` which is swapped to local SQLite.
 *   - "OpenDraft Cloud" reads via `cloudApi` (HTTP + auth).
 * In the browser:
 *   - No toggle — everything on the web is cloud-backed. We always go through
 *     `cloudApi` since that's the only real source.
 *
 * Also adds:
 *   - Search box that filters both project and script titles.
 *   - Sort options: name A-Z / Z-A, updated recent first / oldest first,
 *     created recent first.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FaCloud, FaDesktop, FaSearch } from 'react-icons/fa';
import { api } from '../services/api';
import { cloudApi } from '../services/cloudApi';
import { isWeb } from '../services/platform';
import { useSettingsStore } from '../stores/settingsStore';
import type { ProjectInfo, ScriptMeta } from '../services/api';

export type OpenSource = 'local' | 'cloud';

interface ProjectWithScripts {
  project: ProjectInfo;
  scripts: ScriptMeta[];
}

interface OpenFileProps {
  onOpen: (
    projectId: string,
    project: ProjectInfo,
    scriptId: string,
    scriptTitle: string,
    source: OpenSource,
  ) => void;
  onClose: () => void;
}

type SortKey =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'name_asc'
  | 'name_desc';

const SORT_LABELS: Record<SortKey, string> = {
  updated_desc: 'Last modified (newest)',
  updated_asc: 'Last modified (oldest)',
  created_desc: 'Date created (newest)',
  name_asc: 'Name (A → Z)',
  name_desc: 'Name (Z → A)',
};

function compareScripts(a: ScriptMeta, b: ScriptMeta, sort: SortKey): number {
  switch (sort) {
    case 'name_asc':
      return a.title.localeCompare(b.title);
    case 'name_desc':
      return b.title.localeCompare(a.title);
    case 'updated_asc':
      return (a.updated_at || '').localeCompare(b.updated_at || '');
    case 'created_desc':
      return (b.created_at || '').localeCompare(a.created_at || '');
    case 'updated_desc':
    default:
      return (b.updated_at || '').localeCompare(a.updated_at || '');
  }
}

/** Web is always cloud. Desktop/mobile apps let the user pick. */
const WEB_ONLY_CLOUD = isWeb();

const OpenFile: React.FC<OpenFileProps> = ({ onOpen, onClose }) => {
  // Only treat the user as signed in once the token has been verified against
  // the server this session. A stale localStorage token shouldn't let us hit
  // the cloud API — the request would fail anyway.
  const accessToken = useSettingsStore((s) => s.collabAuth.accessToken);
  const authVerified = useSettingsStore((s) => s.authVerified);
  const signedIn = Boolean(accessToken && authVerified);
  const [source, setSource] = useState<OpenSource>(WEB_ONLY_CLOUD ? 'cloud' : 'local');
  const [groups, setGroups] = useState<ProjectWithScripts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated_desc');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setGroups([]);

    if (source === 'cloud' && !signedIn) {
      setLoading(false);
      // On the web, cloud is the only storage source. If the user isn't
      // signed in, pop the login dialog immediately instead of showing a
      // "please sign in" empty state — there's nowhere else they could go.
      // On the app (Tauri), the empty state is useful because the user can
      // switch to the "This device" tab.
      if (WEB_ONLY_CLOUD) {
        try {
          window.dispatchEvent(new CustomEvent('opendraft:auth-required'));
        } catch { /* no-op */ }
      }
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const client = source === 'cloud' ? cloudApi : api;
        const projects = await client.listProjects();
        const all = await Promise.all(
          projects.map(async (project) => {
            try {
              const scripts = await client.listScripts(project.id);
              return { project, scripts };
            } catch {
              return { project, scripts: [] };
            }
          }),
        );
        if (!cancelled) {
          setGroups(all.filter((g) => g.scripts.length > 0));
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load files');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [source, signedIn]);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = groups
      .map((g) => {
        const projectMatch = q && g.project.name.toLowerCase().includes(q);
        const scripts = g.scripts
          .filter((s) => !q || projectMatch || s.title.toLowerCase().includes(q))
          .slice()
          .sort((a, b) => compareScripts(a, b, sort));
        return { project: g.project, scripts };
      })
      .filter((g) => g.scripts.length > 0);
    return filtered;
  }, [groups, query, sort]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box open-from-project-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header">Open</div>

        <div className="open-file-controls">
          {!WEB_ONLY_CLOUD && (
            <div className="open-file-source-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={source === 'local'}
                className={`open-file-source-tab ${source === 'local' ? 'active' : ''}`}
                onClick={() => setSource('local')}
              >
                <FaDesktop /> This device
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={source === 'cloud'}
                className={`open-file-source-tab ${source === 'cloud' ? 'active' : ''}`}
                onClick={() => setSource('cloud')}
              >
                <FaCloud /> OpenDraft Cloud
              </button>
            </div>
          )}

          <div className="open-file-search-row">
            <div className="open-file-search">
              <FaSearch className="open-file-search-icon" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects and scripts…"
                autoFocus
              />
            </div>
            <select
              className="open-file-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort"
            >
              {Object.entries(SORT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="dialog-body"
          style={{ maxHeight: 440, overflow: 'auto', padding: '8px 16px 16px' }}
        >
          {source === 'cloud' && !signedIn ? (
            <div className="open-file-empty">
              Sign in to access your OpenDraft Cloud files. Click the indicator in the
              menu bar to sign in.
            </div>
          ) : loading ? (
            <div className="open-file-empty">Loading…</div>
          ) : error ? (
            <div className="open-file-error">{error}</div>
          ) : visibleGroups.length === 0 ? (
            <div className="open-file-empty">
              {query
                ? `No files match “${query}”.`
                : source === 'cloud'
                  ? 'No cloud files yet. Use File › Save to Cloud to upload.'
                  : 'No files yet. Use File › Import to create a project.'}
            </div>
          ) : (
            visibleGroups.map((g) => (
              <div key={g.project.id} style={{ marginBottom: 12 }}>
                <div className="open-project-group-header">{g.project.name}</div>
                {g.scripts.map((s) => (
                  <div
                    key={s.id}
                    className="open-project-item"
                    onClick={() => onOpen(g.project.id, g.project, s.id, s.title, source)}
                  >
                    <span className="open-project-name">{s.title}</span>
                    <span className="open-project-date">
                      {new Date(s.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default OpenFile;
