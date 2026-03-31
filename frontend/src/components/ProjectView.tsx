import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../services/api';
import type { ProjectInfo, ScriptMeta, VersionInfo } from '../services/api';
import { parseFountain } from '../utils/fountainParser';
import { parseFDXFull } from '../utils/fdxParser';
import { downloadFDX } from '../utils/fdxExporter';
import { downloadFountain } from '../utils/fountainExporter';
import { exportPDF } from '../utils/pdfExporter';
import { downloadOdraft, parseOdraft } from '../utils/odraftFormat';
import { exportProjectAsZip } from '../utils/zipExport';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import AssetManager from './AssetManager';
import ProjectPropertiesDialog from './ProjectPropertiesDialog';
import { showToast } from './Toast';

const ITEM_COLORS = [
  '#e06060', '#e89b4f', '#f4d35e', '#6abf69',
  '#4a9eff', '#6fa8dc', '#b58ee0', '#9370DB',
  '#e06c9f', '#d4a373', '#95a5a6', '',
];

type TabKey = 'scripts' | 'assets' | 'versions';
type ScriptSortKey = 'custom' | 'title' | 'created' | 'updated' | 'color' | 'size' | 'pages';

// ── Sortable script row ──────────────────────────────────────────────────

interface SortableScriptRowProps {
  script: ScriptMeta;
  projectId: string;
  sortKey: ScriptSortKey;
  onNavigate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string, format: string) => void;
  formatDate: (iso: string) => string;
  formatSize: (bytes: number) => string;
}

