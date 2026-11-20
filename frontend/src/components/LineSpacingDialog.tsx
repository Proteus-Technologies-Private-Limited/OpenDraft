/**
 * Format › Line Spacing — opens the page up (or closes it back to Standard)
 * for this script.
 *
 * The setting lives on the script's format (`lineSpacing` on its template), so
 * it travels with the script to another device or a collaborator, like every
 * other part of a custom format. A built-in format becomes this document's own
 * copy, exactly as Edit Document Format does; the writer's template library is
 * never touched.
 */
import React, { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { ModalOverlay } from './ModalOverlay';
import LineSpacingControl from './LineSpacingControl';
import { showToast } from './Toast';
import { useFormattingTemplateStore, applyDocumentTemplate } from '../stores/formattingTemplateStore';
import { normalizeLineSpacing, withLineSpacing, STANDARD_LINE_SPACING } from '../utils/lineSpacing';

interface Props {
  editor: Editor | null;
  onClose: () => void;
}

const LineSpacingDialog: React.FC<Props> = ({ editor, onClose }) => {
  const { t } = useTranslation(['format', 'common']);
  const template = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const current = normalizeLineSpacing(template.lineSpacing);
  const [value, setValue] = useState(current);

  const handleApply = () => {
    if (value === current) { onClose(); return; }
    try {
      if (!applyDocumentTemplate(withLineSpacing(template, value))) {
        showToast(t('lineSpacing.failed'), 'error');
        return;
      }
    } catch (err) {
      console.error('[LineSpacing] could not apply the line spacing', err);
      showToast(t('lineSpacing.failed'), 'error');
      return;
    }
    onClose();
  };

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div
        className="tp-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-spacing-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, width: '100%' }}
      >
        <div className="dialog-header" id="line-spacing-title">{t('lineSpacing.title')}</div>
        <div className="tp-editor-body" style={{ display: 'block', padding: 20 }}>
          <p className="line-spacing-help" style={{ marginBottom: 14 }}>{t('lineSpacing.help')}</p>
          <LineSpacingControl value={value} onChange={setValue} editor={editor} currentValue={current} />
          <p className="line-spacing-help" style={{ marginTop: 14 }}>{t('lineSpacing.scope')}</p>
        </div>
        <div className="dialog-actions">
          <button onClick={() => setValue(STANDARD_LINE_SPACING)} style={{ marginInlineEnd: 'auto' }} disabled={value === STANDARD_LINE_SPACING}>
            {t('lineSpacing.reset')}
          </button>
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={handleApply}>{t('common:apply')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default LineSpacingDialog;
