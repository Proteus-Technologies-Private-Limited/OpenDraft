import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import {
  buildElementNumberDecorations,
  ELEMENT_NUMBERS_REFRESH,
} from '../editor/extensions/ElementNumbers';
import { getElementNumberingRules } from '../utils/elementNumbers';
import { useEditorStore } from '../stores/editorStore';
import { EditorState, Plugin, type Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { reviewProjection, type ReviewDisplay } from '../editor/reviewProjection';
import {
  createPaginationPlugin,
  activeTemplateHints,
  getPageMetrics,
  paginationPluginKey,
  type PaginationState,
} from '../editor/pagination';
import { resolveMoresContds, type PageLayout } from '../stores/editorStore';
interface Band {
  page: number;
  top: number;
  title: boolean;
}
/** Separate read-only view; no collaboration plugins, autosave, or accepted/rejected edits. */
export default function ReviewDocument({
  editor,
  mode,
  layout,
  phoneView = false,
}: {
  editor: Editor;
  mode: ReviewDisplay;
  layout: PageLayout;
  phoneView?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1),
    [bands, setBands] = useState<Band[]>([]);
  useEffect(() => {
    if (!mount.current) return;
    let active = true,
      frame = 0;
    const metrics = getPageMetrics(layout),
      contd = resolveMoresContds(layout).dialogueBreakContd;
    const state = () =>
      EditorState.create({
        schema: editor.schema,
        doc: reviewProjection(editor.state.doc, mode),
        plugins: [
          new Plugin({
            props: {
              decorations: (state) =>
                buildElementNumberDecorations(
                  state.doc,
                  getElementNumberingRules(),
                  useEditorStore.getState().sceneNumbersVisible,
                ),
            },
          }),
          createPaginationPlugin(
            (s) => {
              if (active) setPages(s.pageCount);
            },
            () => layout,
            activeTemplateHints,
          ),
        ],
      });
    const view = new EditorView(mount.current, {
      state: state(),
      editable: () => false,
      attributes: {
        class: 'screenplay-content review-projection',
        'aria-label': `${mode === 'original' ? 'Original' : 'Proposed'} screenplay, read only`,
        role: 'document',
      },
    });
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active) return;
        const root = view.dom as HTMLElement,
          base = root.getBoundingClientRect(),
          scale = base.width / root.offsetWidth || 1;
        const ps = paginationPluginKey.getState(view.state) as PaginationState;
        const next: Band[] = [];
        for (const brk of ps.breaks) {
          const node = root.children[brk.nodeIndex] as HTMLElement | undefined;
          if (!node) continue;
          const inside =
            brk.contentOffset !== undefined || brk.dualLine !== undefined
              ? node.querySelector<HTMLElement>(
                  `.sp-paragraph-page-break[data-page-number="${brk.pageNumber}"]`,
                )
              : null;
          const rect = (inside ?? node).getBoundingClientRect();
          const continuation =
            (brk.isDialogueSplit || brk.dualLine !== undefined) && contd ? 16 : 0;
          const top =
            (inside ? rect.bottom - base.top : rect.top - base.top) / scale -
            (phoneView ? 36 : metrics.sepHeightPx + continuation);
          next.push({ page: brk.pageNumber, top, title: brk.isTitlePage });
        }
        setBands((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      });
    };
    const update = ({ transaction }: { transaction: Transaction }) => {
      if (
        !transaction.docChanged &&
        !transaction.getMeta(ELEMENT_NUMBERS_REFRESH) &&
        !transaction.getMeta('forceRepaginate')
      )
        return;
      view.updateState(state());
      measure();
    };
    editor.on('transaction', update);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view.dom);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off('transaction', update);
      view.destroy();
    };
  }, [editor, mode, layout, phoneView]);
  const metrics = getPageMetrics(layout);
  return (
    <>
      <p className="review-preview-notice" role="status">
        {mode === 'original'
          ? 'Original: accepted text and formatting'
          : 'Proposed: all suggestions previewed'}{' '}
        · Read only · {pages} pages. Choose Show Markup to edit or review.
      </p>
      <div className="review-projection-layout">
        <div ref={mount} />
        {bands.map((band, index) => (
          <div
            key={`${band.page}-${index}`}
            className={`review-page-divider${phoneView ? ' review-page-divider--phone' : ''}`}
            aria-hidden="true"
            style={{
              top: band.top,
              height: phoneView ? 36 : metrics.sepHeightPx,
              left: phoneView ? 0 : `-${layout.leftMargin}in`,
              right: phoneView ? 0 : `-${layout.rightMargin}in`,
            }}
          >
            {phoneView ? (
              `Page ${band.page}`
            ) : (
              <>
                <div style={{ height: `${layout.bottomMargin}pt` }} />
                <div className="review-page-gap" />
                <div style={{ height: `${layout.topMargin}pt` }}>
                  <span>Page {band.page}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
