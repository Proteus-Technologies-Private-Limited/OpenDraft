import React, { useState, useEffect, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import type { TitlePageAttrs } from '../editor/extensions/TitlePage';
import { useEditorStore } from '../stores/editorStore';
import { showToast } from './Toast';

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
};

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
      const { state, dispatch } = editor.view;
      const { tr } = state;
      let found = false;

      // Remove all existing titlePage nodes
      const nodesToRemove: { from: number; to: number }[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'titlePage') {
          nodesToRemove.push({ from: pos, to: pos + node.nodeSize });
        }
        return true;
      });

      // Remove in reverse order to maintain positions
      for (let i = nodesToRemove.length - 1; i >= 0; i--) {
        tr.delete(nodesToRemove[i].from, nodesToRemove[i].to);
      }

      // Insert structured title page nodes at position 0
      const titlePageType = state.schema.nodes.titlePage;
      const nodes = [];

      // Title node — carries all structured data as attributes
      const titleAttrs: Record<string, string> = { field: 'title', ...data };
      nodes.push(titlePageType.create(titleAttrs, data.tpTitle ? state.schema.text(data.tpTitle) : undefined));

      // Author display node
      if (data.tpWrittenBy) {
        const byLine = data.tpBasedOn
          ? `Written by ${data.tpWrittenBy}\n${data.tpBasedOn}`
          : `Written by ${data.tpWrittenBy}`;
        nodes.push(titlePageType.create({ field: 'author' }, state.schema.text(byLine)));
      }

      // Draft display node
      if (data.tpDraft || data.tpDraftDate) {
        const draftLine = [data.tpDraft, data.tpDraftDate].filter(Boolean).join(' - ');
        nodes.push(titlePageType.create({ field: 'draft' }, state.schema.text(draftLine)));
      }

      // Contact display node
      if (data.tpContact) {
        nodes.push(titlePageType.create({ field: 'contact' }, state.schema.text(data.tpContact)));
      }

      // Copyright display node
      if (data.tpCopyright || data.tpWgaRegistration) {
        const copyrightLine = [data.tpCopyright, data.tpWgaRegistration].filter(Boolean).join('\n');
        nodes.push(titlePageType.create({ field: 'copyright' }, state.schema.text(copyrightLine)));
      }

      // Notes display node
      if (data.tpNotes) {
        nodes.push(titlePageType.create({ field: 'date' }, state.schema.text(data.tpNotes)));
      }

      // Insert all nodes at the beginning of the document
      for (let i = nodes.length - 1; i >= 0; i--) {
        tr.insert(0, nodes[i]);
      }

      dispatch(tr);
      found = true;

      if (!found) {
        showToast('No title page found in document', 'error');
      }
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update title page', 'error');
    }
  }, [editor, data, onClose]);

  const handleSyncFromProject = useCallback(() => {
    const { documentTitle } = useEditorStore.getState();
    setData((prev) => ({
      ...prev,
      tpTitle: documentTitle || prev.tpTitle,
    }));
    showToast('Synced title from project', 'success');
  }, []);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="tp-editor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Title Page</div>
        <div className="tp-editor-body">
          <div className="tp-editor-form">
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
            <div className="props-field">
              <label className="props-label">Written By</label>
              <input
                className="props-input"
                value={data.tpWrittenBy}
                onChange={(e) => setField('tpWrittenBy', e.target.value)}
                placeholder="Author Name"
              />
            </div>
            <div className="props-field">
              <label className="props-label">Based On</label>
              <input
                className="props-input"
                value={data.tpBasedOn}
                onChange={(e) => setField('tpBasedOn', e.target.value)}
                placeholder="the novel by..."
              />
            </div>
            <div className="props-field">
              <label className="props-label">Draft</label>
              <input
                className="props-input"
                value={data.tpDraft}
                onChange={(e) => setField('tpDraft', e.target.value)}
                placeholder="e.g. Second Draft"
              />
            </div>
            <div className="props-field">
              <label className="props-label">Draft Date</label>
              <input
                className="props-input"
                type="date"
                value={data.tpDraftDate}
                onChange={(e) => setField('tpDraftDate', e.target.value)}
              />
            </div>
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
            <div className="props-field">
              <label className="props-label">Copyright</label>
              <input
                className="props-input"
                value={data.tpCopyright}
                onChange={(e) => setField('tpCopyright', e.target.value)}
                placeholder="Copyright 2026 Author Name"
              />
            </div>
            <div className="props-field">
              <label className="props-label">WGA Registration #</label>
              <input
                className="props-input"
                value={data.tpWgaRegistration}
                onChange={(e) => setField('tpWgaRegistration', e.target.value)}
                placeholder="WGAw #123456"
              />
            </div>
            <div className="props-field props-field-wide">
              <label className="props-label">Notes</label>
              <input
                className="props-input"
                value={data.tpNotes}
                onChange={(e) => setField('tpNotes', e.target.value)}
                placeholder="e.g. CONFIDENTIAL"
              />
            </div>
            <button
              className="tp-sync-btn"
              onClick={handleSyncFromProject}
              type="button"
            >
              Sync Title from Project
            </button>
          </div>

          {/* Live Preview */}
          <div className="tp-editor-preview">
            <div className="tp-preview-page">
              <div className="tp-preview-title">{data.tpTitle || 'UNTITLED'}</div>
              {data.tpWrittenBy && (
                <div className="tp-preview-author">
                  <div className="tp-preview-credit">Written by</div>
                  <div>{data.tpWrittenBy}</div>
                  {data.tpBasedOn && <div className="tp-preview-basedon">{data.tpBasedOn}</div>}
                </div>
              )}
              <div className="tp-preview-bottom">
                <div className="tp-preview-bottom-left">
                  {data.tpDraft && <div>{data.tpDraft}</div>}
                  {data.tpDraftDate && <div>{data.tpDraftDate}</div>}
                  {data.tpNotes && <div className="tp-preview-notes">{data.tpNotes}</div>}
                </div>
                <div className="tp-preview-bottom-right">
                  {data.tpContact && (
                    <div className="tp-preview-contact">
                      {data.tpContact.split('\n').map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}
                  {data.tpCopyright && <div>{data.tpCopyright}</div>}
                  {data.tpWgaRegistration && <div>{data.tpWgaRegistration}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
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
