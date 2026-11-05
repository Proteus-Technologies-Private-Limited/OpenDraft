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
import { useTranslation } from 'react-i18next';
import { compareText, formatDate } from '../i18n/format';
import { FaChevronRight, FaCloud, FaDesktop, FaSearch, FaThLarge } from 'react-icons/fa';
import { api } from '../services/api';
import { cloudApi } from '../services/cloudApi';
import { isWeb } from '../services/platform';
import { useSettingsStore } from '../stores/settingsStore';
import type { ProjectInfo, ScriptMeta } from '../services/api';
import Select from './Select';

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
  /** Go to Manage Projects, on the tab for `source`. Renaming and deleting
   *  happen there, not here, so the dialog says where. */
  onManageProjects?: (source: OpenSource) => void;
  /** Go straight to one project's page in Manage Projects. */
  onManageProject?: (project: ProjectInfo, source: OpenSource) => void;
}

type SortKey =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'name_asc'
  | 'name_desc';

const SORT_KEYS: SortKey[] = ['updated_desc', 'updated_asc', 'created_desc', 'name_asc', 'name_desc'];

function compareScripts(a: ScriptMeta, b: ScriptMeta, sort: SortKey): number {
  switch (sort) {
    case 'name_asc':
      return compareText(a.title, b.title);
    case 'name_desc':
      return compareText(b.title, a.title);
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

const OpenFile: React.FC<OpenFileProps> = ({ onOpen, onClose, onManageProjects, onManageProject }) => {
  const { t } = useTranslation(['projects', 'common']);

  const sortLabel = (key: SortKey): string => {
    switch (key) {
      case 'updated_asc': return t('open.sort.updatedAsc');
      case 'created_desc': return t('open.sort.createdDesc');
      case 'name_asc': return t('open.sort.nameAsc');
      case 'name_desc': return t('open.sort.nameDesc');
      case 'updated_desc':
      default: return t('open.sort.updatedDesc');
    }
  };

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
        if (!cancelled) setError(err?.message || t('open.loadFailed'));
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
        <div className="dialog-header">{t('common:open')}</div>

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
                <FaDesktop /> {t('open.thisDevice')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={source === 'cloud'}
                className={`open-file-source-tab ${source === 'cloud' ? 'active' : ''}`}
                onClick={() => setSource('cloud')}
              >
                <FaCloud /> {/* i18n-ignore: product name */}OpenDraft Cloud
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
                placeholder={t('open.searchPlaceholder')}
                autoFocus
              />
            </div>
            <Select
              className="open-file-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label={t('open.sortLabel')}
            >
              {SORT_KEYS.map((key) => (
                <option key={key} value={key}>{sortLabel(key)}</option>
              ))}
            </Select>
          </div>
        </div>

        <div
          className="dialog-body"
          style={{ maxHeight: 440, overflow: 'auto', padding: '8px 16px 16px' }}
        >
          {source === 'cloud' && !signedIn ? (
            <div className="open-file-empty">
              {t('open.signInPrompt')}
            </div>
          ) : loading ? (
            <div className="open-file-empty">{t('common:loading')}</div>
          ) : error ? (
            <div className="open-file-error">{error}</div>
          ) : visibleGroups.length === 0 ? (
            <div className="open-file-empty">
              {query
                ? t('open.noMatch', { query })
                : source === 'cloud'
                  ? t('open.emptyCloud')
                  : t('open.emptyLocal')}
            </div>
          ) : (
            visibleGroups.map((g) => (
              <div key={g.project.id} style={{ marginBottom: 12 }}>
                <div className="open-project-group-header open-project-group-header--manage">
                  <span>{g.project.name}</span>
                  {onManageProject && (
                    <button
                      type="button"
                      className="open-project-manage"
                      onClick={() => onManageProject(g.project, source)}
                      title={t('open.manageProjectTitle', { name: g.project.name })}
                    >
                      {t('open.manage')} <FaChevronRight aria-hidden="true" />
                    </button>
                  )}
                </div>
                {g.scripts.map((s) => (
                  <div
                    key={s.id}
                    className="open-project-item"
                    onClick={() => onOpen(g.project.id, g.project, s.id, s.title, source)}
                  >
                    <span className="open-project-name">{s.title}</span>
                    <span className="open-project-date">
                      {formatDate(s.updated_at, { year: 'numeric', month: 'numeric', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className={`dialog-actions${onManageProjects ? ' open-file-actions' : ''}`}>
          {onManageProjects && (
            <span className="open-file-manage-hint">
              {t('open.manageHint')}
              <button
                type="button"
                className="open-file-manage-link"
                onClick={() => onManageProjects(source)}
              >
                <FaThLarge aria-hidden="true" /> {t('open.manageProjects')}
              </button>
            </span>
          )}
          <button onClick={onClose}>{t('common:cancel')}</button>
        </div>
      </div>
    </div>
  );
};

export default OpenFile;
