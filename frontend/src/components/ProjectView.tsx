import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { JSONContent } from '@tiptap/react';
import { withoutSuggestionsJSON } from '../editor/suggestions';
import { DEFAULT_SCRIPT_PROFILE } from '../utils/scriptProfile';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { compareText, formatDate as formatDateLocale, formatNumber } from '../i18n/format';
import { t as translate } from '../i18n';
import { FaCloud, FaDesktop, FaFolder, FaExclamationTriangle } from 'react-icons/fa';
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
import { cloudApi } from '../services/cloudApi';
import { projectApi } from '../services/projectApi';
import { useGoBackTo } from '../hooks/useGoBack';
import type { ProjectInfo, ScriptMeta, VersionInfo } from '../services/api';
import {
  parseScreenplayImport,
  isImportCancelled,
  extensionOf,
  isBinaryImportExtension,
  importAccept,
} from '../utils/importScreenplay';
import { downloadFDX } from '../utils/fdxExporter';
import { downloadFountain } from '../utils/fountainExporter';
import { exportPDF } from '../utils/pdfExporter';
import { downloadOdraft } from '../utils/odraftFormat';
import { exportProjectAsZip } from '../utils/zipExport';
import { DEFAULT_PAGE_LAYOUT, DEFAULT_TAG_CATEGORIES, useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useProjectStore } from '../stores/projectStore';
import AssetManager from './AssetManager';
import ProjectPropertiesDialog from './ProjectPropertiesDialog';
import ProjectStorageDialog from './ProjectStorageDialog';
import DeleteEmptyProjectDialog from './DeleteEmptyProjectDialog';
import { isDesktopTauri } from '../services/platform';
import { useLinkedFileStore, type LinkedFileState } from '../stores/linkedFileStore';
import Select from './Select';

/** What can be done with a script's file on disk from its menu (issue #135). */
type FileAction = 'reveal' | 'link' | 'unlink';

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}


/** The file a script is saved to, shown beside its other details. */
const FileBadge: React.FC<{ path: string; state?: LinkedFileState }> = ({ path, state }) => {
  const { t } = useTranslation('projects');
  let problem: string | undefined;
  switch (state) {
    case 'pending': problem = t('view.file.pending'); break;
    case 'missing': problem = t('view.file.missing'); break;
    case 'conflict': problem = t('view.file.conflict'); break;
    default: problem = undefined;
  }
  return (
    <span className="source-badge source-badge--local source-badge--path" title={problem ? `${path}\n${problem}` : t('view.savedTo', { path })}>
      {problem ? <FaExclamationTriangle /> : <FaFolder />}
      {fileNameOf(path)}
    </span>
  );
};

/** The file-related entries of a script's actions menu. */
const FileMenuItems: React.FC<{
  scriptId: string;
  filePath?: string;
  onFileAction: (id: string, action: FileAction) => void;
  close: () => void;
}> = ({ scriptId, filePath, onFileAction, close }) => {
  const { t } = useTranslation('projects');
  return (
  <>
    <div className="dropdown-separator" />
    {filePath ? (
      <>
        <div className="dropdown-item" onClick={() => { onFileAction(scriptId, 'reveal'); close(); }}>{t('view.file.show')}</div>
        <div className="dropdown-item" onClick={() => { onFileAction(scriptId, 'unlink'); close(); }}>{t('view.file.stopSaving')}</div>
      </>
    ) : (
      <div className="dropdown-item" onClick={() => { onFileAction(scriptId, 'link'); close(); }}>{t('view.file.saveToFile')}</div>
    )}
  </>
  );
};

