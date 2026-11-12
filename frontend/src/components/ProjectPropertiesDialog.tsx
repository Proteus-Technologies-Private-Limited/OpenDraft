import React, { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { t as translate } from '../i18n';
import type { ProjectInfo, ProjectProperties, SubmissionEntry } from '../services/api';
import { api } from '../services/api';
import { showToast } from './Toast';
import Select from './Select';

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

type FieldDef = { key: keyof ProjectProperties; label: () => string; type: 'text' | 'textarea' | 'select'; options?: string[] };

const FIELDS: FieldDef[] = [
  { key: 'format', label: () => translate('projects:properties.field.type'), type: 'select', options: ['', 'Feature Film', 'TV Pilot', 'TV Episode', 'Short Film', 'Web Series', 'Documentary', 'Animation', 'Stage Play', 'Other'] },
  { key: 'genre', label: () => translate('projects:properties.field.genre'), type: 'text' },
  { key: 'status', label: () => translate('projects:properties.field.status'), type: 'select', options: ['', 'Concept', 'Outline', 'First Draft', 'Revision', 'Final Draft', 'In Development', 'Pre-Production', 'Production', 'Post-Production', 'Completed'] },
  { key: 'logline', label: () => translate('projects:properties.field.logline'), type: 'textarea' },
  { key: 'synopsis', label: () => translate('projects:properties.field.synopsis'), type: 'textarea' },
  { key: 'author', label: () => translate('projects:properties.field.writtenBy'), type: 'text' },
  { key: 'director', label: () => translate('projects:properties.field.director'), type: 'text' },
  { key: 'producer', label: () => translate('projects:properties.field.producer'), type: 'text' },
  { key: 'production_company', label: () => translate('projects:properties.field.productionCompany'), type: 'text' },
  { key: 'draft', label: () => translate('projects:properties.field.draft'), type: 'text' },
  { key: 'language', label: () => translate('projects:properties.field.language'), type: 'text' },
  { key: 'target_length', label: () => translate('projects:properties.field.targetLength'), type: 'text' },
  { key: 'contact', label: () => translate('projects:properties.field.contactInfo'), type: 'text' },
  { key: 'copyright', label: () => translate('projects:properties.field.copyright'), type: 'text' },
  { key: 'notes', label: () => translate('projects:properties.field.notes'), type: 'textarea' },
];

const REGISTRATION_FIELDS: FieldDef[] = [
  { key: 'wga_registration', label: () => translate('projects:properties.field.wgaRegistration'), type: 'text' },
  { key: 'wga_registration_date', label: () => translate('projects:properties.field.wgaRegistrationDate'), type: 'text' },
  { key: 'copyright_registration', label: () => translate('projects:properties.field.copyrightRegistration'), type: 'text' },
  { key: 'copyright_year', label: () => translate('projects:properties.field.copyrightYear'), type: 'text' },
  { key: 'agent_name', label: () => translate('projects:properties.field.agent'), type: 'text' },
  { key: 'agent_contact', label: () => translate('projects:properties.field.agentContact'), type: 'text' },
  { key: 'manager_name', label: () => translate('projects:properties.field.manager'), type: 'text' },
  { key: 'manager_contact', label: () => translate('projects:properties.field.managerContact'), type: 'text' },
];

/**
 * The text shown for a stored option. The stored value stays the English one
 * (it is saved with the project); only the display follows the language.
 */
const OPTION_TEXT: Record<string, Record<string, () => string>> = {
  format: {
    'Feature Film': () => translate('projects:properties.type.featureFilm'),
    'TV Pilot': () => translate('projects:properties.type.tvPilot'),
    'TV Episode': () => translate('projects:properties.type.tvEpisode'),
    'Short Film': () => translate('projects:properties.type.shortFilm'),
    'Web Series': () => translate('projects:properties.type.webSeries'),
    'Documentary': () => translate('projects:properties.type.documentary'),
    'Animation': () => translate('projects:properties.type.animation'),
    'Stage Play': () => translate('projects:properties.type.stagePlay'),
    'Other': () => translate('projects:properties.type.other'),
  },
  status: {
    'Concept': () => translate('projects:properties.status.concept'),
    'Outline': () => translate('projects:properties.status.outline'),
    'First Draft': () => translate('projects:properties.status.firstDraft'),
    'Revision': () => translate('projects:properties.status.revision'),
    'Final Draft': () => translate('projects:properties.status.finalDraft'),
    'In Development': () => translate('projects:properties.status.inDevelopment'),
    'Pre-Production': () => translate('projects:properties.status.preProduction'),
    'Production': () => translate('projects:properties.status.production'),
    'Post-Production': () => translate('projects:properties.status.postProduction'),
    'Completed': () => translate('projects:properties.status.completed'),
  },
};

function optionLabel(field: keyof ProjectProperties, value: string): string {
  const read = OPTION_TEXT[field as string]?.[value];
  if (!read) return value;
  try {
    return read();
  } catch (err) {
    console.warn('[ProjectProperties] could not translate option', err);
    return value;
  }
}

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
    <label className="props-label">{f.label()}</label>
    {f.type === 'textarea' ? (
      <textarea
        className="props-textarea"
        value={value}
        onChange={(e) => onChange(f.key, e.target.value)}
        rows={3}
      />
    ) : f.type === 'select' ? (
      <Select
        className="props-input"
        value={value}
        onChange={(e) => onChange(f.key, e.target.value)}
      >
        {f.options!.map((opt) => (
          <option key={opt} value={opt}>{opt ? optionLabel(f.key, opt) : translate('projects:properties.select')}</option>
        ))}
      </Select>
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
  const { t } = useTranslation(['projects', 'common']);
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
      showToast(err instanceof Error ? err.message : t('properties.saveFailed'), 'error');
    }
    setSaving(false);
  };

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div className="props-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">{t('properties.title')}</div>
        <div className="props-dialog-body">
          {/* Project name */}
          <div className="props-field">
            <label className="props-label">{t('properties.projectName')}</label>
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
            {t('properties.registrationLegal')}
          </button>
          {legalOpen && (
            <>
              <div className="props-grid">
                {REGISTRATION_FIELDS.map((f) => renderField(f, props[f.key] as string, setField))}
              </div>

              {/* Submission Log */}
              <div className="props-field props-field-wide" style={{ marginTop: 12 }}>
                <label className="props-label">{t('properties.submissionLog')}</label>
                {(props.submissions || []).length > 0 && (
                  <div className="props-submissions-table">
                    <div className="props-submissions-header">
                      <span>{t('properties.submission.date')}</span>
                      <span>{t('properties.submission.submittedTo')}</span>
                      <span>{t('properties.submission.type')}</span>
                      <span>{t('properties.submission.status')}</span>
                      <span>{t('properties.submission.notes')}</span>
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
                          placeholder={t('properties.submission.submittedToPlaceholder')}
                          onChange={(e) => updateSubmission(sub.id, 'submitted_to', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.type}
                          placeholder={t('properties.submission.typePlaceholder')}
                          onChange={(e) => updateSubmission(sub.id, 'type', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.status}
                          placeholder={t('properties.submission.statusPlaceholder')}
                          onChange={(e) => updateSubmission(sub.id, 'status', e.target.value)}
                        />
                        <input
                          className="props-input"
                          value={sub.notes}
                          placeholder={t('properties.submission.notes')}
                          onChange={(e) => updateSubmission(sub.id, 'notes', e.target.value)}
                        />
                        <button
                          className="props-submissions-remove"
                          onClick={() => removeSubmission(sub.id)}
                          title={t('properties.submission.remove')}
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
                  {t('properties.submission.add')}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? t('properties.saving') : t('common:save')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ProjectPropertiesDialog;
