import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode, Mark } from '@tiptap/pm/model';
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

type TpData = Omit<TitlePageAttrs, 'field'>;

/** Derive the rendered credit lines from the dialog fields. */
function deriveFields(data: TpData) {
  const byLine = data.tpWrittenBy
    ? (data.tpBasedOn ? `Written by ${data.tpWrittenBy}\n${data.tpBasedOn}` : `Written by ${data.tpWrittenBy}`)
    : '';
  const draftLine = (data.tpDraft || data.tpDraftDate) ? [data.tpDraft, data.tpDraftDate].filter(Boolean).join(' - ') : '';
  const copyrightLine = (data.tpCopyright || data.tpWgaRegistration) ? [data.tpCopyright, data.tpWgaRegistration].filter(Boolean).join('\n') : '';
  return { byLine, draftLine, copyrightLine };
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
 * Build the title-page nodes with the classic layout: optional images at the
 * top, the title ~⅓ down, the credit line below it, the draft/contact/copyright/
 * notes block pushed to the bottom (via blank spacer lines), then optional
 * images at the very bottom. Rendered identically by the flow exporters.
 *
 * `linesPerPage` is a parameter rather than a store read: the layout that
 * matters is the one belonging to the document being laid out. That is the
 * store's for the dialog, but an importer building a title page holds the
 * incoming document's layout while the store still has the previous document's.
 */
function buildTitlePageBlocks(
  editor: Editor,
  data: TpData,
  imagesAbove: Record<string, unknown>[],
  imagesBelow: Record<string, unknown>[],
  linesPerPage: number,
): PMNode[] {
  const schema = editor.state.schema;
  const titlePageType = schema.nodes.titlePage;
  const imageType = schema.nodes.screenplayImage;
  const { byLine, draftLine, copyrightLine } = deriveFields(data);
  const blank = () => titlePageType.create({ field: 'blank' });

  // Whatever the writer set on each field by hand, so applying the dialog does
  // not throw it away.
  //
  // Every apply rebuilds the title page from the field values, and the text
  // nodes were built bare — so a title set in a display face reverted to the
  // template's font the moment anything else on the page was edited. The marks
  // are the writer's own formatting: they win over the template, and they are
  // what has to survive.
  const keptMarks = new Map<string, readonly Mark[]>();
  editor.state.doc.forEach((node) => {
    if (node.type.name !== 'titlePage') return;
    const field = node.attrs?.field as string | undefined;
    if (!field || field === 'blank' || keptMarks.has(field)) return;
    const first = node.firstChild;
    if (first?.isText && first.marks.length > 0) keptMarks.set(field, first.marks);
  });

  const text = (field: string, t: string): PMNode =>
    titlePageType.create(
      field === 'title' ? { field: 'title', ...data } : { field },
      t ? schema.text(t, keptMarks.get(field) as Mark[] | undefined) : undefined,
    );
  const imgLines = (a: Record<string, unknown>) => Math.max(1, Number(a.heightLines) || 8);

  // Sized from the document's own page, not a hardcoded 54-line US Letter. A4 —
  // the default — holds 58 lines, so the old constants left the bottom block
  // four lines short of the foot of the page on every A4 script, and would have
  // overflowed a shorter page outright.
  const TITLE_LINE = Math.max(3, Math.round(linesPerPage / 3.6)); // title sits ~⅓ down
  const PAGE_LINES = Math.max(TITLE_LINE + 4, linesPerPage - 4);  // bottom content ends here
  const aboveLines = imagesAbove.reduce((s, a) => s + imgLines(a), 0);
  const belowLines = imagesBelow.reduce((s, a) => s + imgLines(a), 0);

  const blocks: PMNode[] = [];
  // Top images fill the space ABOVE the title; they only push the title down when
  // they're taller than that space (then the title shifts by just the overflow).
  for (const a of imagesAbove) blocks.push(imageType.create(a));
  const topSpacers = Math.max(2, TITLE_LINE - 1 - aboveLines);
  for (let i = 0; i < topSpacers; i++) blocks.push(blank());
  blocks.push(text('title', data.tpTitle || ''));
  let used = aboveLines + topSpacers + 1;
  if (byLine) { blocks.push(blank(), blank(), text('author', byLine)); used += 3; }

  const bottom: [string, string][] = [];
  if (draftLine) bottom.push(['draft', draftLine]);
  if (data.tpContact) bottom.push(['contact', data.tpContact]);
  if (copyrightLine) bottom.push(['copyright', copyrightLine]);
  if (data.tpNotes) bottom.push(['date', data.tpNotes]);
  const bottomLines = bottom.reduce((s, [, t]) => s + t.split('\n').length, 0);
  if (bottom.length || imagesBelow.length) {
    // Gap pushes the bottom block + bottom images to the bottom of the page.
    const gap = Math.max(2, PAGE_LINES - used - bottomLines - belowLines);
    for (let i = 0; i < gap; i++) blocks.push(blank());
    for (const [f, t] of bottom) blocks.push(text(f, t));
    for (const a of imagesBelow) blocks.push(imageType.create(a));
  }
  return blocks;
}

const TitlePageEditor: React.FC<Props> = ({ editor, onClose }) => {
  const [data, setData] = useState<Omit<TitlePageAttrs, 'field'>>({ ...EMPTY_ATTRS });

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
      const tr = editor.state.tr;
      const regionEnd = titlePageRegionEnd(editor);
      if (regionEnd > 0) tr.delete(0, regionEnd);
      for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
      editor.view.dispatch(tr);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update title page', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const tr = editor.state.tr;
      const end = titlePageRegionEnd(editor);
      if (end > 0) tr.delete(0, end);
      for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
      editor.view.dispatch(tr);
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
    const built = buildTitlePageBlocks(editor, data, above, below, currentLinesPerPage());
    const tr = editor.state.tr;
    const end = titlePageRegionEnd(editor);
    if (end > 0) tr.delete(0, end);
    for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
    editor.view.dispatch(tr);
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
    const end = titlePageRegionEnd(editor);
    if (end > 0) {
      const tr = editor.state.tr.delete(0, end);
      if (tr.doc.content.size === 0) {
        const fallback = editor.schema.nodes.action || editor.schema.nodes.general;
        if (fallback) tr.insert(0, fallback.create());
      }
      editor.view.dispatch(tr);
    }
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
              <input
                className="props-input"
                type="date"
                value={data.tpDraftDate}
                onChange={(e) => setField('tpDraftDate', e.target.value)}
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
