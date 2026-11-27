import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { useImageSrc } from '../hooks/useImageSrc';
import type { PageLayout } from '../stores/editorStore';
import { buildImageAttrs, warnIfImageDegraded } from '../utils/insertImage';
import { customTitleBlockLines, titlePageAlignment, titlePageTextSize, TITLE_PAGE_ALIGNMENTS } from '../utils/customTitlePage';
import { padCustomTitlePage } from '../utils/titlePageDialogBlocks';
import Select from './Select';
import { showToast } from './Toast';

const FIELD_LABELS = {
  blank: 'titlePage.customText',
  title: 'titlePage.titleField',
  credit: 'titlePage.credit',
  author: 'titlePage.writtenBy',
  basedOn: 'titlePage.basedOn',
  draft: 'titlePage.draft',
  draftDate: 'titlePage.draftDate',
  contact: 'titlePage.contact',
  copyright: 'titlePage.copyright',
  wga: 'titlePage.wga',
  date: 'titlePage.notes',
} as const;
const ALIGNMENT_LABELS = {
  left: 'titlePage.alignLeft',
  center: 'titlePage.alignCenter',
  right: 'titlePage.alignRight',
} as const;

function isSpacer(node: PMNode) {
  return node.type.name === 'titlePage' && node.attrs.field === 'blank' && !node.textContent;
}

function CustomTitleImage({ node }: { node: PMNode }) {
  const { url } = useImageSrc(node.attrs);
  const width = Number(node.attrs.width);
  return url ? <img src={url} alt="" style={{ width: width > 0 ? `calc(var(--tp-point) * ${width * 0.75})` : '60%' }} /> : null;
}

interface Props {
  schema: Schema;
  nodes: PMNode[];
  onChange: (nodes: PMNode[]) => void;
  layout: PageLayout;
  linesPerPage: number;
  contentWidth: number;
  onUploadChange: (uploading: boolean) => void;
}

