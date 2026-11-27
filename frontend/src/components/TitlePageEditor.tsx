import React, { useState, useCallback, useRef } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { TitlePageAttrs } from '../editor/extensions/TitlePage';
import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { buildImageAttrs, warnIfImageDegraded } from '../utils/insertImage';
import { useImageSrc } from '../hooks/useImageSrc';
import { getPageMetrics } from '../editor/pagination';
import { findTitlePageRegion, titlePageAttrsCarryData, titlePageNodeInfo } from '../utils/titlePageRegion';
import { DEFAULT_TITLE_PAGE_CREDIT } from '../utils/titlePageBlocks';
import { buildTitlePageBlocks, customizeTitlePageBlocks, deriveFields, trimCustomTitlePage } from '../utils/titlePageDialogBlocks';
import { customTitleBlockLines, readCustomTitleFields } from '../utils/customTitlePage';
import CustomTitlePageEditor from './CustomTitlePageEditor';
import { showToast } from './Toast';
import Select from './Select';
import { confirmAction } from '../utils/confirmAction';

/** Small image thumbnail for the title-page preview/list. Shares the editor
 *  NodeView's resolver, so scratch-backed images work here too. */
const TpImageThumb: React.FC<{ attrs: Record<string, unknown>; align?: boolean }> = ({ attrs, align }) => {
  const { url } = useImageSrc(attrs);
  if (!url) return null;
  const a = align ? ((attrs.align as string) || 'center') : 'center';
  const margin = a === 'left' ? '3px auto 3px 0' : a === 'right' ? '3px 0 3px auto' : '3px auto';
  return <img src={url} alt="" style={{ maxWidth: '70%', maxHeight: 70, display: 'block', margin }} />;
};

interface Props {
  editor: Editor;
  onClose: () => void;
}

const EMPTY_ATTRS: Omit<TitlePageAttrs, 'field'> = {
  tpTitle: '',
  tpCredit: '',
  tpWrittenBy: '',
  tpBasedOn: '',
  tpDraft: '',
  tpDraftDate: '',
  tpContact: '',
  tpCopyright: '',
  tpWgaRegistration: '',
  tpNotes: '',
  tpTitleFontSize: 12,
};

// Title font-size choices (pt). Matches the editor's font-size dropdowns.
const TITLE_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

/** Find the first titlePage node with field='title' and return its attributes + position. */
function findTitlePageNode(editor: Editor): { pos: number; attrs: TitlePageAttrs } | null {
  let found: { pos: number; attrs: TitlePageAttrs } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'titlePage' && node.attrs.field === 'title') {
      found = { pos, attrs: node.attrs as TitlePageAttrs };
      return false;
    }
    return true;
  });
  return found;
}

/** Read structured attrs, falling back to legacy child-text content if structured attrs are empty. */
function readTitlePageData(editor: Editor, nodes: PMNode[]): Omit<TitlePageAttrs, 'field'> {
  const result = { ...EMPTY_ATTRS };
  const custom = readCustomTitleFields(nodes.map(node => node.toJSON()));
  if (custom) return { ...result, ...custom };
  const titleNode = findTitlePageNode(editor);
  if (titleNode && titlePageAttrsCarryData(titleNode.attrs as unknown as Record<string, unknown>)) {
    // Structured data exists — use it
    result.tpTitle = titleNode.attrs.tpTitle || '';
    result.tpTitleFontSize = Number(titleNode.attrs.tpTitleFontSize) || 12;
    result.tpCredit = titleNode.attrs.tpCredit || '';
    result.tpWrittenBy = titleNode.attrs.tpWrittenBy || '';
    result.tpBasedOn = titleNode.attrs.tpBasedOn || '';
    result.tpDraft = titleNode.attrs.tpDraft || '';
    result.tpDraftDate = titleNode.attrs.tpDraftDate || '';
    result.tpContact = titleNode.attrs.tpContact || '';
    result.tpCopyright = titleNode.attrs.tpCopyright || '';
    result.tpWgaRegistration = titleNode.attrs.tpWgaRegistration || '';
    result.tpNotes = titleNode.attrs.tpNotes || '';
    return result;
  }

  // Fallback: read from legacy child-text titlePage nodes
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'titlePage') {
      const field = node.attrs.field as string;
      const text = node.textContent || '';
      switch (field) {
        case 'title': result.tpTitle = text; break;
        case 'author': result.tpWrittenBy = text; break;
        case 'contact': result.tpContact = text; break;
        case 'date': result.tpDraftDate = text; break;
        case 'draft': result.tpDraft = text; break;
        case 'copyright': result.tpCopyright = text; break;
      }
    }
    return true;
  });
  return result;
}

