import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { TitlePageAttrs } from '../editor/extensions/TitlePage';
import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { buildImageAttrs, warnIfImageDegraded } from '../utils/insertImage';
import { useImageSrc } from '../hooks/useImageSrc';
import { getPageMetrics } from '../editor/pagination';
import {
  findTitlePageRegion,
  titlePageAttrsCarryData,
  type TitleNodeInfo,
} from '../utils/titlePageRegion';
import { DEFAULT_TITLE_PAGE_CREDIT } from '../utils/titlePageBlocks';
import { buildTitlePageBlocks, deriveFields } from '../utils/titlePageDialogBlocks';
import { showToast } from './Toast';

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
function readTitlePageData(editor: Editor): Omit<TitlePageAttrs, 'field'> {
  const result = { ...EMPTY_ATTRS };
  const titleNode = findTitlePageNode(editor);
  if (titleNode && titleNode.attrs.tpTitle) {
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

/** How many of the document's leading nodes belong to the title page. */
function titlePageRegionLength(editor: Editor): number {
  const doc = editor.state.doc;
  const infos: TitleNodeInfo[] = [];
  for (let k = 0; k < doc.childCount; k++) {
    const child = doc.child(k);
    infos.push({
      type: child.type.name,
      hasText: (child.textContent || '').trim().length > 0,
      hasTitleData: titlePageAttrsCarryData(child.attrs as Record<string, unknown>),
    });
  }
  return findTitlePageRegion(infos).length;
}

/** Title-page images split by whether they sit above or below the title. */
function classifyTitleImages(editor: Editor): { imagesAbove: Record<string, unknown>[]; imagesBelow: Record<string, unknown>[] } {
  const doc = editor.state.doc;
  const imagesAbove: Record<string, unknown>[] = [];
  const imagesBelow: Record<string, unknown>[] = [];
  let sawTitle = false;
  const end = titlePageRegionLength(editor);
  for (let k = 0; k < end; k++) {
    const child = doc.child(k);
    const t = child.type.name;
    if (t === 'titlePage' && child.attrs.field === 'title') sawTitle = true;
    if (t === 'screenplayImage') (sawTitle ? imagesBelow : imagesAbove).push(child.attrs as Record<string, unknown>);
  }
  return { imagesAbove, imagesBelow };
}

/**
 * End position (doc coords) of the leading title-page region.
 *
 * Uses the shared resolver rather than "the leading run of title nodes", which
 * `findTitlePageNode` never agreed with: the dialog would find and prefill from
 * a title page sitting one blank line down, then Apply would replace nothing and
 * insert a *second* one at the top (issue #52).
 */
function titlePageRegionEnd(editor: Editor): number {
  const doc = editor.state.doc;
  const length = titlePageRegionLength(editor);
  let end = 0;
  for (let k = 0; k < length; k++) end += doc.child(k).nodeSize;
  return end;
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
function replaceTitleRegion(editor: Editor, built: PMNode[]): void {
  const tr = editor.state.tr;
  const end = titlePageRegionEnd(editor);
  if (end > 0) tr.delete(0, end);
  for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
  if (tr.doc.content.size === 0) {
    const fallback = editor.schema.nodes.action || editor.schema.nodes.general;
    if (fallback) tr.insert(0, fallback.create());
  }
  editor.view.dispatch(tr);
}

const TitlePageEditor: React.FC<Props> = ({ editor, onClose }) => {
  const [data, setData] = useState<Omit<TitlePageAttrs, 'field'>>({ ...EMPTY_ATTRS });

  // Whether the title page goes out with print, PDF and Word. Unlike every
  // other control here it takes effect the moment it is ticked, and Cancel does
  // not put it back — deliberately. It is a preference belonging to this device,
  // not a field of the script, so it has nothing to commit: Apply's job is to
  // rewrite the title-page nodes, and making a boolean ride that transaction
  // would rebuild the whole region, dirty the document and push an edit to
  // every collaborator to record something the file never carries (issue #98).
  const includeTitlePageInOutput = useEditorStore((s) => s.includeTitlePageInOutput);
  const toggleIncludeTitlePageInOutput = useEditorStore((s) => s.toggleIncludeTitlePageInOutput);

  useEffect(() => {
    setData(readTitlePageData(editor));
  }, [editor]);

  const setField = useCallback((key: keyof Omit<TitlePageAttrs, 'field'>, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    try {
      const { imagesAbove, imagesBelow } = classifyTitleImages(editor);
      const built = buildTitlePageBlocks(editor, data, imagesAbove, imagesBelow, currentLinesPerPage());
      replaceTitleRegion(editor, built);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update title page', 'error');
    }
  }, [editor, data, onClose]);

  // --- Title-page image: upload and insert a screenplayImage node at the chosen
  // position within the title page (free-flow: exporters render it in order). ---
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imagePosition, setImagePosition] = useState<'above' | 'below'>('above');
  const handleAddImage = useCallback(() => imageInputRef.current?.click(), []);

  const handleImageChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return; }
    const placement = imagePosition;
    try {
      // Shared with the body-image paths: a project asset when there is a
      // project, the scratch store when there isn't, never bytes in the document.
      const attrs = await buildImageAttrs(file, ['title-page-image']);
      warnIfImageDegraded(attrs);
      // Add to the chosen group and rebuild the page so it appears in the right place.
      const g = classifyTitleImages(editor);
      (placement === 'above' ? g.imagesAbove : g.imagesBelow).push(attrs);
      const built = buildTitlePageBlocks(editor, data, g.imagesAbove, g.imagesBelow, currentLinesPerPage());
      replaceTitleRegion(editor, built);
      showToast('Image added to title page', 'success');
    } catch (err) {
      showToast(`Failed to add image: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, imagePosition, data]);

  const handleSyncFromProject = useCallback(() => {
    const { documentTitle } = useEditorStore.getState();
    setData((prev) => ({
      ...prev,
      tpTitle: documentTitle || prev.tpTitle,
    }));
    showToast('Synced title from project', 'success');
  }, []);

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

  // Re-render the preview when the document changes (e.g. an image is added).
  const [, bumpDocVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => bumpDocVersion((v) => v + 1);
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); };
  }, [editor]);

  // Preview = the classic layout from the LIVE fields + the current images
  // (classified above/below the title), so it matches what Apply produces.
  const { byLine, draftLine, copyrightLine } = deriveFields(data);
  const { imagesAbove, imagesBelow } = classifyTitleImages(editor);
  const titlePx = `${Math.max(8, Math.round(data.tpTitleFontSize * 0.85))}px`;
  const bottomRight = [data.tpContact, copyrightLine].filter(Boolean).join('\n');

  // Rebuild the whole title page (classic layout) from the live fields + the
  // given image groups, so every image operation updates the page immediately.
  const rebuild = (above: Record<string, unknown>[], below: Record<string, unknown>[]) => {
    replaceTitleRegion(editor, buildTitlePageBlocks(editor, data, above, below, currentLinesPerPage()));
  };
  const editImages = (mutate: (above: Record<string, unknown>[], below: Record<string, unknown>[]) => void) => {
    const g = classifyTitleImages(editor);
    mutate(g.imagesAbove, g.imagesBelow);
    rebuild(g.imagesAbove, g.imagesBelow);
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

  const handleDeleteTitlePage = useCallback(() => {
    if (!window.confirm('Delete the entire title page (title, credits, and images)?')) return;
    if (titlePageRegionEnd(editor) > 0) replaceTitleRegion(editor, []);
    onClose();
  }, [editor, onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="tp-editor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Title Page</div>
        <div className="tp-editor-body">
          <div className="tp-editor-form">
            {showField('tpTitle') && (
            <div className="props-field props-field-wide">
              <label className="props-label">Title</label>
              <input
                className="props-input"
                value={data.tpTitle}
                onChange={(e) => setField('tpTitle', e.target.value)}
                placeholder="SCREENPLAY TITLE"
                autoFocus
              />
            </div>
            )}
            {showField('tpTitle') && (
            <div className="props-field">
              <label className="props-label">Title Size</label>
              <select
                className="props-input"
                value={data.tpTitleFontSize}
                onChange={(e) => setData((prev) => ({ ...prev, tpTitleFontSize: Number(e.target.value) }))}
              >
                {TITLE_FONT_SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
              </select>
            </div>
            )}
            {showField('tpCredit') && (
            <div className="props-field">
              <label className="props-label">Credit</label>
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
              <label className="props-label">Written By</label>
              <input
                className="props-input"
                value={data.tpWrittenBy}
                onChange={(e) => setField('tpWrittenBy', e.target.value)}
                placeholder="Author Name"
              />
            </div>
            )}
            {showField('tpBasedOn') && (
            <div className="props-field">
              <label className="props-label">Based On</label>
              <input
                className="props-input"
                value={data.tpBasedOn}
                onChange={(e) => setField('tpBasedOn', e.target.value)}
                placeholder="the novel by..."
              />
            </div>
            )}
            {showField('tpDraft') && (
            <div className="props-field">
              <label className="props-label">Draft</label>
              <input
                className="props-input"
                value={data.tpDraft}
                onChange={(e) => setField('tpDraft', e.target.value)}
                placeholder="e.g. Second Draft"
              />
            </div>
            )}
            {showField('tpDraftDate') && (
            <div className="props-field">
              <label className="props-label">Draft Date</label>
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
                placeholder="e.g. 26 August 2026"
              />
            </div>
            )}
            {showField('tpContact') && (
            <div className="props-field props-field-wide">
              <label className="props-label">Contact</label>
              <textarea
                className="props-textarea"
                value={data.tpContact}
                onChange={(e) => setField('tpContact', e.target.value)}
                placeholder="Name\nAgency\nemail@example.com\n(310) 555-0100"
                rows={3}
              />
            </div>
            )}
            {showField('tpCopyright') && (
            <div className="props-field">
              <label className="props-label">Copyright</label>
              <input
                className="props-input"
                value={data.tpCopyright}
                onChange={(e) => setField('tpCopyright', e.target.value)}
                placeholder="Copyright 2026 Author Name"
              />
            </div>
            )}
            {showField('tpWgaRegistration') && (
            <div className="props-field">
              <label className="props-label">WGA Registration #</label>
              <input
                className="props-input"
                value={data.tpWgaRegistration}
                onChange={(e) => setField('tpWgaRegistration', e.target.value)}
                placeholder="WGAw #123456"
              />
            </div>
            )}
            {showField('tpNotes') && (
            <div className="props-field props-field-wide">
              <label className="props-label">Notes</label>
              <input
                className="props-input"
                value={data.tpNotes}
                onChange={(e) => setField('tpNotes', e.target.value)}
                placeholder="e.g. CONFIDENTIAL"
              />
            </div>
            )}
            <button
              className="tp-sync-btn"
              onClick={handleSyncFromProject}
              type="button"
            >
              Sync Title from Project
            </button>
            <div className="props-field props-field-wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="props-label" style={{ marginTop: 0 }}>Place image</label>
              <select
                className="props-input"
                value={imagePosition}
                onChange={(e) => setImagePosition(e.target.value as 'above' | 'below')}
                style={{ flex: 1 }}
                title="Where the next image goes"
              >
                <option value="above">Top of page (above title)</option>
                <option value="below">Bottom of page (below all)</option>
              </select>
              <button className="tp-sync-btn" onClick={handleAddImage} type="button" style={{ marginTop: 0 }}>
                Add Image…
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
                <label className="props-label">Title Page Images ({imagesAbove.length + imagesBelow.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    ...imagesAbove.map((attrs, idx) => ({ attrs, above: true, idx })),
                    ...imagesBelow.map((attrs, idx) => ({ attrs, above: false, idx })),
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--fd-border, #ddd)', borderRadius: 4, padding: 4 }}>
                      <div style={{ width: 48, flex: '0 0 auto' }}><TpImageThumb attrs={row.attrs} /></div>
                      <select
                        className="props-input"
                        value={row.above ? 'above' : 'below'}
                        onChange={(e) => moveImg(row.above, row.idx, e.target.value as 'above' | 'below')}
                        style={{ flex: 1 }}
                        title="Image placement"
                      >
                        <option value="above">Top</option>
                        <option value="below">Bottom</option>
                      </select>
                      <select
                        className="props-input"
                        value={(row.attrs.align as string) || 'center'}
                        onChange={(e) => alignImg(row.above, row.idx, e.target.value)}
                        style={{ flex: 1 }}
                        title="Image alignment"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
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
                <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: titlePx }}>{data.tpTitle || 'UNTITLED'}</div>
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
        <div className="tp-output-pref">
          <label className="tp-output-check">
            <input
              type="checkbox"
              checked={includeTitlePageInOutput}
              onChange={toggleIncludeTitlePageInOutput}
            />
            <span>Include title page when printing or exporting to PDF or Word</span>
          </label>
          <p className="tp-output-help">
            Takes effect straight away and is remembered on this device. Final Draft,
            Fountain and Fade In files always carry the title page.
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={handleDeleteTitlePage} style={{ marginRight: 'auto', color: '#c0392b' }}>
            Delete Title Page
          </button>
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default TitlePageEditor;