/** Dropdown button: "+ New Document" → Screenplay | Treatment. */
const NewDocumentButton: React.FC<{
  onCreateScreenplay: () => void;
  onCreateTreatment: () => void;
}> = ({ onCreateScreenplay, onCreateTreatment }) => {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="new-document-dropdown" ref={ref}>
      <button
        className="project-action-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t('view.newDocument')}
      </button>
      {open && (
        <div className="new-document-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onCreateScreenplay(); }}
          >
            <strong>{t('view.screenplay')}</strong>
            <span>{t('view.screenplayHint')}</span>
          </button>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onCreateTreatment(); }}
          >
            <strong>{t('view.treatment')}</strong>
            <span>{t('view.treatmentHint')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
import { showToast } from './Toast';
import { readRevisionState } from '../utils/revisionState';
import { labelSavedContent } from '../utils/elementNumbers';

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
  source: 'local' | 'cloud';
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
  /** The file on disk this script is saved to, if any (issue #135). */
  filePath?: string;
  fileState?: LinkedFileState;
  /** Present where scripts can be saved to files (desktop, local project). */
  onFileAction?: (id: string, action: FileAction) => void;
}

const SortableScriptRow: React.FC<SortableScriptRowProps> = ({
  script,
  source,
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
  filePath,
  fileState,
  onFileAction,
}) => {
  const { t } = useTranslation(['projects', 'common']);
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
        <div className="drag-handle" {...attributes} {...listeners} title={t('list.dragToReorder')}>
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
            title={t('list.doubleClickRename')}
          >
            {script.title}
          </div>
        )}
        <div className="project-script-meta">
          <span>{t('list.created', { date: formatDate(script.created_at) })}</span>
          <span className="project-card-dot">&middot;</span>
          <span>{t('list.modified', { date: formatDate(script.updated_at) })}</span>
          {script.page_count > 0 && (
            <>
              <span className="project-card-dot">&middot;</span>
              <span>{t('view.pagesShort', { count: script.page_count })}</span>
            </>
          )}
          <span className="project-card-dot">&middot;</span>
          <span>{formatSize(script.size_bytes)}</span>
          <span className="project-card-dot">&middot;</span>
          <span
            className={`source-badge source-badge--${source}`}
            title={source === 'cloud' ? t('list.storedCloud') : t('list.storedLocal')}
          >
            {source === 'cloud' ? <FaCloud /> : <FaDesktop />}
            {source === 'cloud' ? t('list.cloudBadge') : t('list.localBadge')}
          </span>
          {filePath && (
            <>
              <span className="project-card-dot">&middot;</span>
              <FileBadge path={filePath} state={fileState} />
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="script-item-actions">
        <button
          className={`card-action-btn pin-btn${script.pinned ? ' active' : ''}`}
          onClick={() => onPin(script.id, !script.pinned)}
          title={script.pinned ? t('list.unpin') : t('list.pin')}
        >
          &#x1F4CC;
        </button>
        <button
          className="card-action-btn color-btn"
          onClick={() => setShowColorPicker(!showColorPicker)}
          title={t('list.setColor')}
        >
          <span
            className="color-dot"
            style={{ backgroundColor: script.color || '#666' }}
          />
        </button>
        <button
          className="card-action-btn more-btn"
          onClick={() => setShowActions(!showActions)}
          title={t('list.moreActions')}
        >
          &#x22EE;
        </button>
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <div className="script-actions-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-item" onClick={() => { setEditing(true); setEditTitle(script.title); setShowActions(false); }}>{t('common:rename')}</div>
          <div className="dropdown-item" onClick={() => { onDuplicate(script.id); setShowActions(false); }}>{t('view.duplicate')}</div>
          <div className="dropdown-separator" />
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fdx'); setShowActions(false); }}>{t('view.exportAs', { format: 'FDX' })}</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fountain'); setShowActions(false); }}>{t('view.exportAs', { format: 'Fountain' })}</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'pdf'); setShowActions(false); }}>{t('view.exportAs', { format: 'PDF' })}</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'odraft'); setShowActions(false); }}>{t('view.exportAs', { format: '.odraft' })}</div>
          {onFileAction && (
            <FileMenuItems scriptId={script.id} filePath={filePath} onFileAction={onFileAction} close={() => setShowActions(false)} />
          )}
          <div className="dropdown-separator" />
          <div className="dropdown-item dropdown-item-danger" onClick={() => { onDelete(script.id); setShowActions(false); }}>{t('common:delete')}</div>
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
              title={c || t('list.noColor')}
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
  source: 'local' | 'cloud';
  sortKey: ScriptSortKey;
  onNavigate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string, format: string) => void;
  onDelete: (id: string) => void;
  formatDate: (iso: string) => string;
  filePath?: string;
  fileState?: LinkedFileState;
  onFileAction?: (id: string, action: FileAction) => void;
}

