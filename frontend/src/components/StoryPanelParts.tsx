/**
 * Pieces Character Profiles, Location Profiles and Scene Details share: the
 * panel header, tabs, a text field that saves when the writer leaves it,
 * the profile-completeness ring, and moving the script to a position.
 */
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../i18n/useLanguage';
import { api } from '../services/api';
import { useAssetStore } from '../stores/assetStore';
import { showToast } from './Toast';
import { AssetImagePicker, ImageLightbox } from './ReferenceImages';

interface HeaderProps {
  title: React.ReactNode;
  count?: React.ReactNode;
  /** Shown before the wide and close buttons. */
  extra?: React.ReactNode;
  /** A back button, for a detail shown without its list. */
  onBack?: () => void;
  wide?: boolean;
  onToggleWide?: () => void;
  onClose: () => void;
  /** Bigger, unstyled-case title — the name of the record shown. */
  recordTitle?: boolean;
}

export const StoryPanelHeader: React.FC<HeaderProps> = ({
  title, count, extra, onBack, wide, onToggleWide, onClose, recordTitle,
}) => {
  const { t } = useTranslation(['story', 'common']);
  const { isRtl } = useLanguage();
  return (
    <div className="sp-head">
      {onBack && (
        <button type="button" className="sp-icon-btn" onClick={onBack} title={t('common:back')} aria-label={t('common:back')}>
          {isRtl ? '›' : '‹'}
        </button>
      )}
      <h2 className={`sp-title${recordTitle ? ' sp-title-record' : ''}`}>{title}</h2>
      {count != null && <span className="sp-count">{count}</span>}
      <span className="sp-grow" />
      {extra}
      {onToggleWide && (
        <button
          type="button"
          className="sp-icon-btn sp-wide-btn"
          onClick={onToggleWide}
          title={wide ? t('storyPanels.sideView') : t('storyPanels.wideView')}
          aria-label={wide ? t('storyPanels.sideView') : t('storyPanels.wideView')}
          aria-pressed={!!wide}
        >
          {wide ? '⤡' : '⛶'}
        </button>
      )}
      <button type="button" className="sp-icon-btn" onClick={onClose} title={t('common:close')} aria-label={t('common:close')}>
        &times;
      </button>
    </div>
  );
};