const SortableScriptRow: React.FC<SortableScriptRowProps> = ({
  script,
  sortKey,
  onNavigate,
  onPin,
  onColor,
  onDelete,
  onRename,
  onDuplicate,
  onExport,
  formatDate,
  formatSize,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: script.id, disabled: sortKey !== 'custom' });

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(script.title);
  const rowRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showActions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showActions]);

  const handleRenameSubmit = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== script.title) {
      onRename(script.id, trimmed);
    } else {
      setEditTitle(script.title);
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
      ref={(node) => { setNodeRef(node); (rowRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
      style={style}
      className={`project-script-item${script.pinned ? ' pinned' : ''}`}
    >
      {/* Color indicator */}
      {script.color && (
        <div
          className="script-color-indicator"
          style={{ backgroundColor: script.color }}
        />
      )}

      {/* Drag handle */}
      {sortKey === 'custom' && (
        <div className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          &#x2630;
        </div>
      )}

      <div className="project-script-info" onClick={() => { if (showActions) { setShowActions(false); return; } if (!editing) onNavigate(script.id); }}>
        {editing ? (
          <input
            className="inline-rename-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') { setEditTitle(script.title); setEditing(false); }
            }}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <div
            className="project-script-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditTitle(script.title); }}
            title="Double-click to rename"
          >
            {script.title}
          </div>
        )}
        <div className="project-script-meta">
          <span>Created {formatDate(script.created_at)}</span>
          <span className="project-card-dot">&middot;</span>
          <span>Modified {formatDate(script.updated_at)}</span>
          {script.page_count > 0 && (
            <>
              <span className="project-card-dot">&middot;</span>
              <span>{script.page_count} pg</span>
            </>
          )}
          <span className="project-card-dot">&middot;</span>
          <span>{formatSize(script.size_bytes)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="script-item-actions">
        <button
          className={`card-action-btn pin-btn${script.pinned ? ' active' : ''}`}
          onClick={() => onPin(script.id, !script.pinned)}
          title={script.pinned ? 'Unpin' : 'Pin to top'}
        >
          &#x1F4CC;
        </button>
        <button
          className="card-action-btn color-btn"
          onClick={() => setShowColorPicker(!showColorPicker)}
          title="Set color"
        >
          <span
            className="color-dot"
            style={{ backgroundColor: script.color || '#666' }}
          />
        </button>
        <button
          className="card-action-btn more-btn"
          onClick={() => setShowActions(!showActions)}
          title="More actions"
        >
          &#x22EE;
        </button>
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <div className="script-actions-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-item" onClick={() => { setEditing(true); setEditTitle(script.title); setShowActions(false); }}>Rename</div>
          <div className="dropdown-item" onClick={() => { onDuplicate(script.id); setShowActions(false); }}>Duplicate</div>
          <div className="dropdown-separator" />
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fdx'); setShowActions(false); }}>Export as FDX</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fountain'); setShowActions(false); }}>Export as Fountain</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'pdf'); setShowActions(false); }}>Export as PDF</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'odraft'); setShowActions(false); }}>Export as .odraft</div>
          <div className="dropdown-separator" />
          <div className="dropdown-item dropdown-item-danger" onClick={() => { onDelete(script.id); setShowActions(false); }}>Delete</div>
        </div>
      )}

      {showColorPicker && (
        <div className="color-picker-dropdown" onClick={(e) => e.stopPropagation()}>
          {ITEM_COLORS.map((c) => (
            <button
              key={c || 'none'}
              className={`color-picker-swatch${script.color === c ? ' selected' : ''}`}
              style={{ backgroundColor: c || '#555' }}
              onClick={() => { onColor(script.id, c); setShowColorPicker(false); }}
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

// ── Script card (card view) ──────────────────────────────────────────────

interface ScriptCardProps {
  script: ScriptMeta;
  sortKey: ScriptSortKey;
  onNavigate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string, format: string) => void;
  onDelete: (id: string) => void;
  formatDate: (iso: string) => string;
}

const ScriptCard: React.FC<ScriptCardProps> = ({
  script,
  sortKey,
  onNavigate,
  onPin,
  onRename,
  onDuplicate,
  onExport,
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
  } = useSortable({ id: script.id, disabled: sortKey !== 'custom' });

  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(script.title);
  const cardRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showActions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showActions]);

  const handleRenameSubmit = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== script.title) {
      onRename(script.id, trimmed);
    } else {
      setEditTitle(script.title);
    }
    setEditing(false);
  };

  const handleCardClick = () => {
    // Don't navigate if menu is open, editing, or dragging
    if (showActions) { setShowActions(false); return; }
    if (editing) return;
    onNavigate(script.id);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={(node) => { setNodeRef(node); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
      style={style}
      className={`script-card${script.pinned ? ' pinned' : ''}`}
      onClick={handleCardClick}
    >
      {script.color && (
        <div className="script-card-color-stripe" style={{ backgroundColor: script.color }} />
      )}
      <div className="script-card-header">
        {/* Drag handle — only in custom sort */}
        {sortKey === 'custom' && (
          <div
            className="card-drag-handle"
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
          >
            &#x2630;
          </div>
        )}
        {editing ? (
          <input
            className="inline-rename-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') { setEditTitle(script.title); setEditing(false); }
            }}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <div
            className="script-card-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditTitle(script.title); }}
            title="Double-click to rename"
          >
            {script.title}
          </div>
        )}
        <div className="script-card-actions">
          <button
            className={`card-action-btn pin-btn${script.pinned ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onPin(script.id, !script.pinned); }}
            title={script.pinned ? 'Unpin' : 'Pin to top'}
          >
            &#x1F4CC;
          </button>
          <button
            className="card-action-btn more-btn"
            onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
            title="More actions"
          >
            &#x22EE;
          </button>
        </div>
      </div>
      <div className="script-card-preview">
        {script.preview || 'Empty screenplay'}
      </div>
      <div className="script-card-meta">
        {script.page_count > 0 && <span>{script.page_count} pg</span>}
        <span>{formatDate(script.updated_at)}</span>
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <div className="script-actions-dropdown script-card-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-item" onClick={() => { setEditing(true); setEditTitle(script.title); setShowActions(false); }}>Rename</div>
          <div className="dropdown-item" onClick={() => { onDuplicate(script.id); setShowActions(false); }}>Duplicate</div>
          <div className="dropdown-separator" />
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fdx'); setShowActions(false); }}>Export as FDX</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fountain'); setShowActions(false); }}>Export as Fountain</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'pdf'); setShowActions(false); }}>Export as PDF</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'odraft'); setShowActions(false); }}>Export as .odraft</div>
          <div className="dropdown-separator" />
          <div className="dropdown-item dropdown-item-danger" onClick={() => { onDelete(script.id); setShowActions(false); }}>Delete</div>
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

const ProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('scripts');
  const [loading, setLoading] = useState(true);

  const [showNewScript, setShowNewScript] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState('');
  const [creatingScript, setCreatingScript] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [editProjectName, setEditProjectName] = useState('');
  const [scriptSortKey, setScriptSortKey] = useState<ScriptSortKey>(() => {
    return (localStorage.getItem('opendraft:scriptSort') as ScriptSortKey) || 'custom';
  });
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => {
    return (localStorage.getItem('opendraft:scriptViewMode') as 'list' | 'card') || 'list';
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const p = await api.getProject(projectId);
      setProject(p);
    } catch {
      navigate('/');
    }
  }, [projectId, navigate]);

  const fetchScripts = useCallback(async () => {
    if (!projectId) return;
    try {
      const s = await api.listScripts(projectId);
      setScripts(s);
    } catch {
      // silently fail
    }
  }, [projectId]);

  const fetchVersions = useCallback(async () => {
    if (!projectId) return;
    try {
      const v = await api.getVersions(projectId);
      setVersions(Array.isArray(v) ? v : []);
    } catch {
      // silently fail
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProject(), fetchScripts(), fetchVersions()]).finally(() =>
      setLoading(false),
    );
  }, [fetchProject, fetchScripts, fetchVersions]);

  useEffect(() => {
    localStorage.setItem('opendraft:scriptSort', scriptSortKey);
  }, [scriptSortKey]);

  useEffect(() => {
    localStorage.setItem('opendraft:scriptViewMode', viewMode);
    // Re-fetch with previews when switching to card view
    if (viewMode === 'card' && projectId) {
      api.listScripts(projectId, true).then(setScripts).catch(() => {});
    }
  }, [viewMode, projectId]);

  // ── Sorting ──

  const { pinnedScripts, unpinnedScripts } = React.useMemo(() => {
    const list = [...scripts];
    const compareFn = (a: ScriptMeta, b: ScriptMeta): number => {
      switch (scriptSortKey) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        case 'color':
          return (a.color || 'zzz').localeCompare(b.color || 'zzz');
        case 'size':
          return b.size_bytes - a.size_bytes;
        case 'pages':
          return b.page_count - a.page_count;
        case 'custom':
        default:
          return a.sort_order - b.sort_order;
      }
    };
    // Pinned items sorted by sort_order only, unpinned by user-selected sort
    const pinned = list.filter((s) => s.pinned).sort((a, b) => a.sort_order - b.sort_order);
    const unpinned = list.filter((s) => !s.pinned).sort(compareFn);
    return { pinnedScripts: pinned, unpinnedScripts: unpinned };
  }, [scripts, scriptSortKey]);

  const allSortedScripts = React.useMemo(
    () => [...pinnedScripts, ...unpinnedScripts],
    [pinnedScripts, unpinnedScripts],
  );

  // ── Handlers ──

  const handleCreateScript = async () => {
    if (!projectId || !newScriptTitle.trim()) return;
    setCreatingScript(true);
    try {
      const resp = await api.createScript(projectId, {
        title: newScriptTitle.trim(),
      });
      setShowNewScript(false);
      setNewScriptTitle('');
      navigate(`/project/${projectId}/edit/${resp.meta.id}`);
    } catch {
      // silently fail
    }
    setCreatingScript(false);
  };

  const handleDeleteScript = (scriptId: string) => {
    setPendingDeleteId(scriptId);
  };

  const confirmDeleteScript = async () => {
    if (!projectId || !pendingDeleteId) return;
    try {
      await api.deleteScript(projectId, pendingDeleteId);
      await fetchScripts();
    } catch (err) {
      showToast(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
    setPendingDeleteId(null);
  };

  const handlePinScript = useCallback(
    async (id: string, pinned: boolean) => {
      if (!projectId) return;
      setScripts((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned } : s)),
      );
      try {
        await api.saveScript(projectId, id, { pinned });
      } catch {
        setScripts((prev) =>
          prev.map((s) => (s.id === id ? { ...s, pinned: !pinned } : s)),
        );
      }
    },
    [projectId],
  );

  const handleColorScript = useCallback(
    async (id: string, color: string) => {
      if (!projectId) return;
      setScripts((prev) =>
        prev.map((s) => (s.id === id ? { ...s, color } : s)),
      );
      try {
        await api.saveScript(projectId, id, { color });
      } catch {
        // silently fail
      }
    },
    [projectId],
  );

  const handleRenameScript = useCallback(
    async (id: string, title: string) => {
      if (!projectId) return;
      const prev = scripts.find((s) => s.id === id);
      setScripts((list) =>
        list.map((s) => (s.id === id ? { ...s, title } : s)),
      );
      try {
        await api.saveScript(projectId, id, { title });
      } catch {
        if (prev) {
          setScripts((list) =>
            list.map((s) => (s.id === id ? { ...s, title: prev.title } : s)),
          );
        }
      }
    },
    [projectId, scripts],
  );

  const handleDuplicateScript = useCallback(
    async (id: string) => {
      if (!projectId) return;
      try {
        await api.duplicateScript(projectId, id);
        await fetchScripts();
        showToast('Script duplicated', 'success');
      } catch (err) {
        showToast(
          `Duplicate failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [projectId, fetchScripts],
  );

  const handleExportScript = useCallback(
    async (id: string, format: string) => {
      if (!projectId) return;
      try {
        const resp = await api.getScript(projectId, id);
        const content = resp.content as Record<string, unknown>;
        const title = resp.meta.title || 'Untitled';

        // Extract embedded metadata from content if present
        const profiles = (content as any)?._characterProfiles;
        const cats = (content as any)?._tagCategories;
        const tags = (content as any)?._tags;

        switch (format) {
          case 'fdx':
            downloadFDX(content as any, title, profiles, cats, tags);
            break;
          case 'fountain':
            downloadFountain(content as any, title);
            break;
          case 'pdf':
            exportPDF(content as any, title, DEFAULT_PAGE_LAYOUT);
            break;
          case 'odraft':
            downloadOdraft(resp.meta, content);
            break;
        }
        showToast(`Exported as ${format.toUpperCase()}`, 'success');
      } catch (err) {
        showToast(
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    },
    [projectId],
  );

  const handleScriptDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!projectId) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = allSortedScripts.findIndex((s) => s.id === active.id);
      const newIndex = allSortedScripts.findIndex((s) => s.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = [...allSortedScripts];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const updated = reordered.map((s, i) => ({ ...s, sort_order: i }));
      setScripts(updated);

      api
        .reorderScripts(
          projectId,
          updated.map((s) => ({ id: s.id, sort_order: s.sort_order })),
        )
        .catch(() => {});
    },
    [projectId, allSortedScripts],
  );

  const handleImportScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.fdx,.txt,.odraft';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !projectId) return;
      let title = file.name.replace(/\.\w+$/, '') || 'Untitled';
      const reader = new FileReader();
      reader.onload = async () => {
        const text = reader.result as string;
        const ext = file.name.split('.').pop()?.toLowerCase();
        let doc;
        if (ext === 'odraft') {
          const parsed = parseOdraft(text);
          title = parsed.meta.title || title;
          doc = parsed.content;
        } else if (ext === 'fdx') {
          const result = parseFDXFull(text);
          doc = result.doc;
        } else {
          doc = parseFountain(text);
        }
        try {
          const resp = await api.createScript(projectId, {
            title,
            content: doc,
          });
          await fetchScripts();
          navigate(`/project/${projectId}/edit/${resp.meta.id}`);
        } catch (err) {
          console.error('Failed to import script:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="project-view">
        <div className="project-view-loading">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="project-view">
      <div className="project-view-header">
        <button
          className="project-back-btn"
          onClick={() => navigate('/projects')}
        >
          &#x2190; Projects
        </button>
        <div>
          {editingProjectName ? (
            <input
              className="inline-rename-input project-view-title-input"
              value={editProjectName}
              onChange={(e) => setEditProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const trimmed = editProjectName.trim();
                  if (trimmed && project && trimmed !== project.name) {
                    api.updateProject(project.id, { name: trimmed }).then((updated) => setProject(updated)).catch(() => {});
                  }
                  setEditingProjectName(false);
                }
                if (e.key === 'Escape') setEditingProjectName(false);
              }}
              onBlur={() => {
                const trimmed = editProjectName.trim();
                if (trimmed && project && trimmed !== project.name) {
                  api.updateProject(project.id, { name: trimmed }).then((updated) => setProject(updated)).catch(() => {});
                }
                setEditingProjectName(false);
              }}
              autoFocus
            />
          ) : (
            <h1
              className="project-view-title"
              onDoubleClick={() => { setEditProjectName(project?.name || ''); setEditingProjectName(true); }}
              title="Double-click to rename"
            >
              {project?.name || projectId}
            </h1>
          )}
          {project && (
            <div className="project-view-meta">
              <span>
                {scripts.length} script{scripts.length !== 1 ? 's' : ''}
              </span>
              <span className="project-card-dot">&middot;</span>
              <span>Created {formatDate(project.created_at)}</span>
              <span className="project-card-dot">&middot;</span>
              <span>Modified {formatDate(project.updated_at)}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="project-action-btn"
            onClick={() => {
              if (!projectId) return;
              exportProjectAsZip(projectId)
                .then(() => showToast('Project exported as zip', 'success'))
                .catch((err) => showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error'));
            }}
          >
            Export Project
          </button>
          <button
            className="project-action-btn"
            onClick={() => setShowProperties(true)}
          >
            Properties
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="project-view-tabs">
        {(['scripts', 'assets', 'versions'] as TabKey[]).map((tab) => (
          <button
            key={tab}
            className={`project-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="project-view-body">
        {activeTab === 'scripts' && (
          <div className="project-scripts-tab">
            <div className="project-scripts-actions">
              <button
                className="project-action-btn"
                onClick={() => setShowNewScript(true)}
              >
                + New Screenplay
              </button>
              <button
                className="project-action-btn"
                onClick={handleImportScript}
              >
                Import
              </button>
              <select
                className="sort-select"
                value={scriptSortKey}
                onChange={(e) =>
                  setScriptSortKey(e.target.value as ScriptSortKey)
                }
              >
                <option value="custom">Custom Order</option>
                <option value="title">Title</option>
                <option value="created">Created</option>
                <option value="updated">Last Modified</option>
                <option value="color">Color</option>
                <option value="size">Size</option>
                <option value="pages">Pages</option>
              </select>
              <div className="view-toggle-group">
                <button
                  className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="List view"
                >
                  &#x2630;
                </button>
                <button
                  className={`view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
                  onClick={() => setViewMode('card')}
                  title="Card view"
                >
                  &#x25A6;
                </button>
              </div>
            </div>
            {scripts.length === 0 ? (
              <div className="project-tab-empty">
                No scripts yet. Create or import one to get started.
              </div>
            ) : viewMode === 'card' ? (
              /* ── Card view ── */
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleScriptDragEnd}
              >
                {pinnedScripts.length > 0 && (
                  <>
                    <div className="pinned-section-header">Pinned</div>
                    <SortableContext
                      items={pinnedScripts.map((s) => s.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="script-cards-grid">
                        {pinnedScripts.map((script) => (
                          <ScriptCard
                            key={script.id}
                            script={script}
                            sortKey={scriptSortKey}
                            onNavigate={(id) => navigate(`/project/${projectId}/edit/${id}`)}
                            onPin={handlePinScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            onDelete={handleDeleteScript}
                            formatDate={formatDate}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
                {unpinnedScripts.length > 0 && (
                  <>
                    <div className="section-header">All Screenplays</div>
                    <SortableContext
                      items={unpinnedScripts.map((s) => s.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="script-cards-grid">
                        {unpinnedScripts.map((script) => (
                          <ScriptCard
                            key={script.id}
                            script={script}
                            sortKey={scriptSortKey}
                            onNavigate={(id) => navigate(`/project/${projectId}/edit/${id}`)}
                            onPin={handlePinScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            onDelete={handleDeleteScript}
                            formatDate={formatDate}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
              </DndContext>
            ) : (
              /* ── List view ── */
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleScriptDragEnd}
              >
                {pinnedScripts.length > 0 && (
                  <>
                    <div className="pinned-section-header">Pinned</div>
                    <SortableContext
                      items={pinnedScripts.map((s) => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="project-scripts-list">
                        {pinnedScripts.map((script) => (
                          <SortableScriptRow
                            key={script.id}
                            script={script}
                            projectId={projectId!}
                            sortKey={scriptSortKey}
                            onNavigate={(id) =>
                              navigate(`/project/${projectId}/edit/${id}`)
                            }
                            onPin={handlePinScript}
                            onColor={handleColorScript}
                            onDelete={handleDeleteScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            formatDate={formatDate}
                            formatSize={formatSize}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
                {unpinnedScripts.length > 0 && (
                  <>
                    <div className="section-header">All Screenplays</div>
                    <SortableContext
                      items={unpinnedScripts.map((s) => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="project-scripts-list">
                        {unpinnedScripts.map((script) => (
                          <SortableScriptRow
                            key={script.id}
                            script={script}
                            projectId={projectId!}
                            sortKey={scriptSortKey}
                            onNavigate={(id) =>
                              navigate(`/project/${projectId}/edit/${id}`)
                            }
                            onPin={handlePinScript}
                            onColor={handleColorScript}
                            onDelete={handleDeleteScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            formatDate={formatDate}
                            formatSize={formatSize}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
              </DndContext>
            )}
          </div>
        )}

        {activeTab === 'assets' && projectId && (
          <AssetManager projectId={projectId} embedded />
        )}

        {activeTab === 'versions' && (
          <div className="project-versions-tab">
            {versions.length === 0 ? (
              <div className="project-tab-empty">
                No version history available.
              </div>
            ) : (
              <div className="project-versions-list">
                {versions.map((v) => (
                  <div key={v.hash} className="project-version-item">
                    <div className="project-version-message">{v.message}</div>
                    <div className="project-version-time">
                      {formatDate(v.date)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Script Dialog */}
      {showNewScript && (
        <div
          className="dialog-overlay"
          onClick={() => setShowNewScript(false)}
        >
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">New Screenplay</div>
            <div className="dialog-body">
              <div className="dialog-row">
                <label>Screenplay Title:</label>
                <input
                  type="text"
                  placeholder="Untitled Screenplay"
                  value={newScriptTitle}
                  onChange={(e) => setNewScriptTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateScript();
                    if (e.key === 'Escape') setShowNewScript(false);
                  }}
                  autoFocus
                />
              </div>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewScript(false)}>Cancel</button>
              <button
                className="dialog-primary"
                onClick={handleCreateScript}
                disabled={creatingScript || !newScriptTitle.trim()}
              >
                {creatingScript ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {pendingDeleteId && (
        <div
          className="dialog-overlay"
          onClick={() => setPendingDeleteId(null)}
        >
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Script</div>
            <div className="dialog-body">
              <p>
                Are you sure you want to delete this script? This cannot be
                undone.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteId(null)}>Cancel</button>
              <button
                className="dialog-primary"
                style={{ background: '#c0392b' }}
                onClick={confirmDeleteScript}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Properties Dialog */}
      {showProperties && project && (
        <ProjectPropertiesDialog
          project={project}
          onClose={() => setShowProperties(false)}
          onSaved={(updated) => setProject(updated)}
        />
      )}
    </div>
  );
};

export default ProjectView;
