import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, DEFAULT_PAGE_LAYOUT, resolveHeaderFooter } from '../stores/editorStore';
import type { PageLayout } from '../stores/editorStore';
import Select from './Select';
import { pointsToInches, inchesToPoints } from '../utils/layoutUnits';

interface PageSetupDialogProps {
  onClose: () => void;
}

// i18n-ignore-start: standard paper-size names and their dimensions are the same in every language
const PAGE_SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: 'US Letter (8.5" x 11")', width: 8.5, height: 11 },
  { label: 'A4 (8.27" x 11.69")', width: 8.27, height: 11.69 },
  { label: 'US Legal (8.5" x 14")', width: 8.5, height: 14 },
];
// i18n-ignore-end

function ptToIn(pt: number): number {
  return +(pointsToInches(pt)).toFixed(3);
}

function inToPt(inches: number): number {
  return Math.round(inchesToPoints(inches));
}

/**
 * Landscape margins.
 *
 * A landscape page is 3.5" wider and 2.5" shorter than portrait, and carrying
 * the screenplay's 1.5" left margin across means a line of AV copy runs most of
 * a foot before it wraps. Issue #118 asks for "appropriate landscape margins";
 * these are even, narrower side margins that keep the columns readable and
 * leave the extra width to the content, which is the point of turning the page.
 */
const LANDSCAPE_MARGINS = { leftMargin: 1, rightMargin: 1, topMargin: 54, bottomMargin: 54 };

/**
 * The portrait side of that comparison, taken FROM the store rather than
 * restated here.
 *
 * Written out by hand it said `rightMargin: 1`, while every new screenplay is
 * created with DEFAULT_PAGE_LAYOUT. So the "has the writer touched their
 * margins?" test below failed for the one document that most obviously has not
 * — an untouched one — and rotating it to landscape kept the portrait margins.
 */
const PORTRAIT_MARGINS = {
  leftMargin: DEFAULT_PAGE_LAYOUT.leftMargin,
  rightMargin: DEFAULT_PAGE_LAYOUT.rightMargin,
  topMargin: DEFAULT_PAGE_LAYOUT.topMargin,
  bottomMargin: DEFAULT_PAGE_LAYOUT.bottomMargin,
};

const PageSetupDialog: React.FC<PageSetupDialogProps> = ({ onClose }) => {
  const { t } = useTranslation(['format', 'common']);
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
  // Matched in either orientation: A4 turned on its side is still A4, and the
  // dropdown falling to "Custom" the moment you rotate would be wrong.
  const currentSizeLabel = PAGE_SIZES.find(
    (s) =>
      (Math.abs(s.width - layout.pageWidth) < 0.05 && Math.abs(s.height - layout.pageHeight) < 0.05) ||
      (Math.abs(s.height - layout.pageWidth) < 0.05 && Math.abs(s.width - layout.pageHeight) < 0.05),
  )?.label || 'Custom';

  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const size = PAGE_SIZES.find((s) => s.label === e.target.value);
      if (size) {
        setLayout((prev) => {
          // Keep the orientation the document is already in; picking "A4" while
          // in landscape should give landscape A4, not flip the page back.
          const landscape = prev.pageWidth > prev.pageHeight;
          return {
            ...prev,
            pageWidth: landscape ? size.height : size.width,
            pageHeight: landscape ? size.width : size.height,
          };
        });
      }
    },
    [],
  );

  /** Portrait when the page is taller than it is wide — derived, not stored, so
   *  a custom width/height a user types still reads correctly. */
  const isLandscape = layout.pageWidth > layout.pageHeight;

  /**
   * Switch orientation by swapping the page dimensions.
   *
   * Margins move with it, but only when they are still the defaults for the
   * orientation being left — a writer who has set their own margins keeps them.
   */
  const handleOrientation = useCallback((wantLandscape: boolean) => {
    setLayout((prev) => {
      const currentlyLandscape = prev.pageWidth > prev.pageHeight;
      if (currentlyLandscape === wantLandscape) return prev;
      const from = currentlyLandscape ? LANDSCAPE_MARGINS : PORTRAIT_MARGINS;
      const to = wantLandscape ? LANDSCAPE_MARGINS : PORTRAIT_MARGINS;
      const untouched =
        Math.abs(prev.leftMargin - from.leftMargin) < 0.01 &&
        Math.abs(prev.rightMargin - from.rightMargin) < 0.01 &&
        Math.abs(prev.topMargin - from.topMargin) < 1 &&
        Math.abs(prev.bottomMargin - from.bottomMargin) < 1;
      return {
        ...prev,
        pageWidth: prev.pageHeight,
        pageHeight: prev.pageWidth,
        ...(untouched ? to : {}),
      };
    });
  }, []);

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
        <div className="dialog-header">{t('pageSetup.title')}</div>
        <div className="dialog-body">
          {/* Page Size */}
          <div className="page-setup-section">
            <div className="page-setup-section-title">{t('pageSetup.pageSize')}</div>
            <div className="page-setup-row">
              <label>{t('pageSetup.size')}</label>
              <Select
                value={currentSizeLabel}
                onChange={handlePageSizeChange}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label}
                  </option>
                ))}
                {currentSizeLabel === 'Custom' && (
                  <option value="Custom">{t('common:custom')}</option>
                )}
              </Select>
            </div>
            <div className="page-setup-row">
              <label>{t('pageSetup.orientation')}</label>
              <div className="page-setup-orientation">
                <label className="page-setup-orientation-option">
                  <input
                    type="radio"
                    name="page-orientation"
                    checked={!isLandscape}
                    onChange={() => handleOrientation(false)}
                  />
                  {t('pageSetup.portrait')}
                </label>
                <label className="page-setup-orientation-option">
                  <input
                    type="radio"
                    name="page-orientation"
                    checked={isLandscape}
                    onChange={() => handleOrientation(true)}
                  />
                  {t('pageSetup.landscape')}
                </label>
              </div>
            </div>
            <div className="page-setup-row-pair">
              <div className="page-setup-row">
                <label>{t('pageSetup.width')}</label>
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
                <label>{t('pageSetup.height')}</label>
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
            <div className="page-setup-section-title">{t('pageSetup.margins')}</div>
            <div className="page-setup-row-pair">
              <div className="page-setup-row">
                <label>{t('pageSetup.top')}</label>
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
                <label>{t('pageSetup.bottom')}</label>
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
                <label>{t('pageSetup.left')}</label>
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
                <label>{t('pageSetup.right')}</label>
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
            <div className="page-setup-section-title">{t('pageSetup.headerFooter')}</div>
            <div className="page-setup-hf-hint" style={{ marginBottom: 8 }}>
              {t('pageSetup.headerFooterHint')}
            </div>
            <button type="button" className="dialog-btn page-setup-link" onClick={handleOpenHeaderFooter}>
              {t('pageSetup.headerFooterSettings')}
            </button>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="page-setup-reset" onClick={handleReset}>
            {t('pageSetup.resetDefault')}
          </button>
          <div className="page-setup-spacer" />
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={handleApply}>
            {t('common:apply')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PageSetupDialog;
