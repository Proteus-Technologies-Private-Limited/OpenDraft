import React, { useState, useCallback } from 'react';
import { useEditorStore, DEFAULT_PAGE_LAYOUT, resolveHeaderFooter } from '../stores/editorStore';
import type { PageLayout } from '../stores/editorStore';

interface PageSetupDialogProps {
  onClose: () => void;
}

const PAGE_SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: 'US Letter (8.5" x 11")', width: 8.5, height: 11 },
  { label: 'A4 (8.27" x 11.69")', width: 8.27, height: 11.69 },
  { label: 'US Legal (8.5" x 14")', width: 8.5, height: 14 },
];

function ptToIn(pt: number): number {
  return +(pt / 72).toFixed(3);
}

function inToPt(inches: number): number {
  return Math.round(inches * 72);
}

const PageSetupDialog: React.FC<PageSetupDialogProps> = ({ onClose }) => {
  const { pageLayout, setPageLayout, setHeaderFooterOpen } = useEditorStore();

  // Backwards-compatible: fill in fields missing from layouts saved by older versions
  const [layout, setLayout] = useState<PageLayout>(() => ({
    ...pageLayout,
    ...resolveHeaderFooter(pageLayout),
  }));

  const setField = useCallback(
    <K extends keyof PageLayout>(key: K, value: PageLayout[K]) => {
      setLayout((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Detect current page size label
  const currentSizeLabel = PAGE_SIZES.find(
    (s) =>
      Math.abs(s.width - layout.pageWidth) < 0.05 &&
      Math.abs(s.height - layout.pageHeight) < 0.05,
  )?.label || 'Custom';

  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const size = PAGE_SIZES.find((s) => s.label === e.target.value);
      if (size) {
        setLayout((prev) => ({
          ...prev,
          pageWidth: size.width,
          pageHeight: size.height,
        }));
      }
    },
    [],
  );

  const handleApply = useCallback(() => {
    setPageLayout(layout);
    onClose();
  }, [layout, setPageLayout, onClose]);

  const handleReset = useCallback(() => {
    setLayout({ ...DEFAULT_PAGE_LAYOUT });
  }, []);

  /** Hand off to the Header & Footer dialog, keeping whatever was typed here —
   *  losing half-finished margin edits on the way out would be its own bug. */
  const handleOpenHeaderFooter = useCallback(() => {
    setPageLayout(layout);
    onClose();
    setHeaderFooterOpen(true);
  }, [layout, setPageLayout, onClose, setHeaderFooterOpen]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box page-setup-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">Page Setup</div>
        <div className="dialog-body">
          {/* Page Size */}
          <div className="page-setup-section">
            <div className="page-setup-section-title">Page Size</div>
            <div className="page-setup-row">
              <label>Size</label>
              <select
                value={currentSizeLabel}
                onChange={handlePageSizeChange}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
                {currentSizeLabel === 'Custom' && (
                  <option value="Custom">Custom</option>
                )}
              </select>
            </div>
            <div className="page-setup-row-pair">
              <div className="page-setup-row">
                <label>Width (in)</label>
                <input
                  type="number"
                  step="0.01"
                  min="4"
                  max="20"
                  value={layout.pageWidth}
                  onChange={(e) =>
                    setField('pageWidth', parseFloat(e.target.value) || 8.5)
                  }
                />
              </div>
              <div className="page-setup-row">
                <label>Height (in)</label>
                <input
                  type="number"
                  step="0.01"
                  min="4"
                  max="30"
                  value={layout.pageHeight}
                  onChange={(e) =>
                    setField('pageHeight', parseFloat(e.target.value) || 11)
                  }
                />
              </div>
            </div>
          </div>

          {/* Margins */}
          <div className="page-setup-section">
            <div className="page-setup-section-title">Margins</div>
            <div className="page-setup-row-pair">
              <div className="page-setup-row">
                <label>Top (in)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="4"
                  value={ptToIn(layout.topMargin)}
                  onChange={(e) =>
                    setField(
                      'topMargin',
                      inToPt(parseFloat(e.target.value) || 0),
                    )
                  }
                />
              </div>
              <div className="page-setup-row">
                <label>Bottom (in)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="4"
                  value={ptToIn(layout.bottomMargin)}
                  onChange={(e) =>
                    setField(
                      'bottomMargin',
                      inToPt(parseFloat(e.target.value) || 0),
                    )
                  }
                />
              </div>
            </div>
            <div className="page-setup-row-pair">
              <div className="page-setup-row">
                <label>Left (in)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="4"
                  value={layout.leftMargin}
                  onChange={(e) =>
                    setField(
                      'leftMargin',
                      parseFloat(e.target.value) || 0,
                    )
                  }
                />
              </div>
              <div className="page-setup-row">
                <label>Right (in)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="4"
                  value={layout.rightMargin}
                  onChange={(e) =>
                    setField(
                      'rightMargin',
                      parseFloat(e.target.value) || 0,
                    )
                  }
                />
              </div>
            </div>
          </div>

          {/* Header and footer content lives in its own dialog (Format → Header &
              Footer), where it has room for field buttons and a preview. This is
              the signpost for anyone who still looks for it here. */}
          <div className="page-setup-section">
            <div className="page-setup-section-title">Header &amp; Footer</div>
            <div className="page-setup-hf-hint" style={{ marginBottom: 8 }}>
              Page numbers, header and footer text, and where numbering starts.
            </div>
            <button type="button" className="dialog-btn page-setup-link" onClick={handleOpenHeaderFooter}>
              Header &amp; Footer Settings…
            </button>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="page-setup-reset" onClick={handleReset}>
            Reset Default
          </button>
          <div className="page-setup-spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default PageSetupDialog;
