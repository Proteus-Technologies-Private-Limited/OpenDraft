/**
 * The split screen's Page View: the script as pages, read-only.
 *
 * The editor beside it is where the writing happens; this pane is for seeing
 * where the pages break without leaving the script. It uses the same
 * pagination as the page thumbnails, so a scene that starts a new page here
 * starts it there too.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaTimes } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { activeTemplateHints, computePageBlocks } from '../editor/pagination';

interface Props {
  editor: Editor | null;
  onRequestClose: () => void;
}

const ELEMENT_LABEL: Record<string, string> = {
  sceneHeading: 'scene-heading',
  action: 'action',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
  general: 'general',
  shot: 'shot',
  newAct: 'new-act',
};

const PagePreviewPane: React.FC<Props> = ({ editor, onRequestClose }) => {
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  const pages = useMemo(() => {
    if (!editor) return [];
    try {
      return computePageBlocks(editor.state.doc, pageLayout, activeTemplateHints());
    } catch {
      return [];
    }
  }, [editor, pageLayout, version]);

  return (
    <div className="page-preview-pane">
      <div className="page-preview-header">
        <span className="page-preview-title">Page View</span>
        <button
          className="panel-close-btn"
          onClick={onRequestClose}
          title="Close Page View"
          aria-label="Close Page View"
        >
          <FaTimes />
        </button>
      </div>
      <div className="page-preview-scroll">
        {pages.length === 0 ? (
          <p className="page-preview-empty">No pages yet. Start writing and the pages appear here.</p>
        ) : pages.map((page) => (
          <div className="page-preview-sheet" key={page.pageNumber}>
            <div className="page-preview-body">
              {page.blocks.map((block, i) => (
                <div
                  key={i}
                  className={`page-preview-line page-preview-${ELEMENT_LABEL[block.typeName] ?? 'general'}`}
                >
                  {block.text || '\u00a0'}
                </div>
              ))}
            </div>
            <span className="page-preview-number">{page.pageNumber}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PagePreviewPane;
