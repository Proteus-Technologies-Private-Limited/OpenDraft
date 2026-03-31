import React, { useState, useEffect, useCallback } from 'react';
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
import { api } from '../services/api';
import type { ProjectInfo } from '../services/api';
import { showToast } from './Toast';

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
  onNavigate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  formatDate: (iso: string) => string;
}

const SortableCard: React.FC<SortableCardProps> = ({
  project,
  sortKey,
  onNavigate,
  onPin,
  onColor,
  onDelete,
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

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
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

      {/* Card body — clicking navigates */}
      <div className="project-card-body" onClick={() => onNavigate(project.id)}>
        <div className="project-card-name">{project.name}</div>
        <div className="project-card-meta">
          <span>
            {project.script_count} script{project.script_count !== 1 ? 's' : ''}
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
        {project.script_count === 0 && (
          <button
            className="card-action-btn delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
            title="Delete empty project"
          >
            &#x2715;
          </button>
        )}
      </div>

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
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    return (localStorage.getItem('opendraft:projectSort') as SortKey) || 'custom';
  });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const projectList = await api.listProjects();
      const withCounts: ProjectWithCount[] = await Promise.all(
        projectList.map(async (p) => {
          try {
            const scripts = await api.listScripts(p.id);
            return { ...p, script_count: scripts.length };
          } catch {
            return { ...p, script_count: 0 };
          }
        }),
      );
      setProjects(withCounts);
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    localStorage.setItem('opendraft:projectSort', sortKey);
  }, [sortKey]);

  // ── Sorting ──

  const sortedProjects = React.useMemo(() => {
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

    // Pinned items always first, then sort within each group
    const pinned = list.filter((p) => p.pinned).sort(compareFn);
    const unpinned = list.filter((p) => !p.pinned).sort(compareFn);
    return [...pinned, ...unpinned];
  }, [projects, sortKey]);

  // ── Handlers ──

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      await api.createProject(newProjectName.trim());
      setShowNewDialog(false);
      setNewProjectName('');
      await fetchProjects();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create project', 'error');
    }
    setCreating(false);
  };

  const handlePin = useCallback(
    async (id: string, pinned: boolean) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, pinned } : p)),
      );
      try {
        await api.updateProject(id, { pinned });
      } catch {
        // revert on failure
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, pinned: !pinned } : p)),
        );
      }
    },
    [],
  );

  const handleColor = useCallback(
    async (id: string, color: string) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, color } : p)),
      );
      try {
        await api.updateProject(id, { color });
      } catch {
        // silently fail — color already updated visually
      }
    },
    [],
  );

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      await api.deleteProject(pendingDeleteId);
      showToast('Project deleted', 'success');
      await fetchProjects();
    } catch (err) {
      showToast(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
    setPendingDeleteId(null);
  }, [pendingDeleteId, fetchProjects]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortedProjects.findIndex((p) => p.id === active.id);
      const newIndex = sortedProjects.findIndex((p) => p.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = [...sortedProjects];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // Assign new sort_order values
      const updated = reordered.map((p, i) => ({ ...p, sort_order: i }));
      setProjects(updated);

      // Persist
      api.reorderProjects(updated.map((p) => ({ id: p.id, sort_order: p.sort_order }))).catch(() => {});
    },
    [sortedProjects],
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
      <div className="project-list-header">
        <div className="project-list-title-area">
          <h1 className="project-list-title">Open Draft</h1>
          <span className="project-list-subtitle">Your Projects</span>
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
      ) : projects.length === 0 ? (
        <div className="project-list-empty">
          <div className="project-list-empty-icon">&#128209;</div>
          <div>No projects yet. Create your first project to get started.</div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedProjects.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            <div className="project-list-grid">
              {sortedProjects.map((project) => (
                <SortableCard
                  key={project.id}
                  project={project}
                  sortKey={sortKey}
                  onNavigate={(id) => navigate(`/project/${id}`)}
                  onPin={handlePin}
                  onColor={handleColor}
                  onDelete={handleDelete}
                  formatDate={formatDate}
                />
              ))}
            </div>
          </SortableContext>
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
