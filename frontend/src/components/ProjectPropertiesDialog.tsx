import React, { useState } from 'react';
import type { ProjectInfo, ProjectProperties, SubmissionEntry } from '../services/api';
import { api } from '../services/api';
import { showToast } from './Toast';

const EMPTY_PROPS: ProjectProperties = {
  genre: '', logline: '', synopsis: '', author: '', contact: '',
  copyright: '', draft: '', language: '', format: '',
  production_company: '', director: '', producer: '',
  status: '', target_length: '', notes: '',
  wga_registration: '', wga_registration_date: '',
  copyright_registration: '', copyright_year: '',
  agent_name: '', agent_contact: '',
  manager_name: '', manager_contact: '',
  submissions: [],
};

type FieldDef = { key: keyof ProjectProperties; label: string; type: 'text' | 'textarea' | 'select'; options?: string[] };

const FIELDS: FieldDef[] = [
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

const REGISTRATION_FIELDS: FieldDef[] = [
  { key: 'wga_registration', label: 'WGA Registration #', type: 'text' },
  { key: 'wga_registration_date', label: 'WGA Registration Date', type: 'text' },
  { key: 'copyright_registration', label: 'Copyright Registration #', type: 'text' },
  { key: 'copyright_year', label: 'Copyright Year', type: 'text' },
  { key: 'agent_name', label: 'Agent', type: 'text' },
  { key: 'agent_contact', label: 'Agent Contact', type: 'text' },
  { key: 'manager_name', label: 'Manager', type: 'text' },
  { key: 'manager_contact', label: 'Manager Contact', type: 'text' },
];

interface Props {
  project: ProjectInfo;
  onClose: () => void;
  onSaved: (updated: ProjectInfo) => void;
}

const EMPTY_SUBMISSION: SubmissionEntry = {
  id: '', date: '', submitted_to: '', type: '', status: '', notes: '',
};

const renderField = (
  f: FieldDef,
  value: string,
  onChange: (key: keyof ProjectProperties, val: string) => void,
) => (
  <div
    key={f.key}
    className={`props-field${f.type === 'textarea' ? ' props-field-wide' : ''}`}
  >
    <label className="props-label">{f.label}</label>
    {f.type === 'textarea' ? (
      <textarea
        className="props-textarea"
        value={value}
        onChange={(e) => onChange(f.key, e.target.value)}
        rows={3}
      />
    ) : f.type === 'select' ? (
      <select
        className="props-input"
        value={value}
        onChange={(e) => onChange(f.key, e.target.value)}
      >
        {f.options!.map((opt) => (
          <option key={opt} value={opt}>{opt || '— Select —'}</option>
        ))}
      </select>
    ) : (
      <input
        className="props-input"
        value={value}
        onChange={(e) => onChange(f.key, e.target.value)}
      />
    )}
  </div>
);

const ProjectPropertiesDialog: React.FC<Props> = ({ project, onClose, onSaved }) => {
  const [name, setName] = useState(project.name);
  const [props, setProps] = useState<ProjectProperties>({ ...EMPTY_PROPS, ...project.properties });
  const [saving, setSaving] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);

  const setField = (key: keyof ProjectProperties, value: string) => {
    setProps((prev) => ({ ...prev, [key]: value }));
  };

  const addSubmission = () => {
    const entry: SubmissionEntry = { ...EMPTY_SUBMISSION, id: crypto.randomUUID() };
    setProps((prev) => ({ ...prev, submissions: [...(prev.submissions || []), entry] }));
  };

  const updateSubmission = (id: string, field: keyof SubmissionEntry, value: string) => {
    setProps((prev) => ({
      ...prev,
      submissions: (prev.submissions || []).map((s) =>
        s.id === id ? { ...s, [field]: value } : s
      ),
    }));
  };

  const removeSubmission = (id: string) => {
    setProps((prev) => ({
      ...prev,
      submissions: (prev.submissions || []).filter((s) => s.id !== id),
    }));
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
            {FIELDS.map((f) => renderField(f, props[f.key] as string, setField))}
          </div>

          {/* Registration & Legal — collapsible */}
          <div className="props-divider" />
          <button
            className="props-section-toggle"
            onClick={() => setLegalOpen(!legalOpen)}
            type="button"
          >
            <span className={`props-section-arrow${legalOpen ? ' open' : ''}`}>&#9654;</span>
            Registration &amp; Legal
          </button>
          {legalOpen && (
            <>
              <div className="props-grid">
                {REGISTRATION_FIELDS.map((f) => renderField(f, props[f.key] as string, setField))}
              </div>

              {/* Submission Log */}
              <div className="props-field props-field-wide" style={{ marginTop: 12 }}>
                <label className="props-label">Submission Log</label>
                {(props.submissions || []).length > 0 && (
                  <div className="props-submissions-table">
                    <div className="props-submissions-header">
                      <span>Date</span>
                      <span>Submitted To</span>
                      <span>Type</span>
                      <span>Status</span>
                      <span>Notes</span>
                      <span></span>
                    </div>
                    {(props.submissions || []).map((sub) => (
                      <div key={sub.id} className="props-submissions-row">
                        <input
                          className="props-input"
                          type="date"
                          value={sub.date}
                          onChange={(e) => updateSubmission(sub.id, 'date', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.submitted_to}
                          placeholder="Company/Person"
                          onChange={(e) => updateSubmission(sub.id, 'submitted_to', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.type}
                          placeholder="e.g. Query"
                          onChange={(e) => updateSubmission(sub.id, 'type', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.status}
                          placeholder="e.g. Pending"
                          onChange={(e) => updateSubmission(sub.id, 'status', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.notes}
                          placeholder="Notes"
                          onChange={(e) => updateSubmission(sub.id, 'notes', e.target.value)}
                        />
                        <button
                          className="props-submissions-remove"
                          onClick={() => removeSubmission(sub.id)}
                          title="Remove entry"
                          type="button"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="props-submissions-add"
                  onClick={addSubmission}
                  type="button"
                >
                  + Add Submission
                </button>
              </div>
            </>
          )}
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
