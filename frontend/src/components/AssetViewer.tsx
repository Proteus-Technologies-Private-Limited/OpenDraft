import React from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import type { Asset } from '../stores/assetStore';
import { api } from '../services/api';

interface AssetViewerProps {
  asset: Asset;
  projectId: string;
  onClose: () => void;
}

const AssetViewer: React.FC<AssetViewerProps> = ({ asset, projectId, onClose }) => {
  const { t } = useTranslation('tools');
  const assetUrl = api.getAssetUrl(projectId, asset.id, asset.filename);
  const mime = asset.mime_type;

  const renderPreview = () => {
    if (mime.startsWith('image/')) {
      return <img src={assetUrl} alt={asset.original_name} className="asset-viewer-image" />;
    }
    if (mime === 'application/pdf') {
      // Use ?disposition=inline for backend URLs; asset:// protocol serves inline by default
      const pdfUrl = assetUrl.startsWith('asset://')
        ? assetUrl
        : assetUrl + (assetUrl.includes('?') ? '&' : '?') + 'disposition=inline';
      return <embed src={pdfUrl} type="application/pdf" className="asset-viewer-iframe" title={asset.original_name} />;
    }
    if (mime.startsWith('audio/')) {
      return (
        <audio controls className="asset-viewer-audio">
          <source src={assetUrl} type={mime} />
          {t('assetViewer.noAudio')}
        </audio>
      );
    }
    if (mime.startsWith('video/')) {
      return (
        <video controls className="asset-viewer-video">
          <source src={assetUrl} type={mime} />
          {t('assetViewer.noVideo')}
        </video>
      );
    }
    if (mime.startsWith('text/')) {
      return <TextPreview url={assetUrl} />;
    }
    return (
      <div className="asset-viewer-fallback">
        <div className="asset-viewer-icon">&#128196;</div>
        <div className="asset-viewer-filename">{asset.original_name}</div>
        <div className="asset-viewer-meta">
          {mime} &middot; {formatSize(asset.size_bytes)}
        </div>
        <a href={assetUrl} download={asset.original_name} className="asset-viewer-download-link">
          {t('assetViewer.download')}
        </a>
      </div>
    );
  };

  return (
    <ModalOverlay dialogLabel={asset.original_name} className="asset-viewer-overlay" onClick={onClose}>
      <div className="asset-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="asset-viewer-header">
          <span className="asset-viewer-title">{asset.original_name}</span>
          <button
            className="asset-viewer-close"
            onClick={onClose}
            aria-label={t('assetViewer.close')}
          >
            &times;
          </button>
        </div>
        <div className="asset-viewer-content">
          {renderPreview()}
        </div>
      </div>
    </ModalOverlay>
  );
};

const TextPreview: React.FC<{ url: string }> = ({ url }) => {
  const { t } = useTranslation('tools');
  // null while loading; `failed` when the file could not be read.
  const [text, setText] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setText(null);
    setFailed(false);
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch((err) => {
        console.error('[assets] could not load text preview', err);
        setFailed(true);
      });
  }, [url]);

  return <pre className="asset-viewer-text">{failed ? t('assetViewer.loadFailed') : text ?? t('assetViewer.loading')}</pre>;
};

function formatSize(bytes: number): string {
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, oneDecimal)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), oneDecimal)} MB`;
}

export default AssetViewer;
