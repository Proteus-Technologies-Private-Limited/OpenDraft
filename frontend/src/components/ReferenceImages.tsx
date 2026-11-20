/**
 * Reference images attached to something in the story — a character, a
 * location: the gallery that shows them, the dialog that picks one from the
 * project's assets, and the lightbox that shows one large.
 *
 * The images themselves are project assets; the owner keeps only a list of
 * asset ids, the first of which is its main image. These components render
 * and report clicks — storing the list is the caller's job, since a character
 * lives in the script and a location in the project.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalOverlay } from './ModalOverlay';
import type { Asset } from '../stores/assetStore';

interface GalleryProps {
  /** Asset ids, main image first. Renders nothing when empty. */
  imageIds: string[];
  /** Who or what the images show — alt text. */
  name: string;
  getUrl: (assetId: string) => string;
  onOpen: (assetId: string) => void;
  onSetPrimary: (assetId: string) => void;
  onRemove: (assetId: string) => void;
}

/**
 * The main image with a strip of every image below it.
 *
 * The strip is shown for a single image too: its thumbnail carries the only
 * Remove button, and hiding the strip left a lone image with no way to take
 * it off again.
 */
export const ReferenceImageGallery: React.FC<GalleryProps> = ({
  imageIds, name, getUrl, onOpen, onSetPrimary, onRemove,
}) => {
  const { t } = useTranslation(['story', 'common']);
  if (imageIds.length === 0) return null;
  const [primary] = imageIds;
  return (
    <div className="char-profile-images">
      <div className="char-profile-images-primary">
        <img
          src={getUrl(primary)}
          alt={name}
          className="char-profile-image-main"
          onClick={() => onOpen(primary)}
        />
      </div>
      <div className="char-profile-images-strip">
        {imageIds.map((imgId, idx) => (
          <div key={imgId} className={`char-profile-thumb-wrap${idx === 0 ? ' active' : ''}`}>
            <img
              src={getUrl(imgId)}
              alt={`${name} ${idx + 1}`}
              className="char-profile-thumb"
              loading="lazy"
              onClick={() => onOpen(imgId)}
            />
            {idx > 0 && (
              <button
                type="button"
                className="char-profile-thumb-primary"
                onClick={() => onSetPrimary(imgId)}
                title={t('characters.setPrimaryImage')}
                aria-label={t('characters.setPrimaryImage')}
              >
                &#9733;
              </button>
            )}
            <button
              type="button"
              className="char-profile-thumb-remove"
              onClick={() => onRemove(imgId)}
              title={t('characters.removeImage')}
              aria-label={t('characters.removeImage')}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

interface PickerProps {
  /** Dialog heading, e.g. "Select Image for ANNA". */
  title: string;
  /** The project's assets; anything that is not an image is left out. */
  assets: Asset[];
  /** Ids already attached — shown, but not selectable again. */
  linkedIds: string[];
  /** Shown when the project has no image assets at all. */
  emptyText: string;
  getUrl: (assetId: string) => string;
  onPick: (assetId: string) => void;
  onClose: () => void;
}

/** Choose one of the project's image assets. */
export const AssetImagePicker: React.FC<PickerProps> = ({
  title, assets, linkedIds, emptyText, getUrl, onPick, onClose,
}) => {
  const { t } = useTranslation(['story', 'common']);
  const [filter, setFilter] = useState('');

  const images = useMemo(
    () => assets.filter((a) => (a.mime_type || '').startsWith('image/')),
    [assets],
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? images.filter((a) => (a.original_name || '').toLowerCase().includes(q)) : images;
  }, [images, filter]);

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box char-image-picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          {title}
          <button type="button" className="char-profiles-close" aria-label={t('common:close')} onClick={onClose}>&times;</button>
        </div>
        <div className="char-image-picker-search">
          <input
            type="text"
            placeholder={t('characters.placeholder.filterImages')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="char-profiles-search-input"
            autoFocus
          />
        </div>
        <div className="char-image-picker-grid">
          {images.length === 0 ? (
            <div className="char-profiles-empty">{emptyText}</div>
          ) : (
            shown.map((asset) => {
              const alreadyLinked = linkedIds.includes(asset.id);
              return (
                <div
                  key={asset.id}
                  className={`char-image-picker-item${alreadyLinked ? ' linked' : ''}`}
                  onClick={() => { if (!alreadyLinked) onPick(asset.id); }}
                  title={alreadyLinked ? t('characters.alreadyAssociated') : t('characters.associateNamed', { name: asset.original_name })}
                >
                  <img src={getUrl(asset.id)} alt={asset.original_name} loading="lazy" />
                  <span className="char-image-picker-name">{asset.original_name}</span>
                  {alreadyLinked && <span className="char-image-picker-linked">{t('characters.linked')}</span>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};

interface LightboxProps {
  url: string;
  /** Who or what the image shows — the dialog's label and the alt text. */
  name: string;
  onClose: () => void;
}

/** One image, as large as the window allows. */
export const ImageLightbox: React.FC<LightboxProps> = ({ url, name, onClose }) => {
  const { t } = useTranslation(['story', 'common']);
  return (
    <ModalOverlay dialogLabel={name} className="dialog-overlay char-lightbox-overlay" onClick={onClose}>
      <div className="char-lightbox" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={name} />
        <button type="button" className="char-lightbox-close" aria-label={t('common:close')} onClick={onClose}>&times;</button>
      </div>
    </ModalOverlay>
  );
};