export function StoryPanelTabs<T extends string>({ value, onChange, tabs, label }: {
  value: T;
  onChange: (v: T) => void;
  tabs: Array<{ id: T; label: React.ReactNode }>;
  label: string;
}) {
  return (
    <div className="sp-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={`sp-tab${value === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface DraftTextProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/**
 * A text field that keeps what is typed to itself and saves it when the
 * writer leaves the field or presses Enter (Escape puts the saved text back).
 * Saving on every key would rewrite the script — or call the server — once
 * per letter.
 */
export const DraftText: React.FC<DraftTextProps> = ({
  value, onCommit, placeholder, multiline, rows = 2, className, id, ...rest
}) => {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const [editing, setEditing] = useState(false);
  // A change from elsewhere (another panel, a collaborator) shows unless the
  // writer is typing in this field.
  if (!editing && value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  // Escape blurs the field too; the blur must not then save what it threw away.
  const cancelled = useRef(false);
  const commit = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; return; }
    if (draft !== value) onCommit(draft);
  };
  const common = {
    id,
    className: `${multiline ? 'sp-textarea' : 'sp-input'}${className ? ` ${className}` : ''}`,
    value: draft,
    placeholder,
    'aria-label': rest['aria-label'],
    onFocus: () => setEditing(true),
    onBlur: commit,
  };
  if (multiline) {
    return (
      <textarea
        {...common}
        rows={rows}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { cancelled.current = true; setDraft(value); (e.target as HTMLTextAreaElement).blur(); }
        }}
      />
    );
  }
  return (
    <input
      {...common}
      type="text"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { cancelled.current = true; setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
};

export interface CompletenessField { label: string; filled: boolean }

/** How much of a profile is filled in, as a ring with the list of fields on hover. */
export const CompletenessRing: React.FC<{ fields: CompletenessField[] }> = ({ fields }) => {
  const { t } = useTranslation(['story', 'common']);
  const filled = fields.filter((f) => f.filled).length;
  const pct = fields.length ? Math.round((filled / fields.length) * 100) : 0;
  const color = pct === 0 ? 'var(--fd-text-muted, #666)'
    : pct < 40 ? '#f44336'
    : pct < 70 ? '#ff9800'
    : pct < 100 ? '#4caf50'
    : '#2e7d32';
  return (
    <div className="char-profile-completeness" aria-label={t('characters.profileCompleteness', { filled, total: fields.length })}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="9" fill="none" stroke="var(--fd-border, #333)" strokeWidth="2" />
        <circle
          cx="11" cy="11" r="9" fill="none"
          stroke={color} strokeWidth="2"
          strokeDasharray={`${pct * 0.5655} 56.55`}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="char-profile-completeness-label" style={{ color }}>{pct}%</span>
      <div className="char-completeness-tooltip">
        <div className="char-completeness-tooltip-title">{t('characters.profileCompleteness', { filled, total: fields.length })}</div>
        {fields.map((f) => (
          <div key={f.label} className={`char-completeness-tooltip-row${f.filled ? ' filled' : ''}`}>
            <span>{f.filled ? '✓' : '✗'}</span> {f.label}
          </div>
        ))}
      </div>
    </div>
  );
};

interface ImageSlotProps {
  projectId: string;
  /** The image's asset id, or null. */
  assetId: string | null;
  /** Who or what the image shows — alt text, and the tag an upload is given. */
  name: string;
  /** Asset tag for an upload, e.g. `costume:ANNA`. */
  uploadTag: string;
  onChange: (assetId: string | null) => void;
  /** Smaller, for a row in a list. */
  small?: boolean;
}

/**
 * One reference image — a costume's, a look's: shows it, opens it large, and
 * lets the writer upload one, pick one of the project's assets, or remove it.
 */
export const ImageSlot: React.FC<ImageSlotProps> = ({ projectId, assetId, name, uploadTag, onChange, small }) => {
  const { t } = useTranslation(['story', 'common']);
  const { assets, setAssets } = useAssetStore();
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const url = (id: string) => (projectId ? api.getAssetUrl(projectId, id) : '');

  const refresh = async () => {
    try {
      setAssets(await api.listAssets(projectId));
    } catch (err) {
      console.warn('[story panels] could not list the project’s assets', err);
    }
  };

  const upload = async (file: File) => {
    if (file.type && !file.type.startsWith('image/')) {
      showToast(t('characters.imageUploadFailed', { message: file.name }), 'error');
      return;
    }
    setUploading(true);
    try {
      const data = await api.uploadAsset(projectId, file, [uploadTag]);
      const id: string | undefined = data?.id || data?.asset?.id;
      if (!id) throw new Error(t('characters.unknownError'));
      onChange(id);
      showToast(t('characters.imageUploaded'), 'success');
      void refresh();
    } catch (err) {
      const handled = !!err && typeof err === 'object' && (err as { handled?: unknown }).handled === true;
      if (!handled) {
        showToast(t('characters.imageUploadFailed', { message: err instanceof Error ? err.message : t('characters.unknownError') }), 'error');
      }
    } finally {
      setUploading(false);
    }
  };

  if (!projectId) return null;
  return (
    <div className={`sp-image-slot${small ? ' small' : ''}`}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      {assetId ? (
        <>
          <button type="button" className="sp-image-thumb" onClick={() => setViewing(true)} title={name}>
            <img src={url(assetId)} alt={name} loading="lazy" />
          </button>
          <button
            type="button"
            className="sp-icon-btn sp-image-remove"
            onClick={() => onChange(null)}
            title={t('characters.removeImage')}
            aria-label={t('characters.removeImage')}
          >
            &times;
          </button>
        </>
      ) : (
        <div className="sp-image-empty">
          <button type="button" className="sp-link-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? t('characters.uploading') : t('characters.uploadImage')}
          </button>
          <button type="button" className="sp-link-btn" onClick={() => { setPicking(true); void refresh(); }}>
            {t('characters.fromAssets')}
          </button>
        </div>
      )}
      {picking && (
        <AssetImagePicker
          title={t('characters.selectImageFor', { name })}
          assets={assets}
          linkedIds={assetId ? [assetId] : []}
          emptyText={t('characters.noImageAssets')}
          getUrl={url}
          onPick={(id) => { setPicking(false); onChange(id); }}
          onClose={() => setPicking(false)}
        />
      )}
      {viewing && assetId && <ImageLightbox url={url(assetId)} name={name} onClose={() => setViewing(false)} />}
    </div>
  );
};
