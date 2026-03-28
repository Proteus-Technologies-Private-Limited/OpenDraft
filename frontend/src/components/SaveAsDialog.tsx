import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

interface SaveAsDialogProps {
  defaultProjectName: string;
  defaultFileName: string;
  onSaved: (projectId: string, projectName: string, scriptId: string, scriptTitle: string) => void;
  onClose: () => void;
  buildContent: () => Record<string, unknown> | undefined;
}

const SaveAsDialog: React.FC<SaveAsDialogProps> = ({
  defaultProjectName,
  defaultFileName,
  onSaved,
  onClose,
  buildContent,
}) => {
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [fileName, setFileName] = useState(defaultFileName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const projectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    projectInputRef.current?.select();
  }, []);

  const handleSave = async () => {
    const trimmedProject = projectName.trim();
    const trimmedFile = fileName.trim();
    if (!trimmedProject || !trimmedFile) return;

    setSaving(true);
    setError('');

    try {
      // Create or find existing project
      let project;
      try {
        project = await api.createProject(trimmedProject);
      } catch {
        const projects = await api.listProjects();
        project = projects.find(
          (p) => p.name.toLowerCase() === trimmedProject.toLowerCase()
        );
        if (!project) {
          setError('Could not create or find project');
          setSaving(false);
          return;
        }
      }

      // Create script in the project
      const content = buildContent();
      const scriptResp = await api.createScript(project.id, {
        title: trimmedFile,
        content: content || undefined,
      });

      onSaved(project.id, trimmedProject, scriptResp.meta.id, trimmedFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && projectName.trim() && fileName.trim()) {
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="dialog-header">Save Screenplay</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label>Project Name</label>
            <input
              ref={projectInputRef}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My Project"
              autoFocus
            />
          </div>
          <div className="dialog-row" style={{ marginTop: 12 }}>
            <label>File Name</label>
            <input
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
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveAsDialog;
