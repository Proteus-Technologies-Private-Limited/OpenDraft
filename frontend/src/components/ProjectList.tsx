import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { ProjectInfo } from '../services/api';

interface ProjectWithCount extends ProjectInfo {
  script_count: number;
}

const ProjectList: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const projectList = await api.listProjects();
      // Fetch script counts for each project
      const withCounts: ProjectWithCount[] = await Promise.all(
        projectList.map(async (p) => {
          try {
            const scripts = await api.listScripts(p.id);
            return { ...p, script_count: scripts.length };
          } catch {
            return { ...p, script_count: 0 };
          }
        })
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

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      await api.createProject(newProjectName.trim());
      setShowNewDialog(false);
      setNewProjectName('');
      await fetchProjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create project');
    }
    setCreating(false);
  };

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="project-list-page">
      <div className="project-list-header">
        <div className="project-list-title-area">
          <h1 className="project-list-title">OpenDraft</h1>
          <span className="project-list-subtitle">Your Projects</span>
        </div>
        <button
          className="project-new-btn"
          onClick={() => setShowNewDialog(true)}
        >
          + New Project
        </button>
      </div>

      {loading ? (
        <div className="project-list-loading">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="project-list-empty">
          <div className="project-list-empty-icon">&#128209;</div>
          <div>No projects yet. Create your first project to get started.</div>
        </div>
      ) : (
        <div className="project-list-grid">
          {projects.map((project) => (
            <div
              key={project.id}
              className="project-card"
              onClick={() => navigate(`/project/${project.id}`)}
            >
              <div className="project-card-name">{project.name}</div>
              <div className="project-card-meta">
                <span>{project.script_count} script{project.script_count !== 1 ? 's' : ''}</span>
              </div>
              <div className="project-card-meta">
                <span>Created {formatDate(project.created_at)}</span>
                <span className="project-card-dot">&middot;</span>
                <span>Modified {formatDate(project.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
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
    </div>
  );
};

export default ProjectList;
