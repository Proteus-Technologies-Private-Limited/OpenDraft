import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { ProjectInfo, ScriptMeta, VersionInfo } from '../services/api';
import { parseFountain } from '../utils/fountainParser';
import { parseFDXFull } from '../utils/fdxParser';
import AssetManager from './AssetManager';
import ProjectPropertiesDialog from './ProjectPropertiesDialog';

type TabKey = 'scripts' | 'assets' | 'versions';

const ProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('scripts');
  const [loading, setLoading] = useState(true);

  // New script dialog
  const [showNewScript, setShowNewScript] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState('');
  const [creatingScript, setCreatingScript] = useState(false);

  // Properties dialog
  const [showProperties, setShowProperties] = useState(false);

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
    Promise.all([fetchProject(), fetchScripts(), fetchVersions()]).finally(() => setLoading(false));
  }, [fetchProject, fetchScripts, fetchVersions]);

  const handleCreateScript = async () => {
    if (!projectId || !newScriptTitle.trim()) return;
    setCreatingScript(true);
    try {
      const resp = await api.createScript(projectId, { title: newScriptTitle.trim() });
      setShowNewScript(false);
      setNewScriptTitle('');
      // Navigate directly to the editor with the new script
      navigate(`/project/${projectId}/edit/${resp.meta.id}`);
    } catch {
      // silently fail
    }
    setCreatingScript(false);
  };

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const handleDeleteScript = (scriptId: string) => {
    setPendingDeleteId(scriptId);
  };
  const confirmDeleteScript = async () => {
    if (!projectId || !pendingDeleteId) return;
    try {
      await api.deleteScript(projectId, pendingDeleteId);
      await fetchScripts();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setPendingDeleteId(null);
  };

  const handleImportScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.fdx,.txt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !projectId) return;
      const title = file.name.replace(/\.\w+$/, '') || 'Untitled';
      const reader = new FileReader();
      reader.onload = async () => {
        const text = reader.result as string;
        const ext = file.name.split('.').pop()?.toLowerCase();
        let doc;
        if (ext === 'fdx') {
          const result = parseFDXFull(text);
          doc = result.doc;
        } else {
          doc = parseFountain(text);
        }
        try {
          const resp = await api.createScript(projectId, { title, content: doc });
          await fetchScripts();
          // Open the imported script directly in the editor
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
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
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
        <button className="project-back-btn" onClick={() => navigate('/projects')}>
          &#x2190; Projects
        </button>
        <div>
          <h1 className="project-view-title">{project?.name || projectId}</h1>
          {project && (
            <div className="project-view-meta">
              <span>{scripts.length} script{scripts.length !== 1 ? 's' : ''}</span>
              <span className="project-card-dot">&middot;</span>
              <span>Created {formatDate(project.created_at)}</span>
              <span className="project-card-dot">&middot;</span>
              <span>Modified {formatDate(project.updated_at)}</span>
            </div>
          )}
        </div>
        <button className="project-action-btn" onClick={() => setShowProperties(true)}>
          Properties
        </button>
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
              <button className="project-action-btn" onClick={() => setShowNewScript(true)}>
                + New Script
              </button>
              <button className="project-action-btn" onClick={handleImportScript}>
                Import
              </button>
            </div>
            {scripts.length === 0 ? (
              <div className="project-tab-empty">No scripts yet. Create or import one to get started.</div>
            ) : (
              <div className="project-scripts-list">
                {scripts.map((script) => (
                  <div key={script.id} className="project-script-item">
                    <div
                      className="project-script-info"
                      onClick={() => navigate(`/project/${projectId}/edit/${script.id}`)}
                    >
                      <div className="project-script-title">{script.title}</div>
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
                    <button
                      className="project-script-delete"
                      onClick={() => handleDeleteScript(script.id)}
                      title="Delete script"
                    >
                      &#x2715;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'assets' && projectId && (
          <AssetManager projectId={projectId} embedded />
        )}

        {activeTab === 'versions' && (
          <div className="project-versions-tab">
            {versions.length === 0 ? (
              <div className="project-tab-empty">No version history available.</div>
            ) : (
              <div className="project-versions-list">
                {versions.map((v) => (
                  <div key={v.hash} className="project-version-item">
                    <div className="project-version-message">{v.message}</div>
                    <div className="project-version-time">{formatDate(v.date)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Script Dialog */}
      {showNewScript && (
        <div className="dialog-overlay" onClick={() => setShowNewScript(false)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">New Script</div>
            <div className="dialog-body">
              <div className="dialog-row">
                <label>Script Title:</label>
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
        <div className="dialog-overlay" onClick={() => setPendingDeleteId(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Script</div>
            <div className="dialog-body">
              <p>Are you sure you want to delete this script? This cannot be undone.</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteId(null)}>Cancel</button>
              <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={confirmDeleteScript}>
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
