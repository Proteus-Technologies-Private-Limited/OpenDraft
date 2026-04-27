import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FaCloud, FaDesktop } from 'react-icons/fa';
import { api } from '../services/api';
import { cloudApi } from '../services/cloudApi';
import { isWeb } from '../services/platform';
import { getApiBase } from '../config';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { ProjectInfo } from '../services/api';
import { importProjectFromZip } from '../utils/zipImport';
import { showToast } from './Toast';

type ProjectSource = 'local' | 'cloud';

/** Web is always cloud; the toggle would be misleading. */
const WEB_ONLY_CLOUD = isWeb();

const ITEM_COLORS = [
  '#e06060', '#e89b4f', '#f4d35e', '#6abf69',
  '#4a9eff', '#6fa8dc', '#b58ee0', '#9370DB',
  '#e06c9f', '#d4a373', '#95a5a6', '',
];

type SortKey = 'custom' | 'name' | 'created' | 'updated' | 'color';

interface ProjectWithCount extends ProjectInfo {
  script_count: number;
}

// ── Sortable card wrapper ────────────────────────────────────────────────

interface SortableCardProps {
  project: ProjectWithCount;
  sortKey: SortKey;
  source: ProjectSource;
  onNavigate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  formatDate: (iso: string) => string;
}

