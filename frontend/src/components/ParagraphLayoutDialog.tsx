import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { getCurrentElementRule } from '../utils/effectiveFormatting';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import {
  paragraphLayoutOf,
  PARAGRAPH_LAYOUT_KEYS,
  type ParagraphLayout,
} from '../editor/paragraphLayout';
const labels = {
  leftIndentPt: 'Left indent (pt)',
  rightIndentPt: 'Right indent (pt)',
  spaceBeforePt: 'Space before (pt)',
  spaceAfterPt: 'Space after (pt)',
  lineSpacing: 'Line spacing multiplier',
};
export default function ParagraphLayoutDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const node = editor.state.selection.$from.parent;
  const [values, setValues] = useState(paragraphLayoutOf(node));
  const [error, setError] = useState('');
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="element-number-dialog paragraph-layout-dialog"
      aria-labelledby="paragraph-layout-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const layout = useEditorStore.getState().pageLayout;
          const rule = getCurrentElementRule(
            editor,
            useFormattingTemplateStore.getState().getActiveTemplate(),
          );
          const left =
            values.leftIndentPt == null
              ? (rule?.leftIndent ?? layout.leftMargin) * 72
              : layout.leftMargin * 72 + values.leftIndentPt;
          const right =
            values.rightIndentPt == null
              ? (rule?.rightIndent ?? layout.pageWidth - layout.rightMargin) * 72
              : (layout.pageWidth - layout.rightMargin) * 72 - values.rightIndentPt;
          if (right - left < 12) {
            setError('The indents must leave at least 12 points of text width.');
            return;
          }
          if (editor.isEditable && editor.commands.setParagraphLayout(values)) onClose();
          else setError('Choose a screenplay paragraph and try again.');
        }}
      >
        <h2 id="paragraph-layout-title">Paragraph Layout</h2>
        <p>
          Blank fields inherit the format. Indents are measured inward from the document’s text
          margins.
        </p>
        {PARAGRAPH_LAYOUT_KEYS.map((key) => (
          <label key={key}>
            {labels[key]}
            <input
              type="number"
              min={key === 'lineSpacing' ? 0.5 : 0}
              max={key === 'lineSpacing' ? 3 : 360}
              step={key === 'lineSpacing' ? 0.1 : 1}
              value={values[key] ?? ''}
              onChange={(e) =>
                setValues({
                  ...values,
                  [key]: e.target.value === '' ? null : Number(e.target.value),
                } as ParagraphLayout)
              }
            />
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={() => setValues({})}>
            Reset to Format
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Apply</button>
        </div>
      </form>
    </dialog>
  );
}
