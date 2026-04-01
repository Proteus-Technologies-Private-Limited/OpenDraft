import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAssetStore } from '../stores/assetStore';
import type { Asset } from '../stores/assetStore';
import AssetViewer from './AssetViewer';
import { SERVER_BASE } from '../config';

const API_BASE = SERVER_BASE;

interface AssetManagerProps {
  projectId: string;
  embedded?: boolean;
}

const AssetManager: React.FC<AssetManagerProps> = ({ projectId, embedded = false }) => {
  const { assets, setAssets, assetManagerOpen, setAssetManagerOpen } = useAssetStore();
  const [filterText, setFilterText] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [deletingAssetIds, setDeletingAssetIds] = useState<string[]>([]);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [editTagsValue, setEditTagsValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/assets/`);
      if (res.ok) {
        const data = await res.json();
        setAssets(data.assets || []);
      }
    } catch {
      // silently fail
    }
  }, [projectId, setAssets]);

  useEffect(() => {
    if (embedded || assetManagerOpen) {
      fetchAssets();
    }
  }, [embedded, assetManagerOpen, fetchAssets]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    const uploadFiles = Array.from(files);
    setPendingUploads(uploadFiles.length);
    for (const file of uploadFiles) {
      const formData = new FormData();
      formData.append('file', file);
      if (tagInput.trim()) {
        formData.append('tags', tagInput.trim());
      }
      try {
        await fetch(`${API_BASE}/api/projects/${projectId}/assets/upload`, {
          method: 'POST',
          body: formData,
        });
      } catch {
        // silently fail
      } finally {
        setPendingUploads((count) => Math.max(0, count - 1));
      }
    }
    setTagInput('');
    await fetchAssets();
    setUploading(false);
    setPendingUploads(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (assetId: string) => {
    if (deletingAssetIds.includes(assetId)) return;
    setDeletingAssetIds((ids) => [...ids, assetId]);
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/assets/${assetId}`, {
        method: 'DELETE',
      });
      await fetchAssets();
    } catch {
      // silently fail
    } finally {
      setDeletingAssetIds((ids) => ids.filter((id) => id !== assetId));
    }
  };

  const handleDownload = (asset: Asset) => {
    const url = `${API_BASE}/api/projects/${projectId}/assets/${asset.id}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.original_name;
    a.click();
  };

  const handleSaveTags = async (assetId: string) => {
    const tags = editTagsValue.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/assets/${assetId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tags),
      });
      await fetchAssets();
    } catch {
      // silently fail
    }
    setEditingTagsId(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // Collect all unique tags
  const allTags = Array.from(new Set(assets.flatMap((a) => a.tags))).sort();

  // Filter assets
  const filtered = assets.filter((a) => {
    const nameMatch = !filterText || a.original_name.toLowerCase().includes(filterText.toLowerCase());
    const tagMatch = !filterTag || a.tags.includes(filterTag);
    return nameMatch && tagMatch;
  });

  const getMimeIcon = (mime: string): string => {
    if (mime.startsWith('image/')) return '\ud83d\uddbc';
    if (mime.startsWith('audio/')) return '\ud83c\udfb5';
    if (mime.startsWith('video/')) return '\ud83c\udfac';
    if (mime === 'application/pdf') return '\ud83d\udcc4';
    if (mime.startsWith('text/')) return '\ud83d\udcdd';
    return '\ud83d\udcc1';
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const content = (
    <div className="asset-manager-content">
      {/* Upload section */}
      <div
        className={`asset-upload-zone ${dragOver ? 'drag-over' : ''} ${uploading ? 'is-uploading' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          disabled={uploading}
          onChange={(e) => handleUpload(e.target.files)}
        />
        <div className="asset-upload-icon">{uploading ? '\u23f3' : '\u2b06'}</div>
        <div className="asset-upload-text">
          {uploading
            ? `Uploading ${pendingUploads} file${pendingUploads === 1 ? '' : 's'}...`
            : 'Drop files here or click to upload'}
        </div>
      </div>

      <div className="asset-tag-input-row">
        <label>Tags for upload:</label>
        <input
          type="text"
          placeholder="tag1, tag2, ..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          className="asset-tag-input"
          disabled={uploading}
        />
      </div>

      {/* Filter bar */}
      <div className="asset-filter-bar">
        <input
          type="text"
          placeholder="Search by name..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="asset-filter-input"
        />
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="asset-filter-select"
        >
          <option value="">All Tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>

      {/* Asset list */}
      <div className="asset-list">
        {filtered.length === 0 ? (
          <div className="asset-list-empty">
            {assets.length === 0 ? 'No assets yet. Upload files to get started.' : 'No assets match your filters.'}
          </div>
        ) : (
          <table className="asset-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Size</th>
                <th>Tags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id} className="asset-row">
                  <td className="asset-cell-icon">
                    <span title={asset.mime_type}>{getMimeIcon(asset.mime_type)}</span>
                  </td>
                  <td
                    className="asset-cell-name"
                    onClick={() => setPreviewAsset(asset)}
                    title="Click to preview"
                  >
                    {asset.original_name}
                  </td>
                  <td className="asset-cell-size">{formatSize(asset.size_bytes)}</td>
                  <td className="asset-cell-tags">
                    {editingTagsId === asset.id ? (
                      <div className="asset-tags-edit">
                        <input
                          type="text"
                          value={editTagsValue}
                          onChange={(e) => setEditTagsValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveTags(asset.id);
                            if (e.key === 'Escape') setEditingTagsId(null);
                          }}
                          className="asset-tags-edit-input"
                          autoFocus
                        />
                        <button
                          className="asset-tags-save-btn"
                          onClick={() => handleSaveTags(asset.id)}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div
                        className="asset-tags-display"
                        onClick={() => {
                          setEditingTagsId(asset.id);
                          setEditTagsValue(asset.tags.join(', '));
                        }}
                        title="Click to edit tags"
                      >
                        {asset.tags.length > 0
                          ? asset.tags.map((t) => (
                              <span key={t} className="asset-tag-badge">#{t}</span>
                            ))
                          : <span className="asset-no-tags">no tags</span>
                        }
                      </div>
                    )}
                  </td>
                  <td className="asset-cell-actions">
                    {deletingAssetIds.includes(asset.id) ? (
                      <span className="asset-action-status">Deleting...</span>
                    ) : null}
                    <button
                      className="asset-action-btn"
                      onClick={() => handleDownload(asset)}
                      title="Download"
                      disabled={deletingAssetIds.includes(asset.id)}
                    >
                      &#x2B07;
                    </button>
                    <button
                      className="asset-action-btn asset-action-delete"
                      onClick={() => handleDelete(asset.id)}
                      title={deletingAssetIds.includes(asset.id) ? 'Deleting...' : 'Delete'}
                      disabled={deletingAssetIds.includes(asset.id)}
                    >
                      {deletingAssetIds.includes(asset.id) ? '\u23f3' : '\u2715'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview overlay */}
      {previewAsset && (
        <AssetViewer
          asset={previewAsset}
          projectId={projectId}
          onClose={() => setPreviewAsset(null)}
        />
      )}
    </div>
  );

  // If embedded (inside ProjectView), render without dialog overlay
  if (embedded) {
    return <div className="asset-manager embedded">{content}</div>;
  }

  // Otherwise render as dialog
  if (!assetManagerOpen) return null;

  return (
    <div className="dialog-overlay" onClick={() => setAssetManagerOpen(false)}>
      <div className="asset-manager dialog" onClick={(e) => e.stopPropagation()}>
        <div className="asset-manager-header">
          <span>Asset Manager</span>
          <button className="asset-manager-close" onClick={() => setAssetManagerOpen(false)}>
            &times;
          </button>
        </div>
        {content}
      </div>
    </div>
  );
};

export default AssetManager;
