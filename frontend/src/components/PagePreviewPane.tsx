/**
 * The split screen's Page View: the script as whole pages, read-only.
 *
 * The editor beside it is where the writing happens; this pane is for seeing
 * where the pages break without leaving the script. Each sheet is drawn at the
 * page's real aspect ratio and the manuscript is scaled down to fit it, so the
 * writer sees the whole page — not a zoomed strip of it. The pagination is the
 * same as the page thumbnails, so a scene that starts a new page here starts
 * it there too.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaTimes } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { activeTemplateHints, computePageBlocks } from '../editor/pagination';
import { getSpaceBefore } from '../utils/elementSpacing';

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

/** Indents in inches from the page edge, matching the editor's page. */
const FD_INDENTS: Record<string, [number, number]> = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50],
  character: [3.50, 7.50], dialogue: [2.50, 6.00],
  parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50],
  newAct: [1.50, 7.50],
};

/** 12pt at 96 DPI, the line the pagination counts. */
const LINE_HEIGHT_PX = 12 * (96 / 72);

/** Horizontal padding of `.page-preview-scroll`, in px (14 each side). */
const SCROLL_PADDING = 14;

const PagePreviewPane: React.FC<Props> = ({ editor, onRequestClose }) => {
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const fontFamily = useEditorStore((s) => s.fontFamily);
  const fontSize = useEditorStore((s) => s.fontSize);
  const [version, setVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

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

  const refWidthPx = pageLayout.pageWidth * 96;
  const refHeightPx = pageLayout.pageHeight * 96;

  // All sheets are the same width, so one measurement of the scroll area
  // gives the scale for every page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const availableW = el.clientWidth - SCROLL_PADDING * 2;
      const availableH = el.clientHeight - SCROLL_PADDING * 2;
      // In the side-by-side pane the width is the limit; in a stacked pane the
      // height is. Taking the smaller scale keeps a whole page visible in both
      // instead of drawing a letter page as wide as the window.
      const widthScale = availableW / refWidthPx;
      const heightScale = availableH / refHeightPx;
      setScale(Math.max(0.05, Math.min(widthScale, heightScale)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [refWidthPx, refHeightPx]);

  const spaceBefore = useMemo(() => getSpaceBefore(), []);

  const pageContentStyle = useMemo((): React.CSSProperties => ({
    width: `${refWidthPx}px`,
    height: `${refHeightPx}px`,
    paddingTop: `${pageLayout.topMargin}pt`,
    paddingBottom: `${pageLayout.bottomMargin}pt`,
    paddingLeft: `${pageLayout.leftMargin}in`,
    paddingRight: `${pageLayout.rightMargin}in`,
    fontFamily: `'${fontFamily}', 'Courier New', Courier, monospace`,
    fontSize: `${fontSize}pt`,
    lineHeight: `${LINE_HEIGHT_PX}px`,
  }), [refWidthPx, refHeightPx, pageLayout, fontFamily, fontSize]);

  const blockStyle = (typeName: string, isFirst: boolean): React.CSSProperties => {
    const [left, right] = FD_INDENTS[typeName] || [1.50, 7.50];
    const padL = Math.max(0, (left - pageLayout.leftMargin) * 96);
    const padR = Math.max(0, (pageLayout.pageWidth - right - pageLayout.rightMargin) * 96);
    const space = isFirst ? 0 : (spaceBefore[typeName] ?? 0);
    return {
      paddingLeft: padL > 0 ? `${padL}px` : undefined,
      paddingRight: padR > 0 ? `${padR}px` : undefined,
      marginTop: space > 0 ? `${space * LINE_HEIGHT_PX}px` : undefined,
    };
  };

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
      <div className="page-preview-scroll" ref={scrollRef}>
        {pages.length === 0 ? (
          <p className="page-preview-empty">No pages yet. Start writing and the pages appear here.</p>
        ) : pages.map((page) => (
          <div
            className="page-preview-sheet"
            key={page.pageNumber}
            style={{
              width: `${Math.max(1, Math.round(refWidthPx * scale))}px`,
              height: `${Math.max(1, Math.round(refHeightPx * scale))}px`,
            }}
          >
            <div
              className="page-preview-sheet-inner"
              style={{ ...pageContentStyle, transform: `scale(${scale})` }}
            >
              {page.blocks.map((block, i) => (
                <div
                  key={i}
                  className={`page-preview-line page-preview-${ELEMENT_LABEL[block.typeName] ?? 'general'}`}
                  style={blockStyle(block.typeName, i === 0)}
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
