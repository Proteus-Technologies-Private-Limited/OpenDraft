import React, { useState, useCallback } from 'react';
import { useEditorStore, DEFAULT_PAGE_LAYOUT, DEFAULT_HEADER_CONTENT, DEFAULT_FOOTER_CONTENT } from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';

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
  const { pageLayout, setPageLayout } = useEditorStore();

  // Backwards-compatible: fill in missing headerContent/footerContent for old layouts
  const [layout, setLayout] = useState<PageLayout>({
    ...pageLayout,
    headerContent: pageLayout.headerContent || { ...DEFAULT_HEADER_CONTENT },
    footerContent: pageLayout.footerContent || { ...DEFAULT_FOOTER_CONTENT },
    headerStartPage: pageLayout.headerStartPage ?? 2,
    footerStartPage: pageLayout.footerStartPage ?? 1,
  });

  const setField = useCallback(
    <K extends keyof PageLayout>(key: K, value: PageLayout[K]) => {
      setLayout((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const setHeaderField = useCallback(
    (pos: keyof HeaderFooterContent, value: string) => {
      setLayout((prev) => ({
        ...prev,
        headerContent: { ...prev.headerContent, [pos]: value },
      }));
    },
    [],
  );

  const setFooterField = useCallback(
    (pos: keyof HeaderFooterContent, value: string) => {
      setLayout((prev) => ({
        ...prev,
        footerContent: { ...prev.footerContent, [pos]: value },
      }));
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

          {/* Header / Footer */}
          <div className="page-setup-section">
            <div className="page-setup-section-title">Header &amp; Footer</div>
            <div className="page-setup-row-pair">
              <div className="page-setup-row">
                <label>Header margin (in)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="2"
                  value={ptToIn(layout.headerMargin)}
                  onChange={(e) =>
                    setField(
                      'headerMargin',
                      inToPt(parseFloat(e.target.value) || 0),
                    )
                  }
                />
              </div>
              <div className="page-setup-row">
                <label>Footer margin (in)</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="2"
                  value={ptToIn(layout.footerMargin)}
                  onChange={(e) =>
                    setField(
                      'footerMargin',
                      inToPt(parseFloat(e.target.value) || 0),
                    )
                  }
                />
              </div>
            </div>

            <div className="page-setup-hf-label">Header Content</div>
            <div className="page-setup-hf-hint">
              Fields: {'{page}'} {'{pages}'} {'{title}'} {'{date}'} {'{revision}'}
            </div>
            <div className="page-setup-hf-row">
              <input
                placeholder="Left"
                value={layout.headerContent.left}
                onChange={(e) => setHeaderField('left', e.target.value)}
              />
              <input
                placeholder="Center"
                value={layout.headerContent.center}
                onChange={(e) => setHeaderField('center', e.target.value)}
              />
              <input
                placeholder="Right"
                value={layout.headerContent.right}
                onChange={(e) => setHeaderField('right', e.target.value)}
              />
            </div>
            <div className="page-setup-row">
              <label>Start on page</label>
              <input
                type="number"
                step="1"
                min="1"
                max="999"
                value={layout.headerStartPage}
                onChange={(e) =>
                  setField('headerStartPage', parseInt(e.target.value, 10) || 1)
                }
                style={{ width: 60 }}
              />
            </div>

            <div className="page-setup-hf-label" style={{ marginTop: 12 }}>Footer Content</div>
            <div className="page-setup-hf-row">
              <input
                placeholder="Left"
                value={layout.footerContent.left}
                onChange={(e) => setFooterField('left', e.target.value)}
              />
              <input
                placeholder="Center"
                value={layout.footerContent.center}
                onChange={(e) => setFooterField('center', e.target.value)}
              />
              <input
                placeholder="Right"
                value={layout.footerContent.right}
                onChange={(e) => setFooterField('right', e.target.value)}
              />
            </div>
            <div className="page-setup-row">
              <label>Start on page</label>
              <input
                type="number"
                step="1"
                min="1"
                max="999"
                value={layout.footerStartPage}
                onChange={(e) =>
                  setField('footerStartPage', parseInt(e.target.value, 10) || 1)
                }
                style={{ width: 60 }}
              />
            </div>
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
