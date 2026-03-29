import React, { useState } from 'react';
import type { ProjectInfo, ProjectProperties } from '../services/api';
import { api } from '../services/api';
import { showToast } from './Toast';

const EMPTY_PROPS: ProjectProperties = {
  genre: '', logline: '', synopsis: '', author: '', contact: '',
  copyright: '', draft: '', language: '', format: '',
  production_company: '', director: '', producer: '',
  status: '', target_length: '', notes: '',
};

const FIELDS: { key: keyof ProjectProperties; label: string; type: 'text' | 'textarea' | 'select'; options?: string[] }[] = [
  { key: 'format', label: 'Type', type: 'select', options: ['', 'Feature Film', 'TV Pilot', 'TV Episode', 'Short Film', 'Web Series', 'Documentary', 'Animation', 'Stage Play', 'Other'] },
  { key: 'genre', label: 'Genre', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['', 'Concept', 'Outline', 'First Draft', 'Revision', 'Final Draft', 'In Development', 'Pre-Production', 'Production', 'Post-Production', 'Completed'] },
  { key: 'logline', label: 'Logline', type: 'textarea' },
  { key: 'synopsis', label: 'Synopsis', type: 'textarea' },
  { key: 'author', label: 'Written By', type: 'text' },
  { key: 'director', label: 'Director', type: 'text' },
  { key: 'producer', label: 'Producer', type: 'text' },
  { key: 'production_company', label: 'Production Company', type: 'text' },
  { key: 'draft', label: 'Draft', type: 'text' },
  { key: 'language', label: 'Language', type: 'text' },
  { key: 'target_length', label: 'Target Length', type: 'text' },
  { key: 'contact', label: 'Contact Info', type: 'text' },
  { key: 'copyright', label: 'Copyright', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

interface Props {
  project: ProjectInfo;
  onClose: () => void;
  onSaved: (updated: ProjectInfo) => void;
}

const ProjectPropertiesDialog: React.FC<Props> = ({ project, onClose, onSaved }) => {
  const [name, setName] = useState(project.name);
  const [props, setProps] = useState<ProjectProperties>({ ...EMPTY_PROPS, ...project.properties });
  const [saving, setSaving] = useState(false);

  const setField = (key: keyof ProjectProperties, value: string) => {
    setProps((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, { name, properties: props });
      onSaved(updated);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="props-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Project Properties</div>
        <div className="props-dialog-body">
          {/* Project name */}
          <div className="props-field">
            <label className="props-label">Project Name</label>
            <input
              className="props-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="props-divider" />

          {/* Two-column grid for fields */}
          <div className="props-grid">
            {FIELDS.map((f) => (
              <div
                key={f.key}
                className={`props-field${f.type === 'textarea' ? ' props-field-wide' : ''}`}
              >
                <label className="props-label">{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    className="props-textarea"
                    value={props[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    rows={3}
                  />
                ) : f.type === 'select' ? (
                  <select
                    className="props-input"
                    value={props[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    {f.options!.map((opt) => (
                      <option key={opt} value={opt}>{opt || '— Select —'}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="props-input"
                    value={props[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectPropertiesDialog;