/** Lines available on the open document's page, for sizing the title page. */
function currentLinesPerPage(): number {
  return getPageMetrics(useEditorStore.getState().pageLayout).linesPerPage;
}

function titlePageNodes(editor: Editor): PMNode[] {
  const nodes = editor.state.doc.children;
  const region = findTitlePageRegion(nodes.map(node =>
    titlePageNodeInfo(node.type.name, node.textContent, node.attrs),
  ));
  return nodes.slice(0, region.length);
}

/** Title-page images split by whether they sit above or below the title. */
function classifyTitleImages(nodes: readonly PMNode[]): { imagesAbove: Record<string, unknown>[]; imagesBelow: Record<string, unknown>[] } {
  const imagesAbove: Record<string, unknown>[] = [];
  const imagesBelow: Record<string, unknown>[] = [];
  let sawTitle = false;
  for (const child of nodes) {
    const t = child.type.name;
    if (t === 'titlePage' && child.attrs.field === 'title') sawTitle = true;
    if (t === 'screenplayImage') (sawTitle ? imagesBelow : imagesAbove).push({ ...child.attrs, tpCustom: false });
  }
  return { imagesAbove, imagesBelow };
}

/**
 * Swap the leading title-page region for a freshly built one.
 *
 * `built` may legitimately be empty — the writer cleared every field, or removed
 * the last image from a page that had nothing else on it. Deleting the region
 * can then leave the document with no nodes at all, which ProseMirror will not
 * accept, so a blank body line takes its place. This mirrors what deleting the
 * title page outright does.
 */
function replaceTitleRegion(editor: Editor, current: PMNode[], built: PMNode[]): void {
  if (current.length === built.length && current.every((node, index) => node.eq(built[index]))) return;
  const tr = editor.state.tr;
  const end = current.reduce((position, node) => position + node.nodeSize, 0);
  if (end === tr.doc.content.size && !built.length) {
    const fallback = editor.schema.nodes.action || editor.schema.nodes.general;
    if (fallback) built = [fallback.create()];
  }
  editor.view.dispatch(tr.replaceWith(0, end, built));
}

