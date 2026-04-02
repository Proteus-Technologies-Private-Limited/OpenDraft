import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { ProjectInfo, ScriptMeta } from '../services/api';

interface ProjectWithScripts {
  project: ProjectInfo;
  scripts: ScriptMeta[];
}

interface OpenFromProjectProps {
  onOpen: (projectId: string, project: ProjectInfo, scriptId: string, scriptTitle: string) => void;
  onClose: () => void;
}

const OpenFromProject: React.FC<OpenFromProjectProps> = ({ onOpen, onClose }) => {
  const [groups, setGroups] = useState<ProjectWithScripts[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const projects = await api.listProjects();
        const all = await Promise.all(
          projects.map(async (project) => {
            try {
              const scripts = await api.listScripts(project.id);
              return { project, scripts };
            } catch {
              return { project, scripts: [] };
            }
          }),
        );
        setGroups(all.filter((g) => g.scripts.length > 0));
      } catch {
        setGroups([]);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box open-from-project-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Open from Project</div>
        <div className="dialog-body" style={{ maxHeight: 420, overflow: 'auto', padding: '8px 16px 16px' }}>
          {loading ? (
            <div style={{ color: 'var(--fd-text-muted)', padding: 16, textAlign: 'center' }}>Loading...</div>
          ) : groups.length === 0 ? (
            <div style={{ color: 'var(--fd-text-muted)', padding: 16, textAlign: 'center', lineHeight: 1.6 }}>
              No scripts found. Use <strong style={{ color: 'var(--fd-text)' }}>File &gt; Import</strong> to create a project with a script.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.project.id} style={{ marginBottom: 12 }}>
                <div className="open-project-group-header">{g.project.name}</div>
                {g.scripts.map((s) => (
                  <div
                    key={s.id}
                    className="open-project-item"
                    onClick={() => onOpen(g.project.id, g.project, s.id, s.title)}
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

export default OpenFromProject;
