/**
 * The Line Spacing control — named settings, a fine slider in eighths of a
 * line, a preview drawn at the real pitch, and the page count the script would
 * have with it. Shared by Format › Line Spacing and the Template Editor, so
 * both show the writer the same thing before they apply it.
 *
 * Every value is an eighth of a line (utils/lineSpacing explains why), which
 * is also all the slider can produce.
 */
import React, { useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import {
  LINE_SPACING_PRESETS, LINE_SPACING_STEP, STANDARD_LINE_SPACING, MAX_LINE_SPACING,
  normalizeLineSpacing, formatLineSpacing, presetFor,
} from '../utils/lineSpacing';
import { pageCountAtLineSpacing, activeTemplateHints } from '../editor/pagination';
import { useEditorStore } from '../stores/editorStore';
import { useFootnotePlan } from '../hooks/useFootnotePlan';
import '../styles/lineSpacing.css';

/** One line on the 96dpi page, at standard spacing. */
const LINE_PX = 16;

/** The preview: a scene heading, action and a speech, as bars of ink. */
const PREVIEW_BLOCKS: { indent: number; lines: number[]; space: number }[] = [
  { indent: 0, lines: [0.45], space: 0 },
  { indent: 0, lines: [1, 0.92, 0.6], space: 1 },
  { indent: 0.36, lines: [0.18], space: 1 },
  { indent: 0.17, lines: [0.58, 0.55, 0.3], space: 0 },
];

interface Props {
  value: number;
  onChange: (value: number) => void;
  /** With an editor, the page count at the chosen spacing is shown. */
  editor?: Editor | null;
  /** The spacing the script has now, to count "from" pages against. */
  currentValue?: number;
  disabled?: boolean;
  /** Leave the preview out, where the control shares a crowded panel. */
  compact?: boolean;
}

const LineSpacingControl: React.FC<Props> = ({ value, onChange, editor = null, currentValue, disabled = false, compact = false }) => {
  const { t, i18n } = useTranslation(['format', 'common']);
  const spacing = normalizeLineSpacing(value);
  const preset = presetFor(spacing);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const plan = useFootnotePlan(editor);

  // Counted with the same pagination the editor runs, once per value shown
  // (the slider has nine stops). The control lives in a modal dialog, so the
  // document cannot change under it; the layout and the notes are the inputs
  // that can.
  const countAt = useMemo(() => (v: number | null): number | null => {
    if (v === null || !editor || editor.isDestroyed) return null;
    try {
      return pageCountAtLineSpacing(editor.state.doc, pageLayout, activeTemplateHints(), v, plan);
    } catch (err) {
      // The count is a guide, never a reason the setting cannot be changed.
      console.warn('[LineSpacing] could not count the pages at this spacing', err);
      return null;
    }
  }, [editor, pageLayout, plan]);
  const fromValue = currentValue === undefined ? null : normalizeLineSpacing(currentValue);
  const from = useMemo(() => countAt(fromValue), [countAt, fromValue]);
  const to = useMemo(() => countAt(spacing), [countAt, spacing]);

  const preview = useMemo(() => {
    const out: { top: number; indent: number; width: number }[] = [];
    let y = 0;
    for (const block of PREVIEW_BLOCKS) {
      y += block.space * LINE_PX;
      for (const width of block.lines) {
        out.push({ top: y, indent: block.indent, width });
        y += LINE_PX * spacing;
      }
    }
    return { bars: out, height: y };
  }, [spacing]);

  const label = t('lineSpacing.value', formatLineSpacing(spacing, i18n.language));

  return (
    <div className="line-spacing-control">
      <div className="line-spacing-presets" role="radiogroup" aria-label={t('lineSpacing.title')}>
        {LINE_SPACING_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            className={`line-spacing-preset${preset === p.id ? ' active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(p.value)}
          >
            {t(`lineSpacing.preset.${p.id}`)}
          </button>
        ))}
      </div>

      <label className="line-spacing-fine">
        <span className="line-spacing-fine-label">{t('lineSpacing.fine')}</span>
        <input
          type="range"
          min={STANDARD_LINE_SPACING}
          max={MAX_LINE_SPACING}
          step={LINE_SPACING_STEP}
          value={spacing}
          disabled={disabled}
          aria-valuetext={label}
          onChange={(e) => onChange(normalizeLineSpacing(Number(e.target.value)))}
        />
        <output className="line-spacing-value">
          {label}
        </output>
      </label>

      {!compact && <div className="line-spacing-preview" aria-hidden="true" style={{ height: preview.height + LINE_PX }}>
        {preview.bars.map((bar, i) => (
          <span
            key={i}
            className="line-spacing-preview-line"
            style={{
              top: bar.top + (LINE_PX * spacing - 8) / 2,
              insetInlineStart: `${12 + bar.indent * 100}%`,
              width: `${bar.width * 70}%`,
            }}
          />
        ))}
      </div>}

      {to !== null && (
        <p className="line-spacing-pages" aria-live="polite">
          {from !== null && from !== to
            ? t('lineSpacing.pagesChange', { from, to })
            : t('lineSpacing.pages', { pages: to })}
        </p>
      )}
    </div>
  );
};

export default LineSpacingControl;