const ScriptCard: React.FC<ScriptCardProps> = ({
  script,
  source,
  sortKey,
  onNavigate,
  onPin,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
  formatDate,
  filePath,
  fileState,
  onFileAction,
}) => {
  const { t } = useTranslation(['projects', 'common']);
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
            title={t('list.dragToReorder')}
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
            title={t('list.doubleClickRename')}
          >
            {script.title}
          </div>
        )}
        <div className="script-card-actions">
          <button
            className={`card-action-btn pin-btn${script.pinned ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onPin(script.id, !script.pinned); }}
            title={script.pinned ? t('list.unpin') : t('list.pin')}
          >
            &#x1F4CC;
          </button>
          <button
            className="card-action-btn more-btn"
            onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
            title={t('list.moreActions')}
          >
            &#x22EE;
          </button>
        </div>
      </div>
      <div className="script-card-preview">
        {script.preview || t('view.emptyScreenplay')}
      </div>
      <div className="script-card-meta">
        {script.page_count > 0 && <span>{t('view.pagesShort', { count: script.page_count })}</span>}
        <span>{formatDate(script.updated_at)}</span>
        {filePath ? (
          <FileBadge path={filePath} state={fileState} />
        ) : (
          <span
            className={`source-badge source-badge--${source}`}
            title={source === 'cloud' ? t('list.storedCloud') : t('list.storedLocal')}
          >
            {source === 'cloud' ? <FaCloud /> : <FaDesktop />}
            {source === 'cloud' ? t('list.cloudBadge') : t('list.localBadge')}
          </span>
        )}
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <div className="script-actions-dropdown script-card-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="dropdown-item" onClick={() => { setEditing(true); setEditTitle(script.title); setShowActions(false); }}>{t('common:rename')}</div>
          <div className="dropdown-item" onClick={() => { onDuplicate(script.id); setShowActions(false); }}>{t('view.duplicate')}</div>
          <div className="dropdown-separator" />
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fdx'); setShowActions(false); }}>{t('view.exportAs', { format: 'FDX' })}</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'fountain'); setShowActions(false); }}>{t('view.exportAs', { format: 'Fountain' })}</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'pdf'); setShowActions(false); }}>{t('view.exportAs', { format: 'PDF' })}</div>
          <div className="dropdown-item" onClick={() => { onExport(script.id, 'odraft'); setShowActions(false); }}>{t('view.exportAs', { format: '.odraft' })}</div>
          {onFileAction && (
            <FileMenuItems scriptId={script.id} filePath={filePath} onFileAction={onFileAction} close={() => setShowActions(false)} />
          )}
          <div className="dropdown-separator" />
          <div className="dropdown-item dropdown-item-danger" onClick={() => { onDelete(script.id); setShowActions(false); }}>{t('common:delete')}</div>
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

const ProjectView: React.FC = () => {
  const { t } = useTranslation(['projects', 'common']);
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Leaving this screen must not push a second copy of the projects list on
  // top of it — that is what trapped the two screens in a loop (issue #66).
  const backToProjects = useGoBackTo('/projects');
  // Project's storage source — drives both the routing dispatchers (already
  // handled by projectApi) and the visual badges on individual scripts.
  const isCloud = useProjectStore((s) => projectId ? Boolean(s.cloudProjects[projectId]) : false);
  const projectSource: 'local' | 'cloud' = isCloud ? 'cloud' : 'local';
  // All script-level reads/writes (rename, pin, color, delete, duplicate)
  // need to go to the same backend that owns the project. Without this,
  // renaming or deleting a script inside a cloud project would hit local
  // SQLite, find nothing, and silently no-op (or 404).
  const client = isCloud ? cloudApi : api;
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('scripts');
  const [loading, setLoading] = useState(true);

  const [showProperties, setShowProperties] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteFileToo, setDeleteFileToo] = useState(false);
  // Set once the project's last script is gone: offer to delete the project.
  // `deletedTitle` is that script, for the dialog's first line.
  const [emptyPrompt, setEmptyPrompt] = useState<{ deletedTitle: string | null } | null>(null);
  // File › Delete Script… lands here with the deleted script's title; checked
  // once the list has loaded, in case that was the project's last script.
  const arrivedAfterDeleteRef = useRef<string | null>(
    (location.state as { deletedScript?: string } | null)?.deletedScript ?? null,
  );
  // Scripts saved to files on disk (issue #135): script id → file path.
  // Desktop and local projects only; a cloud project has no files here.
  const canLinkFiles = isDesktopTauri() && !isCloud;
  const [fileLinks, setFileLinks] = useState<Record<string, string>>({});
  const fileStates = useLinkedFileStore((s) => s.byScript);
  const projectFolder = typeof project?.properties?.folder_path === 'string' && project.properties.folder_path.trim()
    ? project.properties.folder_path
    : null;
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
      const p = await projectApi.getProject(projectId);
      setProject(p);
    } catch {
      // The project is gone. replace, or Back returns to this route, it fails
      // to load again, and pushes another entry — a loop with no exit.
      navigate('/', { replace: true });
    }
  }, [projectId, navigate]);

  /** Reload the list. Returns it, or null when it could not be read, so a
   *  caller never mistakes a failed read for an empty project. */
  const fetchScripts = useCallback(async (): Promise<ScriptMeta[] | null> => {
    if (!projectId) return null;
    try {
      const s = await projectApi.listScripts(projectId);
      setScripts(s);
      return s;
    } catch (err) {
      console.warn('[project] could not list scripts', err);
      return null;
    }
  }, [projectId]);

  const fetchFileLinks = useCallback(async () => {
    if (!projectId || !canLinkFiles) { setFileLinks({}); return; }
    try {
      const lf = await import('../services/linkedFiles');
      const links = await lf.listProjectLinks(projectId);
      setFileLinks(Object.fromEntries(links.map((l) => [l.scriptId, l.path])));
    } catch (err) {
      console.warn('[project] could not read linked files', err);
    }
  }, [projectId, canLinkFiles]);

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
    Promise.all([fetchProject(), fetchScripts(), fetchVersions(), fetchFileLinks()])
      .then(([, list]) => {
        const deleted = arrivedAfterDeleteRef.current;
        if (!deleted) return;
        arrivedAfterDeleteRef.current = null;
        if (list && list.length === 0) setEmptyPrompt({ deletedTitle: deleted });
        else showToast(translate('projects:view.scriptDeleted', { title: deleted }), 'success');
      })
      .finally(() => setLoading(false));
  }, [fetchProject, fetchScripts, fetchVersions, fetchFileLinks]);

  // The deleted script's title rode in on the navigation. Drop it, so Back or
  // a reload never announces the same delete twice.
  useEffect(() => {
    const st = location.state as { deletedScript?: string; from?: string } | null;
    if (!st?.deletedScript) return;
    const { deletedScript: _done, ...rest } = st;
    void _done;
    navigate(location.pathname, { replace: true, state: rest });
  }, [location.state, location.pathname, navigate]);

  // A project kept in a folder picks up files added to the folder since it
  // was last opened — copied in from another machine, exported from another
  // app. Once per visit, in the background; the list fills in when it is done.
  const scannedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || !canLinkFiles || !projectFolder || scannedForRef.current === projectId) return;
    scannedForRef.current = projectId;
    void (async () => {
      try {
        const lf = await import('../services/linkedFiles');
        const scan = await lf.scanProjectFolder(projectId);
        if (scan.added > 0) {
          showToast(translate('projects:view.folderFilesAdded', { count: scan.added }), 'info');
          await fetchScripts();
        }
        if (scan.failed.length > 0) {
          showToast(translate('projects:view.folderReadFailed', { files: scan.failed.join(', ') }), 'error');
        }
        await fetchFileLinks();
      } catch (err) {
        console.warn('[project] folder scan failed', err);
        showToast(translate('projects:view.folderScanFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
      }
    })();
  }, [projectId, canLinkFiles, projectFolder, fetchScripts, fetchFileLinks]);

  /** Show, link or unlink a script's file on disk. */
  const handleFileAction = useCallback(async (scriptId: string, action: FileAction) => {
    if (!projectId) return;
    try {
      const lf = await import('../services/linkedFiles');
      if (action === 'reveal') {
        const path = fileLinks[scriptId];
        if (path) await lf.revealPath(path);
        return;
      }
      if (action === 'unlink') {
        await lf.unlinkScript(scriptId);
        await fetchFileLinks();
        showToast(translate('projects:view.file.unlinked'), 'success');
        return;
      }
      const script = scripts.find((s) => s.id === scriptId);
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { linkedFileName } = await import('../utils/linkedFileFormat');
      const format = lf.projectFileFormat(project);
      let dir = projectFolder;
      if (!dir) {
        const { documentDir } = await import('@tauri-apps/api/path');
        dir = await documentDir();
      }
      const picked = await save({
        title: translate('projects:view.file.dialogTitle'),
        defaultPath: lf.joinPath(dir, linkedFileName(script?.title || 'Untitled' /* i18n-ignore: becomes the file name */, format)),
        filters: [
          { name: 'OpenDraft', extensions: ['odraft'] },
          { name: 'Fountain', extensions: ['fountain'] },
          { name: 'Final Draft', extensions: ['fdx'] },
        ],
      });
      if (!picked) return;
      const taken = await lf.findLinkByPath(picked);
      if (taken && taken.scriptId !== scriptId) {
        showToast(translate('projects:view.file.taken', { file: lf.basenameOf(picked) }), 'error');
        return;
      }
      const outcome = await lf.linkScriptToFile(projectId, scriptId, picked);
      await fetchFileLinks();
      showToast(
        outcome === 'written'
          ? translate('projects:view.file.linked', { file: lf.basenameOf(picked) })
          : translate('projects:view.file.linkedPending', { file: lf.basenameOf(picked) }),
        outcome === 'written' ? 'success' : 'error',
      );
    } catch (err) {
      console.error('[project] file action failed', err);
      showToast(translate('projects:view.file.failed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  }, [projectId, project, projectFolder, scripts, fileLinks, fetchFileLinks]);

  useEffect(() => {
    localStorage.setItem('opendraft:scriptSort', scriptSortKey);
  }, [scriptSortKey]);

  useEffect(() => {
    localStorage.setItem('opendraft:scriptViewMode', viewMode);
    // Re-fetch with previews when switching to card view
    if (viewMode === 'card' && projectId) {
      projectApi.listScripts(projectId, true).then(setScripts).catch(() => {});
    }
  }, [viewMode, projectId]);

  // ── Sorting ──

  const { pinnedScripts, unpinnedScripts } = React.useMemo(() => {
    const list = [...scripts];
    const compareFn = (a: ScriptMeta, b: ScriptMeta): number => {
      switch (scriptSortKey) {
        case 'title':
          return compareText(a.title, b.title);
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

  const handleCreateScript = () => {
    if (!projectId || !project) return;
    // Set project context but no script — Save will trigger Save As dialog
    const projStore = useProjectStore.getState();
    projStore.setCurrentProject(project);
    projStore.setCurrentScriptId(null);
    projStore.setScripts([]);
    const edStore = useEditorStore.getState();
    edStore.setDocumentTitle('Untitled Screenplay' /* i18n-ignore: stored as the document title */);
    edStore.setBeats([]);
    edStore.setBeatColumns([]);
    edStore.setPlotlines([]);
    edStore.setBeatArrangeMode('auto');
    edStore.setNotes([]);
    edStore.setGeneralNotes([]);
    edStore.setTags([]);
    edStore.setTagCategories([...DEFAULT_TAG_CATEGORIES]);
    edStore.setCharacterProfiles([]);
    edStore.setScenes([]);
    edStore.resetRevisionState();
    edStore.setScriptProfile(DEFAULT_SCRIPT_PROFILE);
    // Tell MenuBar (which mounts inside ScreenplayEditor on '/') to prompt
    // for a script format. The flag is consumed by MenuBar's mount effect.
    edStore.setPendingFormatPromptInProject(true);
    navigate('/');
  };

  const [treatmentNamePrompt, setTreatmentNamePrompt] = useState<string | null>(null);

  const handleCreateTreatment = () => {
    if (!projectId || !project) return;
    setTreatmentNamePrompt('');
  };

  const confirmCreateTreatment = async (rawName: string) => {
    if (!projectId || !project) return;
    const name = rawName.trim() || 'Untitled Treatment' /* i18n-ignore: stored as the treatment's title */;
    setTreatmentNamePrompt(null);
    try {
      const resp = await client.createScript(projectId, {
        title: name,
        format: 'treatment',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      });
      await fetchScripts();
      navigate(`/project/${projectId}/treatment/${resp.meta.id}`, { state: { from: `/project/${projectId}` } });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : translate('projects:view.treatmentFailed'),
        'error',
      );
    }
  };

  /** Navigate to the appropriate editor based on the script's format. */
  const navigateToScript = useCallback((scriptId: string) => {
    if (!projectId) return;
    const script = scripts.find((s) => s.id === scriptId);
    if (script?.format === 'treatment') {
      navigate(`/project/${projectId}/treatment/${scriptId}`, { state: { from: `/project/${projectId}` } });
    } else {
      navigate(`/project/${projectId}/edit/${scriptId}`, { state: { from: `/project/${projectId}` } });
    }
  }, [projectId, scripts, navigate]);

  const handleDeleteScript = (scriptId: string) => {
    setDeleteFileToo(false);
    setPendingDeleteId(scriptId);
  };

  const confirmDeleteScript = async () => {
    if (!projectId || !pendingDeleteId) return;
    try {
      // Only when asked: the file is the writer's, and by default it outlives
      // the script.
      if (deleteFileToo && fileLinks[pendingDeleteId]) {
        const lf = await import('../services/linkedFiles');
        await lf.deleteLinkedFile(pendingDeleteId);
      }
      const deletedTitle = scripts.find((s) => s.id === pendingDeleteId)?.title ?? null;
      await client.deleteScript(projectId, pendingDeleteId);
      if (isCloud) useProjectStore.getState().unmarkCloudScript(projectId, pendingDeleteId);
      const remaining = await fetchScripts();
      await fetchFileLinks();
      if (remaining && remaining.length === 0) setEmptyPrompt({ deletedTitle });
    } catch (err) {
      showToast(
        translate('projects:view.deleteFailed', { error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
    }
    setPendingDeleteId(null);
  };

  /** The project's last script is gone and the writer chose to delete the
   *  project too. Throws to the dialog, which shows the message. */
  const handleDeleteEmptyProject = async () => {
    if (!projectId) return;
    await projectApi.deleteProject(projectId);
    setEmptyPrompt(null);
    // Back on the Projects list, show the tab this project was on.
    try { localStorage.setItem('opendraft:projectSource', projectSource); } catch { /* private mode */ }
    showToast(translate('projects:list.deleted'), 'success');
    backToProjects();
  };

  const handlePinScript = useCallback(
    async (id: string, pinned: boolean) => {
      if (!projectId) return;
      setScripts((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned } : s)),
      );
      try {
        await client.saveScript(projectId, id, { pinned });
      } catch {
        setScripts((prev) =>
          prev.map((s) => (s.id === id ? { ...s, pinned: !pinned } : s)),
        );
      }
    },
    [projectId, client],
  );

  const handleColorScript = useCallback(
    async (id: string, color: string) => {
      if (!projectId) return;
      setScripts((prev) =>
        prev.map((s) => (s.id === id ? { ...s, color } : s)),
      );
      try {
        await client.saveScript(projectId, id, { color });
      } catch {
        // silently fail
      }
    },
    [projectId, client],
  );

  const handleRenameScript = useCallback(
    async (id: string, title: string) => {
      if (!projectId) return;
      const prev = scripts.find((s) => s.id === id);
      setScripts((list) =>
        list.map((s) => (s.id === id ? { ...s, title } : s)),
      );
      try {
        await client.saveScript(projectId, id, { title });
        // In a project folder the file follows the new title.
        await fetchFileLinks();
      } catch (err) {
        // Roll back on failure and surface the reason — silently swallowing
        // here is what made "rename doesn't work" so confusing in the cloud
        // case.
        if (prev) {
          setScripts((list) =>
            list.map((s) => (s.id === id ? { ...s, title: prev.title } : s)),
          );
        }
        showToast(
          translate('projects:view.renameFailed', { error: err instanceof Error ? err.message : String(err) }),
          'error',
        );
      }
    },
    [projectId, scripts, client, fetchFileLinks],
  );

  const handleDuplicateScript = useCallback(
    async (id: string) => {
      if (!projectId) return;
      try {
        if (isCloud) {
          // cloudApi has no native duplicate endpoint yet; fall back to
          // get + re-create so users still get a working duplicate from
          // a cloud project.
          const orig = await cloudApi.getScript(projectId, id);
          await cloudApi.createScript(projectId, {
            title: `${orig.meta.title} (copy)`, // i18n-ignore: stored as the new script's title
            content: orig.content,
            format: 'json',
          });
        } else {
          await api.duplicateScript(projectId, id);
        }
        await fetchScripts();
        await fetchFileLinks();
        showToast(translate('projects:view.duplicated'), 'success');
      } catch (err) {
        showToast(
          translate('projects:view.duplicateFailed', { error: err instanceof Error ? err.message : String(err) }),
          'error',
        );
      }
    },
    [projectId, fetchScripts, fetchFileLinks, isCloud],
  );

  const handleExportScript = useCallback(
    async (id: string, format: string) => {
      if (!projectId) return;
      try {
        const resp = await client.getScript(projectId, id);
        const saved = resp.content as Record<string, unknown>;
        const title = resp.meta.title || 'Untitled'; // i18n-ignore: becomes the exported file's name
        // Pending suggestions stay out of every file but .odraft (editor/suggestions).
        const content = format === 'odraft'
          ? saved
          : { ...saved, ...(withoutSuggestionsJSON(saved as JSONContent) as Record<string, unknown>) };

        // Extract embedded metadata from content if present
        const profiles = (content as any)?._characterProfiles;
        const cats = (content as any)?._tagCategories;
        const tags = (content as any)?._tags;

        switch (format) {
          case 'fdx':
            {
              const rev = readRevisionState(content);
              await downloadFDX(labelSavedContent(content as Parameters<typeof downloadFDX>[0], content), title, profiles, cats, tags,
                undefined, undefined, undefined, undefined, undefined,
                { mode: rev.revisionMode, color: rev.revisionColor, settings: rev.revisionSettings },
                { sceneNumbersVisible: (content as Record<string, unknown>)?._sceneNumbersVisible !== false });
            }
            break;
          case 'fountain':
            await downloadFountain(content as any, title, {
              revisionSettings: readRevisionState(content).revisionSettings,
              sceneNumbersVisible: (content as Record<string, unknown>)?._sceneNumbersVisible !== false,
            });
            break;
          case 'pdf':
            await exportPDF(labelSavedContent(content as any, content), title, DEFAULT_PAGE_LAYOUT, {
              revisionSettings: readRevisionState(content).revisionSettings,
              // The writer's last answer in File → Export → PDF (#226).
              textColors: useSettingsStore.getState().pdfTextColors,
            });
            break;
          case 'odraft':
            await downloadOdraft(resp.meta, content);
            break;
        }
        showToast(translate('projects:view.exportedAs', { format: format.toUpperCase() }), 'success');
      } catch (err) {
        showToast(
          translate('projects:view.exportFailed', { error: err instanceof Error ? err.message : String(err) }),
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

      client
        .reorderScripts(
          projectId,
          updated.map((s) => ({ id: s.id, sort_order: s.sort_order })),
        )
        .catch(() => {});
    },
    [projectId, allSortedScripts, client],
  );

  const handleImportScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = importAccept();
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !projectId) return;
      const fallbackTitle = file.name.replace(/\.\w+$/, '') || 'Untitled'; // i18n-ignore: stored as the script's title
      const binary = isBinaryImportExtension(extensionOf(file.name));
      const reader = new FileReader();
      reader.onerror = () => {
        console.error('Failed to read script file:', reader.error);
        showToast(translate('projects:view.readFileFailed'), 'error');
      };
      reader.onload = async () => {
        try {
          // The script goes into the project, not into the open editor, so
          // the file's beats/notes must not overwrite the current document.
          const imported = await parseScreenplayImport(
            file.name,
            binary ? (reader.result as ArrayBuffer) : (reader.result as string),
            { hydrateStores: false },
          );
          const resp = await client.createScript(projectId, {
            title: imported.title || fallbackTitle,
            // The file's revisions and scene numbering travel with it.
            content: { ...(imported.doc as Record<string, unknown>), ...(imported.metadata ?? {}) },
          });
          await fetchScripts();
          navigate(`/project/${projectId}/edit/${resp.meta.id}`, { state: { from: `/project/${projectId}` } });
        } catch (err) {
          if (isImportCancelled(err)) return;
          console.error('Failed to import script:', err);
          showToast(translate('projects:view.importFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
        }
      };
      if (binary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    };
    input.click();
  };

  const formatSize = (bytes: number): string => {
    const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
    if (bytes < 1024) return t('view.size.bytes', { value: formatNumber(bytes) });
    if (bytes < 1024 * 1024) return t('view.size.kb', { value: formatNumber(bytes / 1024, oneDecimal) });
    return t('view.size.mb', { value: formatNumber(bytes / (1024 * 1024), oneDecimal) });
  };

  const formatDate = (iso: string): string => {
    try {
      return formatDateLocale(iso, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }) || iso;
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="project-view">
        <div className="project-view-loading">{t('view.loading')}</div>
      </div>
    );
  }

  return (
    <div className="project-view">
      <div className="project-view-header">
        <button
          className="project-back-btn"
          onClick={backToProjects}
        >
          &#x2190; {t('list.title')}
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
                    projectApi.updateProject(project.id, { name: trimmed }).then((updated) => setProject(updated)).catch(() => {});
                  }
                  setEditingProjectName(false);
                }
                if (e.key === 'Escape') setEditingProjectName(false);
              }}
              onBlur={() => {
                const trimmed = editProjectName.trim();
                if (trimmed && project && trimmed !== project.name) {
                  projectApi.updateProject(project.id, { name: trimmed }).then((updated) => setProject(updated)).catch(() => {});
                }
                setEditingProjectName(false);
              }}
              autoFocus
            />
          ) : (
            <h1
              className="project-view-title"
              onDoubleClick={() => { setEditProjectName(project?.name || ''); setEditingProjectName(true); }}
              title={t('list.doubleClickRename')}
            >
              {project?.name || projectId}
            </h1>
          )}
          {project && (
            <div className="project-view-meta">
              <span>
                {t('view.scripts', { count: scripts.length })}
              </span>
              <span className="project-card-dot">&middot;</span>
              <span>{t('list.created', { date: formatDate(project.created_at) })}</span>
              <span className="project-card-dot">&middot;</span>
              <span>{t('list.modified', { date: formatDate(project.updated_at) })}</span>
              {canLinkFiles && projectFolder && (
                <>
                  <span className="project-card-dot">&middot;</span>
                  <span
                    className="source-badge source-badge--local source-badge--path"
                    title={t('view.scriptsSavedTo', { folder: projectFolder })}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setShowStorage(true)}
                  >
                    <FaFolder /> {projectFolder}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="project-action-btn"
            onClick={() => {
              if (!projectId) return;
              exportProjectAsZip(projectId, client)
                .then(({ saved, assetsOmitted, missingAssets }) => {
                  if (!saved) return;
                  if (assetsOmitted) {
                    showToast(translate('projects:view.zip.assetsOmitted'), 'info');
                  } else if (missingAssets.length > 0) {
                    showToast(translate('projects:view.zip.missingImages', { count: missingAssets.length }), 'info');
                  } else {
                    showToast(translate('projects:view.zip.done'), 'success');
                  }
                })
                .catch((err) => showToast(translate('projects:view.exportFailed', { error: err instanceof Error ? err.message : String(err) }), 'error'));
            }}
          >
            {t('view.exportProject')}
          </button>
          {canLinkFiles && (
            <button
              className="project-action-btn"
              onClick={() => setShowStorage(true)}
              title={t('view.storageTitle')}
            >
              {t('view.storage')}
            </button>
          )}
          <button
            className="project-action-btn"
            onClick={() => setShowProperties(true)}
          >
            {t('view.properties')}
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
            {tab === 'scripts' ? t('view.tab.scripts') : tab === 'assets' ? t('view.tab.assets') : t('view.tab.versions')}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="project-view-body">
        {activeTab === 'scripts' && (
          <div className="project-scripts-tab">
            <div className="project-scripts-actions">
              <NewDocumentButton
                onCreateScreenplay={handleCreateScript}
                onCreateTreatment={handleCreateTreatment}
              />
              <button
                className="project-action-btn"
                onClick={handleImportScript}
              >
                {t('common:import')}
              </button>
              <Select
                className="sort-select"
                value={scriptSortKey}
                onChange={(e) =>
                  setScriptSortKey(e.target.value as ScriptSortKey)
                }
              >
                <option value="custom">{t('list.sort.custom')}</option>
                <option value="title">{t('view.sort.title')}</option>
                <option value="created">{t('list.sort.created')}</option>
                <option value="updated">{t('list.sort.updated')}</option>
                <option value="color">{t('list.sort.color')}</option>
                <option value="size">{t('view.sort.size')}</option>
                <option value="pages">{t('view.sort.pages')}</option>
              </Select>
              <div className="view-toggle-group">
                <button
                  className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title={t('view.listView')}
                >
                  &#x2630;
                </button>
                <button
                  className={`view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
                  onClick={() => setViewMode('card')}
                  title={t('view.cardView')}
                >
                  &#x25A6;
                </button>
              </div>
            </div>
            {scripts.length === 0 ? (
              <div className="project-tab-empty">
                {t('view.noScripts')}
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
                    <div className="pinned-section-header">{t('list.pinned')}</div>
                    <SortableContext
                      items={pinnedScripts.map((s) => s.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="script-cards-grid">
                        {pinnedScripts.map((script) => (
                          <ScriptCard
                            key={script.id}
                            script={script}
                            source={projectSource}
                            sortKey={scriptSortKey}
                            onNavigate={navigateToScript}
                            onPin={handlePinScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            onDelete={handleDeleteScript}
                            formatDate={formatDate}
                            filePath={fileLinks[script.id]}
                            fileState={fileStates[script.id]?.state}
                            onFileAction={canLinkFiles ? handleFileAction : undefined}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
                {unpinnedScripts.length > 0 && (
                  <>
                    <div className="section-header">{t('view.allScreenplays')}</div>
                    <SortableContext
                      items={unpinnedScripts.map((s) => s.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="script-cards-grid">
                        {unpinnedScripts.map((script) => (
                          <ScriptCard
                            key={script.id}
                            script={script}
                            source={projectSource}
                            sortKey={scriptSortKey}
                            onNavigate={navigateToScript}
                            onPin={handlePinScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            onDelete={handleDeleteScript}
                            formatDate={formatDate}
                            filePath={fileLinks[script.id]}
                            fileState={fileStates[script.id]?.state}
                            onFileAction={canLinkFiles ? handleFileAction : undefined}
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
                    <div className="pinned-section-header">{t('list.pinned')}</div>
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
                            source={projectSource}
                            sortKey={scriptSortKey}
                            onNavigate={navigateToScript}
                            onPin={handlePinScript}
                            onColor={handleColorScript}
                            onDelete={handleDeleteScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            formatDate={formatDate}
                            formatSize={formatSize}
                            filePath={fileLinks[script.id]}
                            fileState={fileStates[script.id]?.state}
                            onFileAction={canLinkFiles ? handleFileAction : undefined}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
                {unpinnedScripts.length > 0 && (
                  <>
                    <div className="section-header">{t('view.allScreenplays')}</div>
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
                            source={projectSource}
                            sortKey={scriptSortKey}
                            onNavigate={navigateToScript}
                            onPin={handlePinScript}
                            onColor={handleColorScript}
                            onDelete={handleDeleteScript}
                            onRename={handleRenameScript}
                            onDuplicate={handleDuplicateScript}
                            onExport={handleExportScript}
                            formatDate={formatDate}
                            formatSize={formatSize}
                            filePath={fileLinks[script.id]}
                            fileState={fileStates[script.id]?.state}
                            onFileAction={canLinkFiles ? handleFileAction : undefined}
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
                {t('view.noVersions')}
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

      {/* New Treatment — name prompt */}
      {treatmentNamePrompt !== null && (
        <div
          className="dialog-overlay"
          onClick={() => setTreatmentNamePrompt(null)}
        >
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{t('view.newTreatment.title')}</div>
            <div className="dialog-body">
              <p style={{ margin: '0 0 10px 0' }}>{t('view.newTreatment.prompt')}</p>
              <input
                autoFocus
                type="text"
                className="dialog-input"
                value={treatmentNamePrompt}
                onChange={(e) => setTreatmentNamePrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmCreateTreatment(treatmentNamePrompt);
                  if (e.key === 'Escape') setTreatmentNamePrompt(null);
                }}
                placeholder={t('view.newTreatment.placeholder')}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '14px',
                  background: 'var(--fd-overlay-subtle)',
                  border: '1px solid var(--fd-border)',
                  borderRadius: 4,
                  color: 'var(--fd-text)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div className="dialog-actions">
              <button onClick={() => setTreatmentNamePrompt(null)}>{t('common:cancel')}</button>
              <button
                className="dialog-primary"
                onClick={() => confirmCreateTreatment(treatmentNamePrompt)}
              >
                {t('common:create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {emptyPrompt && project && (
        <DeleteEmptyProjectDialog
          projectName={project.name}
          source={projectSource}
          deletedScriptTitle={emptyPrompt.deletedTitle}
          versionCount={versions.length}
          folderPath={projectFolder}
          onKeep={() => setEmptyPrompt(null)}
          onDelete={handleDeleteEmptyProject}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {pendingDeleteId && (
        <div
          className="dialog-overlay"
          onClick={() => setPendingDeleteId(null)}
        >
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{t('deleteScript.title')}</div>
            <div className="dialog-body">
              <p>
                {t('view.deleteScriptConfirm')}
              </p>
              {fileLinks[pendingDeleteId] && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={deleteFileToo}
                    onChange={(e) => setDeleteFileToo(e.target.checked)}
                  />
                  <span>
                    <Trans ns="projects" i18nKey="deleteScript.alsoDeleteFile" values={{ file: fileNameOf(fileLinks[pendingDeleteId]) }} components={{ strong: <strong /> }} />
                  </span>
                </label>
              )}
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteId(null)}>{t('common:cancel')}</button>
              <button
                className="dialog-primary"
                style={{ background: '#c0392b' }}
                onClick={confirmDeleteScript}
              >
                {t('common:delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStorage && project && (
        <ProjectStorageDialog
          project={project}
          onClose={() => setShowStorage(false)}
          onProjectChanged={(updated) => setProject(updated)}
          onScriptsChanged={() => { void fetchScripts(); void fetchFileLinks(); }}
        />
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