const TitlePageEditor: React.FC<Props> = ({ editor, onClose }) => {
  const { t } = useTranslation(['format', 'common']);
  const [initial] = useState(() => {
    const nodes = titlePageNodes(editor);
    return {
      nodes,
      data: readTitlePageData(editor, nodes),
      images: classifyTitleImages(nodes),
      custom: nodes.some(node => node.attrs.tpCustom === true),
    };
  });
  const [data, setData] = useState(initial.data);
  const [images, setImages] = useState(initial.images);
  const [custom, setCustom] = useState(initial.custom);
  const [customDraft, setCustomDraft] = useState<PMNode[] | null>(initial.custom ? initial.nodes : null);
  const [imagePending, setImagePending] = useState(false);
  const pageLayout = useEditorStore(s => s.pageLayout);
  const customLines = getPageMetrics({ ...pageLayout, fontSize: 12 }).linesPerPage;
  const contentWidth = pageLayout.pageWidth - pageLayout.leftMargin - pageLayout.rightMargin;
  const customBlocks = trimCustomTitlePage(customDraft ?? []);
  const customOverflow = customBlocks.reduce((total, node) => total + customTitleBlockLines(node, contentWidth), 0) > customLines;

  // Whether the title page goes out with print, PDF and Word. Unlike every
  // other control here it takes effect the moment it is ticked, and Cancel does
  // not put it back — deliberately. It is a preference belonging to this device,
  // not a field of the script, so it has nothing to commit: Apply's job is to
  // rewrite the title-page nodes, and making a boolean ride that transaction
  // would rebuild the whole region, dirty the document and push an edit to
  // every collaborator to record something the file never carries (issue #98).
  const includeTitlePageInOutput = useEditorStore((s) => s.includeTitlePageInOutput);
  const toggleIncludeTitlePageInOutput = useEditorStore((s) => s.toggleIncludeTitlePageInOutput);

  const setField = useCallback((key: keyof Omit<TitlePageAttrs, 'field'>, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = async () => {
    try {
      if (imagePending || (custom && customOverflow)) return;
      if (!custom && initial.custom && !(await confirmAction(t('titlePage.standardConfirm')))) return;
      const current = titlePageNodes(editor);
      if (current.length !== initial.nodes.length || current.some((node, index) => !node.eq(initial.nodes[index]))) {
        showToast(t('titlePage.concurrentEdit'), 'error');
        return;
      }
      const built = custom ? customBlocks
        : buildTitlePageBlocks(editor, data, images.imagesAbove, images.imagesBelow, currentLinesPerPage());
      replaceTitleRegion(editor, current, built);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('titlePage.updateFailed'), 'error');
    }
  };

  function changeLayout(nextCustom: boolean) {
    if (nextCustom === custom) return;
    if (nextCustom && !customDraft) {
      const standard = data === initial.data && images === initial.images && initial.nodes.length
        ? initial.nodes
        : buildTitlePageBlocks(editor, data, images.imagesAbove, images.imagesBelow, currentLinesPerPage());
      setCustomDraft(customizeTitlePageBlocks(standard, editor.schema, data));
    } else if (!nextCustom && customDraft) {
      setData({ ...EMPTY_ATTRS, ...readCustomTitleFields(customDraft.map(node => node.toJSON())) });
      setImages(classifyTitleImages(customDraft));
    }
    setCustom(nextCustom);
  }

  // --- Title-page image: upload and insert a screenplayImage node at the chosen
  // position within the title page (free-flow: exporters render it in order). ---
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imagePosition, setImagePosition] = useState<'above' | 'below'>('above');
  const handleAddImage = useCallback(() => imageInputRef.current?.click(), []);

  const handleImageChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast(t('titlePage.chooseImage'), 'error'); return; }
    const placement = imagePosition;
    setImagePending(true);
    try {
      // Shared with the body-image paths: a project asset when there is a
      // project, the scratch store when there isn't, never bytes in the document.
      const attrs = await buildImageAttrs(file, ['title-page-image']);
      warnIfImageDegraded(attrs);
      setImages(prev => placement === 'above'
        ? { ...prev, imagesAbove: [...prev.imagesAbove, attrs] }
        : { ...prev, imagesBelow: [...prev.imagesBelow, attrs] });
    } catch (err) {
      showToast(t('titlePage.imageFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setImagePending(false);
    }
  }, [imagePosition, t]);

  const handleSyncFromProject = useCallback(() => {
    const { documentTitle } = useEditorStore.getState();
    setData((prev) => ({
      ...prev,
      tpTitle: documentTitle || prev.tpTitle,
    }));
    showToast(t('titlePage.synced'), 'success');
  }, [t]);

  // The active script-format template can restrict which title-page fields appear
  // (e.g. stage plays don't have WGA Registration). Unset = show all default fields.
  const activeTpFields: string[] | undefined = (() => {
    try {
      return useFormattingTemplateStore.getState().getActiveTemplate().titlePageFields;
    } catch {
      return undefined;
    }
  })();
  const showField = (id: string): boolean => !activeTpFields || activeTpFields.includes(id);

  // Preview = the classic layout from the LIVE fields + the current images
  // (classified above/below the title), so it matches what Apply produces.
  const { byLine, draftLine, copyrightLine } = deriveFields(data);
  const { imagesAbove, imagesBelow } = images;
  const titlePx = `${Math.max(8, Math.round(data.tpTitleFontSize * 0.85))}px`;
  const bottomRight = [data.tpContact, copyrightLine].filter(Boolean).join('\n');

  const editImages = (mutate: (above: Record<string, unknown>[], below: Record<string, unknown>[]) => void) => {
    setImages(prev => {
      const above = [...prev.imagesAbove];
      const below = [...prev.imagesBelow];
      mutate(above, below);
      return { imagesAbove: above, imagesBelow: below };
    });
  };
  const removeImg = (above: boolean, idx: number) => editImages((a, b) => { (above ? a : b).splice(idx, 1); });
  const moveImg = (above: boolean, idx: number, target: 'above' | 'below') => editImages((a, b) => {
    if ((above ? 'above' : 'below') === target) return;
    const [x] = (above ? a : b).splice(idx, 1);
    if (x) (target === 'above' ? a : b).push(x);
  });
  const alignImg = (above: boolean, idx: number, align: string) => editImages((a, b) => {
    const arr = above ? a : b;
    if (arr[idx]) arr[idx] = { ...arr[idx], align };
  });

  const handleDeleteTitlePage = useCallback(async () => {
    if (!(await confirmAction(t('titlePage.deleteConfirm')))) return;
    replaceTitleRegion(editor, titlePageNodes(editor), []);
    onClose();
  }, [editor, onClose, t]);

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose} dialogLabel={t('titlePage.title')}>
      <div className="tp-editor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">{t('titlePage.title')}</div>
        <div className="tp-layout-choice">
          <button type="button" className="props-btn" aria-pressed={!custom} disabled={imagePending}
            onClick={() => changeLayout(false)}>{t('titlePage.standardLayout')}</button>
          <button type="button" className="props-btn" aria-pressed={custom} disabled={imagePending}
            onClick={() => changeLayout(true)}>{t('common:custom')}</button>
        </div>
        {custom ? (
          <CustomTitlePageEditor schema={editor.schema} nodes={customDraft ?? []} onChange={setCustomDraft}
            layout={pageLayout} linesPerPage={customLines} contentWidth={contentWidth} onUploadChange={setImagePending} />
        ) : (
        <div className="tp-editor-body">
          <div className="tp-editor-form">
            {showField('tpTitle') && (
            <div className="props-field props-field-wide">
              <label className="props-label">{t('titlePage.titleField')}</label>
              <input
                className="props-input"
                value={data.tpTitle}
                onChange={(e) => setField('tpTitle', e.target.value)}
                placeholder={t('titlePage.titlePlaceholder')}
                autoFocus
              />
            </div>
            )}
            {showField('tpTitle') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.titleSize')}</label>
              <Select
                className="props-input"
                value={data.tpTitleFontSize}
                onChange={(e) => setData((prev) => ({ ...prev, tpTitleFontSize: Number(e.target.value) }))}
              >
                {TITLE_FONT_SIZES.map((s) => <option key={s} value={s}>{t('titlePage.points', { size: s })}</option>)}
              </Select>
            </div>
            )}
            {showField('tpCredit') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.credit')}</label>
              <input
                className="props-input"
                value={data.tpCredit}
                onChange={(e) => setField('tpCredit', e.target.value)}
                placeholder={DEFAULT_TITLE_PAGE_CREDIT}
              />
            </div>
            )}
            {showField('tpWrittenBy') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.writtenBy')}</label>
              <input
                className="props-input"
                value={data.tpWrittenBy}
                onChange={(e) => setField('tpWrittenBy', e.target.value)}
                placeholder={t('titlePage.authorPlaceholder')}
              />
            </div>
            )}
            {showField('tpBasedOn') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.basedOn')}</label>
              <input
                className="props-input"
                value={data.tpBasedOn}
                onChange={(e) => setField('tpBasedOn', e.target.value)}
                placeholder={t('titlePage.basedOnPlaceholder')}
              />
            </div>
            )}
            {showField('tpDraft') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.draft')}</label>
              <input
                className="props-input"
                value={data.tpDraft}
                onChange={(e) => setField('tpDraft', e.target.value)}
                placeholder={t('titlePage.draftPlaceholder')}
              />
            </div>
            )}
            {showField('tpDraftDate') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.draftDate')}</label>
              {/* Free text, not a date picker. A title page dates a draft the way
                  a writer would write it — "26 August 2026", "Winter 2026" — and
                  that is what Fountain's `Draft date:` carries either way. A
                  `type="date"` input renders nothing but ISO yyyy-mm-dd, so an
                  imported date was held correctly and still shown as an empty
                  box, with no way to read or edit it. */}
              <input
                className="props-input"
                value={data.tpDraftDate}
                onChange={(e) => setField('tpDraftDate', e.target.value)}
                placeholder={t('titlePage.draftDatePlaceholder')}
              />
            </div>
            )}
            {showField('tpContact') && (
            <div className="props-field props-field-wide">
              <label className="props-label">{t('titlePage.contact')}</label>
              <textarea
                className="props-textarea"
                value={data.tpContact}
                onChange={(e) => setField('tpContact', e.target.value)}
                placeholder={t('titlePage.contactPlaceholder')}
                rows={3}
              />
            </div>
            )}
            {showField('tpCopyright') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.copyright')}</label>
              <input
                className="props-input"
                value={data.tpCopyright}
                onChange={(e) => setField('tpCopyright', e.target.value)}
                placeholder={t('titlePage.copyrightPlaceholder')}
              />
            </div>
            )}
            {showField('tpWgaRegistration') && (
            <div className="props-field">
              <label className="props-label">{t('titlePage.wga')}</label>
              <input
                className="props-input"
                value={data.tpWgaRegistration}
                onChange={(e) => setField('tpWgaRegistration', e.target.value)}
                placeholder="WGAw #123456" // i18n-ignore: WGA registration number format
              />
            </div>
            )}
            {showField('tpNotes') && (
            <div className="props-field props-field-wide">
              <label className="props-label">{t('titlePage.notes')}</label>
              <input
                className="props-input"
                value={data.tpNotes}
                onChange={(e) => setField('tpNotes', e.target.value)}
                placeholder={t('titlePage.notesPlaceholder')}
              />
            </div>
            )}
            <button
              className="tp-sync-btn"
              onClick={handleSyncFromProject}
              type="button"
            >
              {t('titlePage.syncTitle')}
            </button>
            <div className="props-field props-field-wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="props-label" style={{ marginTop: 0 }}>{t('titlePage.placeImage')}</label>
              <Select
                className="props-input"
                value={imagePosition}
                onChange={(e) => setImagePosition(e.target.value as 'above' | 'below')}
                style={{ flex: 1 }}
                title={t('titlePage.placeImageTitle')}
              >
                <option value="above">{t('titlePage.placeTop')}</option>
                <option value="below">{t('titlePage.placeBottom')}</option>
              </Select>
              <button className="tp-sync-btn" onClick={handleAddImage} type="button" disabled={imagePending} style={{ marginTop: 0 }}>
                {t('titlePage.addImage')}
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageChosen}
            />

            {(imagesAbove.length + imagesBelow.length) > 0 && (
              <div className="props-field props-field-wide">
                <label className="props-label">{t('titlePage.images', { count: imagesAbove.length + imagesBelow.length })}</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    ...imagesAbove.map((attrs, idx) => ({ attrs, above: true, idx })),
                    ...imagesBelow.map((attrs, idx) => ({ attrs, above: false, idx })),
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--fd-border, #ddd)', borderRadius: 4, padding: 4 }}>
                      <div style={{ width: 48, flex: '0 0 auto' }}><TpImageThumb attrs={row.attrs} /></div>
                      <Select
                        className="props-input"
                        value={row.above ? 'above' : 'below'}
                        onChange={(e) => moveImg(row.above, row.idx, e.target.value as 'above' | 'below')}
                        style={{ flex: 1 }}
                        title={t('titlePage.imagePlacement')}
                      >
                        <option value="above">{t('titlePage.top')}</option>
                        <option value="below">{t('titlePage.bottom')}</option>
                      </Select>
                      <Select
                        className="props-input"
                        value={(row.attrs.align as string) || 'center'}
                        onChange={(e) => alignImg(row.above, row.idx, e.target.value)}
                        style={{ flex: 1 }}
                        title={t('titlePage.imageAlignment')}
                      >
                        <option value="left">{t('titlePage.alignLeft')}</option>
                        <option value="center">{t('titlePage.alignCenter')}</option>
                        <option value="right">{t('titlePage.alignRight')}</option>
                      </Select>
                      <button type="button" className="tp-sync-btn" style={{ marginTop: 0 }} onClick={() => removeImg(row.above, row.idx)}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live preview — the classic layout from the live fields + images,
              exactly as Apply / the PDF & DOCX exports produce it. */}
          <div className="tp-editor-preview">
            <div className="tp-preview-page" style={{ display: 'flex', flexDirection: 'column', padding: '7% 9%' }}>
              {imagesAbove.map((a, i) => <TpImageThumb key={`a${i}`} attrs={a} align />)}
              <div style={{ marginTop: '20%', textAlign: 'center' }}>
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: titlePx }}>{data.tpTitle || t('titlePage.untitledPreview')}</div>
                {byLine && <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{byLine}</div>}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 9, gap: 8 }}>
                <div style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>{draftLine}</div>
                <div style={{ textAlign: 'right', whiteSpace: 'pre-wrap' }}>{bottomRight}</div>
              </div>
              {imagesBelow.map((a, i) => <TpImageThumb key={`b${i}`} attrs={a} align />)}
            </div>
          </div>
        </div>
        )}
        {custom && customOverflow && <p className="tp-custom-overflow" role="status">{t('titlePage.customOverflow')}</p>}
        <div className="tp-output-pref">
          <label className="tp-output-check">
            <input
              type="checkbox"
              checked={includeTitlePageInOutput}
              onChange={toggleIncludeTitlePageInOutput}
            />
            <span>{t('titlePage.includeInOutput')}</span>
          </label>
          <p className="tp-output-help">
            {t('titlePage.includeInOutputHelp')}
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={handleDeleteTitlePage} style={{ marginRight: 'auto', color: '#c0392b' }}>
            {t('titlePage.delete')}
          </button>
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={handleApply} disabled={imagePending || (custom && customOverflow)}>
            {t('common:apply')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default TitlePageEditor;
