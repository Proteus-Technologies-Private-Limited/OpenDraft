import React from 'react';
import type { Asset } from '../stores/assetStore';
import { SERVER_BASE } from '../config';

const API_BASE = SERVER_BASE;

interface AssetViewerProps {
  asset: Asset;
  projectId: string;
  onClose: () => void;
}

const AssetViewer: React.FC<AssetViewerProps> = ({ asset, projectId, onClose }) => {
  const assetUrl = `${API_BASE}/api/projects/${projectId}/assets/${asset.id}`;
  const mime = asset.mime_type;

  const renderPreview = () => {
    if (mime.startsWith('image/')) {
      return <img src={assetUrl} alt={asset.original_name} className="asset-viewer-image" />;
    }
    if (mime === 'application/pdf') {
      return <iframe src={assetUrl} className="asset-viewer-iframe" title={asset.original_name} />;
    }
    if (mime.startsWith('audio/')) {
      return (
        <audio controls className="asset-viewer-audio">
          <source src={assetUrl} type={mime} />
          Your browser does not support the audio element.
        </audio>
      );
    }
    if (mime.startsWith('video/')) {
      return (
        <video controls className="asset-viewer-video">
          <source src={assetUrl} type={mime} />
          Your browser does not support the video element.
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
          Download File
        </a>
      </div>
    );
  };

  return (
    <div className="asset-viewer-overlay" onClick={onClose}>
      <div className="asset-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="asset-viewer-header">
          <span className="asset-viewer-title">{asset.original_name}</span>
          <button
            className="asset-viewer-close"
            onClick={onClose}
            aria-label="Close asset viewer"
          >
            &times;
          </button>
        </div>
        <div className="asset-viewer-content">
          {renderPreview()}
        </div>
      </div>
    </div>
  );
};

const TextPreview: React.FC<{ url: string }> = ({ url }) => {
  const [text, setText] = React.useState<string>('Loading...');

  React.useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Failed to load text content'));
  }, [url]);

  return <pre className="asset-viewer-text">{text}</pre>;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default AssetViewer;