export default function CustomTitlePageEditor({ schema, nodes, onChange, layout, linesPerPage, contentWidth, onUploadChange }: Props) {
  const { t } = useTranslation(['format', 'common']);
  const [selected, setSelected] = useState(() => Math.max(0, nodes.findIndex(node => !isSpacer(node))));
  const [uploading, setUploading] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [sheetWidth, setSheetWidth] = useState(400);
  const selectedInput = useRef<HTMLTextAreaElement>(null);
  const focusText = useRef(false);

  // Trailing space is editable on the paper and never needs to be persisted.
  const rows = padCustomTitlePage(nodes, schema, linesPerPage, contentWidth);
  const item = rows[selected];
  const isImage = item?.type.name === 'screenplayImage';
  const field = String(item?.attrs.field ?? 'blank');
  let nextLine = 1;
  const lineNumbers = rows.map(node => {
    const line = Math.ceil(nextLine);
    nextLine += customTitleBlockLines(node, contentWidth);
    return line;
  });

  useLayoutEffect(() => {
    if (!focusText.current || !selectedInput.current) return;
    focusText.current = false;
    selectedInput.current.focus();
  });

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element) return;
    setSheetWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setSheetWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function updateRows(updated: PMNode[], selection: number) {
    // Keep configured empty fields and the selected line, and regenerate the
    // remaining blank part of the sheet at its current size.
    while (updated.length > selection + 1 && isSpacer(updated[updated.length - 1])) updated.pop();
    onChange(updated);
    setSelected(selection);
  }

  function updateItem(attrs: Record<string, unknown>) {
    if (!item) return;
    const updated = [...rows];
    updated[selected] = item.type.create({ ...item.attrs, ...attrs }, item.content, item.marks);
    updateRows(updated, selected);
  }

  function updateText(index: number, text: string) {
    const updated = [...rows];
    const node = updated[index];
    const marks = node.firstChild?.marks;
    updated[index] = node.type.create(node.attrs, text ? schema.text(text, marks) : null);
    updateRows(updated, index);
  }

  function addText() {
    const target = item && !isSpacer(item) ? selected + 1 : selected;
    const updated = [...rows];
    if (!updated[target] || !isSpacer(updated[target])) {
      updated.splice(target, 0, schema.nodes.titlePage.create({ field: 'blank', tpCustom: true }));
    }
    focusText.current = true;
    updateRows(updated, target);
  }

  async function addImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast(t('titlePage.chooseImage'), 'error');
      return;
    }
    setUploading(true);
    onUploadChange(true);
    try {
      const attrs = await buildImageAttrs(file, ['title-page-image']);
      warnIfImageDegraded(attrs);
      const updated = [...rows];
      const target = !item || isSpacer(item) ? selected : selected + 1;
      updated.splice(target, 0, schema.nodes.screenplayImage.create({ ...attrs, tpCustom: true }));
      updateRows(updated, target);
    } catch (err) {
      showToast(t('titlePage.imageFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setUploading(false);
      onUploadChange(false);
    }
  }

  function moveItem(target: number) {
    if (!item || target === selected) return;
    const updated = [...rows];
    if (isSpacer(rows[target]) && customTitleBlockLines(item, contentWidth) === 1) {
      updated[selected] = updated[target];
      updated[target] = item;
    } else {
      updated.splice(selected, 1);
      updated.splice(target, 0, item);
    }
    updateRows(updated, target);
  }

  const paperStyle = {
    '--tp-point': `${sheetWidth / (layout.pageWidth * 72)}px`,
    '--tp-sheet-height': `calc(var(--tp-point) * ${layout.pageHeight * 72})`,
    padding: `calc(var(--tp-point) * ${layout.topMargin}) ${layout.rightMargin / layout.pageWidth * 100}% calc(var(--tp-point) * ${layout.bottomMargin}) ${layout.leftMargin / layout.pageWidth * 100}%`,
  } as CSSProperties;

  return (
    <div className="tp-custom-editor">
      <fieldset className="tp-custom-controls" disabled={uploading}>
        <div className="tp-custom-buttons">
          <button className="dialog-btn" type="button" onClick={addText}>{t('titlePage.addText')}</button>
          <button className="dialog-btn" type="button" onClick={() => imageInput.current?.click()}>{t('titlePage.addImage')}</button>
          <input ref={imageInput} type="file" accept="image/*" hidden onChange={event => {
            void addImage(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }} />
        </div>
        {!isImage && (
          <label className="props-label">
            {t('titlePage.customField')}
            <Select className="props-input" aria-label={t('titlePage.customField')} value={field}
              onChange={event => updateItem({ field: event.target.value })}>
              {Object.entries(FIELD_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </Select>
          </label>
        )}
        <label className="props-label">
          {t('titlePage.customAlignment')}
          <Select className="props-input" aria-label={t('titlePage.customAlignment')}
            value={isImage ? item.attrs.align || 'center' : titlePageAlignment(field, item?.attrs.tpAlign)}
            onChange={event => updateItem({ [isImage ? 'align' : 'tpAlign']: event.target.value })}>
            {TITLE_PAGE_ALIGNMENTS.map(value => <option key={value} value={value}>{t(ALIGNMENT_LABELS[value])}</option>)}
          </Select>
        </label>
        <label className="props-label">
          {t('titlePage.moveToLine')}
          <Select className="props-input" aria-label={t('titlePage.moveToLine')} value={selected}
            disabled={!item || isSpacer(item)} onChange={event => moveItem(Number(event.target.value))}>
            {lineNumbers.map((line, index) => <option key={index} value={index}>{line}</option>)}
          </Select>
        </label>
        <button className="dialog-btn" type="button" disabled={!item || isSpacer(item)} onClick={() => {
          const updated = [...rows];
          updated.splice(selected, 1);
          updateRows(updated, Math.max(0, Math.min(selected, updated.length - 1)));
        }}>{t('common:remove')}</button>
        <p className="tp-output-help">{t('titlePage.customExportHelp')}</p>
      </fieldset>
      <div className="tp-custom-sheet" ref={sheet}>
        <div className="tp-custom-paper" style={paperStyle}>
          {rows.map((node, index) => {
            const active = index === selected;
            const height = `calc(var(--tp-point) * ${12 * customTitleBlockLines(node, contentWidth)})`;
            const label = t('titlePage.editLine', { line: lineNumbers[index] });
            if (node.type.name === 'screenplayImage') return (
              <button key={index} type="button" className="tp-custom-row tp-custom-image"
                data-active={active} style={{ height, justifyContent: { left: 'start', center: 'center', right: 'end' }[node.attrs.align as 'left' | 'center' | 'right'] ?? 'center' }}
                aria-label={label} disabled={uploading} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}>
                <CustomTitleImage node={node} />
              </button>
            );
            if (isSpacer(node) && !active) return (
              <button key={index} type="button" className="tp-custom-row" tabIndex={-1}
                style={{ height }} aria-label={label} disabled={uploading} onClick={() => {
                  focusText.current = true;
                  setSelected(index);
                }} />
            );
            const isTitle = node.attrs.field === 'title';
            return (
              <textarea key={index} ref={active ? selectedInput : undefined} className="tp-custom-row"
                data-active={active} data-title={isTitle} aria-label={label} disabled={uploading}
                rows={1} spellCheck={false}
                style={{
                  height,
                  fontSize: `calc(var(--tp-point) * ${titlePageTextSize(node.attrs.field, node.attrs.tpTitleFontSize)})`,
                  textAlign: titlePageAlignment(node.attrs.field, node.attrs.tpAlign),
                }}
                value={node.textContent} onFocus={() => setSelected(index)} onChange={event => updateText(index, event.target.value)} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