const SortableCard: React.FC<SortableCardProps> = ({
  project,
  sortKey,
  source,
  onNavigate,
  onPin,
  onColor,
  onDelete,
  onRename,
  formatDate,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: sortKey !== 'custom' });

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Close the actions dropdown when clicking outside the card. Without this,
  // the menu stays open as the user moves around the page.
  React.useEffect(() => {
    if (!showActions) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActions]);

  const handleRenameSubmit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(project.id, trimmed);
    } else {
      setEditName(project.name);
    }
    setEditing(false);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={(node) => { setNodeRef(node); cardRef.current = node; }}
      style={style}
      className={`project-card${project.pinned ? ' pinned' : ''}`}
    >
      {/* Color stripe */}
      {project.color && (
        <div
          className="project-card-color-stripe"
          style={{ backgroundColor: project.color }}
        />
      )}

      {/* Drag handle */}
      {sortKey === 'custom' && (
        <div className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          &#x2630;
        </div>
      )}

      {/* Card body — clicking navigates, double-click name to rename */}
      <div className="project-card-body" onClick={() => !editing && onNavigate(project.id)}>
        {editing ? (
          <input
            className="inline-rename-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') { setEditName(project.name); setEditing(false); }
            }}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <div
            className="project-card-name"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(project.name); }}
            title="Double-click to rename"
          >
            {project.name}
          </div>
        )}
        <div className="project-card-meta">
          <span>
            {project.script_count} screenplay{project.script_count !== 1 ? 's' : ''}
          </span>
          <span className="project-card-dot">&middot;</span>
          <span
            className={`source-badge source-badge--${source}`}
            title={source === 'cloud' ? 'Stored on OpenDraft Cloud' : 'Stored on this device'}
          >
            {source === 'cloud' ? <FaCloud /> : <FaDesktop />}
            {source === 'cloud' ? 'Cloud' : 'Local'}
          </span>
        </div>
        <div className="project-card-meta">
          <span>Created {formatDate(project.created_at)}</span>
          <span className="project-card-dot">&middot;</span>
          <span>Modified {formatDate(project.updated_at)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="project-card-actions">
        <button
          className={`card-action-btn pin-btn${project.pinned ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onPin(project.id, !project.pinned); }}
          title={project.pinned ? 'Unpin' : 'Pin to top'}
        >
          &#x1F4CC;
        </button>
        <button
          className="card-action-btn color-btn"
          onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
          title="Set color"
        >
          <span
            className="color-dot"
            style={{ backgroundColor: project.color || '#666' }}
          />
        </button>
        <button
          className="card-action-btn more-btn"
          onClick={(e) => { e.stopPropagation(); setShowActions((v) => !v); }}
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={showActions}
        >
          &#x22EE;
        </button>
      </div>

      {/* Actions dropdown — Rename and Delete are reachable regardless of
          whether the project has scripts. Confirmation for non-empty
          projects is handled by the parent's pendingDelete dialog. */}
      {showActions && (
        <div className="script-actions-dropdown script-card-dropdown" onClick={(e) => e.stopPropagation()} role="menu">
          <div
            className="dropdown-item"
            role="menuitem"
            onClick={() => { setShowActions(false); setEditing(true); setEditName(project.name); }}
          >
            Rename
          </div>
          <div className="dropdown-separator" />
          <div
            className="dropdown-item dropdown-item-danger"
            role="menuitem"
            onClick={() => { setShowActions(false); onDelete(project.id); }}
          >
            Delete
          </div>
        </div>
      )}

      {/* Color picker dropdown */}
      {showColorPicker && (
        <div className="color-picker-dropdown" onClick={(e) => e.stopPropagation()}>
          {ITEM_COLORS.map((c) => (
            <button
              key={c || 'none'}
              className={`color-picker-swatch${project.color === c ? ' selected' : ''}`}
              style={{ backgroundColor: c || '#555' }}
              onClick={() => { onColor(project.id, c); setShowColorPicker(false); }}
              title={c || 'No color'}
            >
              {!c && <span className="color-none-x">&#x2715;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

const ProjectList: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<ProjectSource>(() => {
    if (WEB_ONLY_CLOUD) return 'cloud';
    return ((localStorage.getItem('opendraft:projectSource') as ProjectSource) || 'local');
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    return (localStorage.getItem('opendraft:projectSort') as SortKey) || 'custom';
  });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const accessToken = useSettingsStore((s) => s.collabAuth.accessToken);
  const authVerified = useSettingsStore((s) => s.authVerified);
  const signedIn = Boolean(accessToken && authVerified);
  const syncCloudProjects = useProjectStore((s) => s.syncCloudProjects);
  const markCloudProject = useProjectStore((s) => s.markCloudProject);
  const unmarkCloudProject = useProjectStore((s) => s.unmarkCloudProject);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Persist the chosen tab so reopening the app remembers what the user was
  // browsing last. Web stays locked to 'cloud' so we don't clobber that.
  useEffect(() => {
    if (!WEB_ONLY_CLOUD) {
      try { localStorage.setItem('opendraft:projectSource', source); } catch { /* ignore */ }
    }
  }, [source]);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      // Cloud listing requires a verified login. Empty state with a hint is
      // better than a confusing "no projects" when the user just hasn't
      // signed in yet.
      if (source === 'cloud' && !signedIn) {
        setProjects([]);
        setLoading(false);
        return;
      }
      const client = source === 'cloud' ? cloudApi : api;
      const projectList = await client.listProjects();
      // Keep the cloud-project marker set in sync with what the server
      // currently returns. ProjectView reads this to dispatch reads/writes
      // to cloudApi.
      if (source === 'cloud') {
        syncCloudProjects(projectList.map((p) => p.id));
      }
      const withCounts: ProjectWithCount[] = await Promise.all(
        projectList.map(async (p) => {
          try {
            const scripts = await client.listScripts(p.id);
            return { ...p, script_count: scripts.length };
          } catch {
            return { ...p, script_count: 0 };
          }
        }),
      );
      setProjects(withCounts);
    } catch (err) {
      setProjects([]);
      setErrorMsg(err instanceof Error ? err.message : 'Could not load projects');
    }
    setLoading(false);
  }, [source, signedIn, syncCloudProjects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    localStorage.setItem('opendraft:projectSort', sortKey);
  }, [sortKey]);

  // ── Sorting ──

  const { pinnedProjects, unpinnedProjects } = React.useMemo(() => {
    const list = [...projects];

    const compareFn = (a: ProjectWithCount, b: ProjectWithCount): number => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        case 'color':
          return (a.color || 'zzz').localeCompare(b.color || 'zzz');
        case 'custom':
        default:
          return a.sort_order - b.sort_order;
      }
    };

    // Pinned items sorted by sort_order only, unpinned by user-selected sort
    const pinned = list.filter((p) => p.pinned).sort((a, b) => a.sort_order - b.sort_order);
    const unpinned = list.filter((p) => !p.pinned).sort(compareFn);
    return { pinnedProjects: pinned, unpinnedProjects: unpinned };
  }, [projects, sortKey]);

  const allSortedProjects = React.useMemo(
    () => [...pinnedProjects, ...unpinnedProjects],
    [pinnedProjects, unpinnedProjects],
  );

  // ── Handlers ──

  /** All mutations route through whichever backend currently owns this view.
   *  Cloud view → cloudApi. Local view → api (local SQLite on Tauri). */
  const client = source === 'cloud' ? cloudApi : api;

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    if (source === 'cloud' && !signedIn) {
      window.dispatchEvent(new CustomEvent('opendraft:auth-required'));
      return;
    }
    setCreating(true);
    try {
      const created = await client.createProject(newProjectName.trim());
      if (source === 'cloud') markCloudProject(created.id);
      setShowNewDialog(false);
      setNewProjectName('');
      await fetchProjects();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create project', 'error');
    }
    setCreating(false);
  };

  const handleRename = useCallback(
    async (id: string, name: string) => {
      const prev = projects.find((p) => p.id === id);
      setProjects((list) =>
        list.map((p) => (p.id === id ? { ...p, name } : p)),
      );
      try {
        await client.updateProject(id, { name });
      } catch {
        if (prev) {
          setProjects((list) =>
            list.map((p) => (p.id === id ? { ...p, name: prev.name } : p)),
          );
        }
      }
    },
    [projects, client],
  );

  const handlePin = useCallback(
    async (id: string, pinned: boolean) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, pinned } : p)),
      );
      try {
        await client.updateProject(id, { pinned });
      } catch {
        // revert on failure
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, pinned: !pinned } : p)),
        );
      }
    },
    [client],
  );

  const handleColor = useCallback(
    async (id: string, color: string) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, color } : p)),
      );
      try {
        await client.updateProject(id, { color });
      } catch {
        // silently fail — color already updated visually
      }
    },
    [client],
  );

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      await client.deleteProject(pendingDeleteId);
      if (source === 'cloud') unmarkCloudProject(pendingDeleteId);
      showToast('Project deleted', 'success');
      await fetchProjects();
    } catch (err) {
      showToast(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, fetchProjects, client, source, unmarkCloudProject]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = allSortedProjects.findIndex((p) => p.id === active.id);
      const newIndex = allSortedProjects.findIndex((p) => p.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = [...allSortedProjects];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // Assign new sort_order values
      const updated = reordered.map((p, i) => ({ ...p, sort_order: i }));
      setProjects(updated);

      // Persist
      client.reorderProjects(updated.map((p) => ({ id: p.id, sort_order: p.sort_order }))).catch(() => {});
    },
    [allSortedProjects, client],
  );

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="project-list-page">
      {!WEB_ONLY_CLOUD && (
        <div className="project-source-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={source === 'local'}
            className={`project-source-tab ${source === 'local' ? 'active' : ''}`}
            onClick={() => setSource('local')}
          >
            <FaDesktop /> This device
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'cloud'}
            className={`project-source-tab ${source === 'cloud' ? 'active' : ''}`}
            onClick={() => setSource('cloud')}
          >
            <FaCloud /> OpenDraft Cloud
          </button>
        </div>
      )}

      <div className="project-list-header">
        <div className="project-list-title-area">
          <h1 className="project-list-title">Projects</h1>
          <span className="project-list-subtitle">
            {source === 'cloud' ? 'OpenDraft Cloud' : 'On this device'}
            {source === 'cloud' && getApiBase() && (
              <>
                {' · '}
                <span title="Server this app is talking to">{getApiBase()}</span>
              </>
            )}
          </span>
        </div>
        <div className="project-list-controls">
          <select
            className="sort-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="custom">Custom Order</option>
            <option value="name">Name</option>
            <option value="created">Created</option>
            <option value="updated">Last Modified</option>
            <option value="color">Color</option>
          </select>
          {source === 'local' && (
            <button
              className="project-new-btn project-secondary-btn"
              onClick={async () => {
                try {
                  const { openBinaryFile } = await import('../utils/fileOps');
                  const result = await openBinaryFile([
                    { name: 'ZIP Archive', extensions: ['zip'] },
                  ]);
                  if (!result) return;
                  const newId = await importProjectFromZip(result.content);
                  await fetchProjects();
                  showToast('Project imported', 'success');
                  navigate(`/project/${newId}`);
                } catch (err) {
                  showToast(
                    `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                    'error',
                  );
                }
              }}
            >
              Import Project
            </button>
          )}
          <button
            className="project-new-btn"
            onClick={() => setShowNewDialog(true)}
          >
            + New Project
          </button>
        </div>
      </div>

      {loading ? (
        <div className="project-list-loading">Loading projects...</div>
      ) : source === 'cloud' && !signedIn ? (
        <div className="project-list-empty">
          <div className="project-list-empty-icon">&#9729;</div>
          <div>Sign in to access OpenDraft Cloud projects. Click the "Local only" indicator at the top to sign in.</div>
        </div>
      ) : errorMsg ? (
        <div className="project-list-empty">
          <div className="project-list-empty-icon">&#9888;</div>
          <div>{errorMsg}</div>
        </div>
      ) : projects.length === 0 ? (
        <div className="project-list-empty">
          <div className="project-list-empty-icon">&#128209;</div>
          <div>
            {source === 'cloud'
              ? 'No cloud projects yet. Create one or upload via File › Save to Cloud from the editor.'
              : 'No projects yet. Create your first project to get started.'}
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {pinnedProjects.length > 0 && (
            <>
              <div className="pinned-section-header">Pinned</div>
              <SortableContext
                items={pinnedProjects.map((p) => p.id)}
                strategy={rectSortingStrategy}
              >
                <div className="project-list-grid">
                  {pinnedProjects.map((project) => (
                    <SortableCard
                      key={project.id}
                      project={project}
                      sortKey={sortKey}
                      source={source}
                      onNavigate={(id) => navigate(`/project/${id}`)}
                      onPin={handlePin}
                      onColor={handleColor}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      formatDate={formatDate}
                    />
                  ))}
                </div>
              </SortableContext>
            </>
          )}
          {unpinnedProjects.length > 0 && (
            <>
              <div className="section-header">All Projects</div>
              <SortableContext
                items={unpinnedProjects.map((p) => p.id)}
                strategy={rectSortingStrategy}
              >
                <div className="project-list-grid">
                  {unpinnedProjects.map((project) => (
                    <SortableCard
                      key={project.id}
                      project={project}
                      sortKey={sortKey}
                      source={source}
                      onNavigate={(id) => navigate(`/project/${id}`)}
                      onPin={handlePin}
                      onColor={handleColor}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      formatDate={formatDate}
                    />
                  ))}
                </div>
              </SortableContext>
            </>
          )}
        </DndContext>
      )}

      {/* New Project Dialog */}
      {showNewDialog && (
        <div className="dialog-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">New Project</div>
            <div className="dialog-body">
              <div className="dialog-row">
                <label>Project Name:</label>
                <input
                  type="text"
                  placeholder="My Screenplay"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProject();
                    if (e.key === 'Escape') setShowNewDialog(false);
                  }}
                  autoFocus
                />
              </div>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewDialog(false)}>Cancel</button>
              <button
                className="dialog-primary"
                onClick={handleCreateProject}
                disabled={creating || !newProjectName.trim()}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {pendingDeleteId && (
        <div className="dialog-overlay" onClick={() => setPendingDeleteId(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Project</div>
            <div className="dialog-body">
              <p>
                Are you sure you want to delete this project? This cannot be
                undone.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteId(null)}>Cancel</button>
              <button
                className="dialog-primary"
                style={{ background: '#c0392b' }}
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectList;
