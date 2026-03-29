import React, { useCallback, useState, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';

interface IndexCardsProps {
  editor: Editor | null;
  scrollContainer: HTMLDivElement | null;
}

const IndexCards: React.FC<IndexCardsProps> = ({ editor, scrollContainer }) => {
  const { scenes, indexCardsOpen, updateSceneSynopsis } = useEditorStore();

  const [fullscreen, setFullscreen] = useState(false);
  const [dragMode, setDragMode] = useState(false);

  // Custom drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [insertIdx, setInsertIdx] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragCardSize, setDragCardSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dragCardHtml, setDragCardHtml] = useState<string>('');
  const gridRef = useRef<HTMLDivElement>(null);

  const goToScene = useCallback(
    (sceneIndex: number) => {
      if (!editor) return;
      const { doc } = editor.state;
      let currentScene = -1;
      let targetPos = 0;

      doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading') {
          currentScene++;
          if (currentScene === sceneIndex) {
            targetPos = pos;
            return false;
          }
        }
        return true;
      });

      editor.chain().focus().setTextSelection(targetPos + 1).run();

      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(targetPos + 1);
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const scrollTo =
            scrollContainer.scrollTop + (coords.top - containerRect.top) - 60;
          scrollContainer.scrollTo({ top: scrollTo, behavior: 'smooth' });
        }
      });

      if (fullscreen) setFullscreen(false);
    },
    [editor, scrollContainer, fullscreen],
  );

  // ── Get document ranges for each scene ──

  const getSceneRanges = useCallback(() => {
    if (!editor) return [];
    const { doc } = editor.state;
    const headingPositions: number[] = [];

    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        headingPositions.push(pos);
      }
    });

    const ranges: Array<{ from: number; to: number }> = [];
    for (let i = 0; i < headingPositions.length; i++) {
      const from = headingPositions[i];
      const to =
        i + 1 < headingPositions.length
          ? headingPositions[i + 1]
          : doc.content.size;
      ranges.push({ from, to });
    }
    return ranges;
  }, [editor]);

  // ── Move a scene in the document ──

  const moveScene = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!editor || fromIndex === toIndex) return;

      const ranges = getSceneRanges();
      if (fromIndex < 0 || fromIndex >= ranges.length) return;
      if (toIndex < 0 || toIndex > ranges.length) return;

      const { doc, tr } = editor.state;
      const sourceRange = ranges[fromIndex];
      const slice = doc.slice(sourceRange.from, sourceRange.to);

      let insertPos: number;
      if (toIndex >= ranges.length) {
        insertPos = doc.content.size;
      } else {
        insertPos = ranges[toIndex].from;
      }

      if (fromIndex < toIndex) {
        tr.delete(sourceRange.from, sourceRange.to);
        const adjustedInsert = insertPos - (sourceRange.to - sourceRange.from);
        tr.insert(adjustedInsert, slice.content);
      } else {
        tr.insert(insertPos, slice.content);
        const adjustedFrom = sourceRange.from + slice.content.size;
        const adjustedTo = sourceRange.to + slice.content.size;
        tr.delete(adjustedFrom, adjustedTo);
      }

      editor.view.dispatch(tr);
    },
    [editor, getSceneRanges],
  );

  // ── Compute insertion index from mouse position ──

  const calcInsertIndex = useCallback(
    (clientX: number, clientY: number): number | null => {
      if (!gridRef.current) return null;
      const cards = gridRef.current.querySelectorAll('.index-card');
      if (cards.length === 0) return null;

      const rects: DOMRect[] = [];
      cards.forEach((card) => rects.push(card.getBoundingClientRect()));

      // Group cards into rows (cards whose tops are within half a card height)
      const rows: Array<{ indices: number[]; top: number; bottom: number }> = [];
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const lastRow = rows[rows.length - 1];
        if (lastRow && Math.abs(r.top - rects[lastRow.indices[0]].top) < r.height / 2) {
          lastRow.indices.push(i);
          lastRow.bottom = Math.max(lastRow.bottom, r.bottom);
        } else {
          rows.push({ indices: [i], top: r.top, bottom: r.bottom });
        }
      }

      // Find which row the cursor is on
      let rowIdx = rows.length - 1; // default to last row
      if (clientY < rows[0].top) {
        rowIdx = 0;
      } else {
        for (let r = 0; r < rows.length; r++) {
          const midBottom = r + 1 < rows.length
            ? (rows[r].bottom + rows[r + 1].top) / 2
            : Infinity;
          if (clientY < midBottom) {
            rowIdx = r;
            break;
          }
        }
      }

      const row = rows[rowIdx];
      const rowCardIndices = row.indices;

      // If cursor is past the right edge of the last card in this row, insert after it
      const lastInRow = rects[rowCardIndices[rowCardIndices.length - 1]];
      if (clientX > lastInRow.right) {
        return rowCardIndices[rowCardIndices.length - 1] + 1;
      }

      // If cursor is before the left edge of the first card in this row, insert before it
      const firstInRow = rects[rowCardIndices[0]];
      if (clientX < firstInRow.left) {
        return rowCardIndices[0];
      }

      // Find the closest gap within this row
      for (let i = 0; i < rowCardIndices.length; i++) {
        const cardIdx = rowCardIndices[i];
        const r = rects[cardIdx];
        const cardCenter = r.left + r.width / 2;
        if (clientX < cardCenter) {
          return cardIdx; // insert before this card
        }
      }

      // Past the center of the last card in row — insert after it
      return rowCardIndices[rowCardIndices.length - 1] + 1;
    },
    [],
  );

  // ── Mouse handlers for custom drag ──
  // Use refs so pointer event listeners always call the latest function versions
  const calcInsertIndexRef = useRef(calcInsertIndex);
  calcInsertIndexRef.current = calcInsertIndex;
  const moveSceneRef = useRef(moveScene);
  moveSceneRef.current = moveScene;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;

  const handleDragHandleDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();

      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);

      // Capture the card element's position and visual clone
      const card = handle.closest('.index-card') as HTMLElement | null;
      if (card) {
        const rect = card.getBoundingClientRect();
        setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setDragCardSize({ w: rect.width, h: rect.height });
        setDragCardHtml(card.innerHTML);
      }

      setDragIdx(index);
      setDragPos({ x: e.clientX, y: e.clientY });
      setInsertIdx(null);

      const cleanup = () => {
        handle.removeEventListener('pointermove', handleMove);
        handle.removeEventListener('pointerup', handleUp);
        handle.removeEventListener('pointercancel', handleUp);
        handle.releasePointerCapture(e.pointerId);
        document.body.style.cursor = '';
        setDragIdx(null);
        setInsertIdx(null);
        setDragPos(null);
      };

      const handleMove = (ev: PointerEvent) => {
        ev.preventDefault();
        setDragPos({ x: ev.clientX, y: ev.clientY });
        const gap = calcInsertIndexRef.current(ev.clientX, ev.clientY);
        setInsertIdx(gap);
      };

      const handleUp = (ev: PointerEvent) => {
        const gap = calcInsertIndexRef.current(ev.clientX, ev.clientY);
        cleanup();

        if (gap !== null) {
          // gap is an insertion point: 0 = before first, N = after last
          // moveScene expects the same convention
          // Only adjust if dragging forward AND the gap is not past the end
          let toIndex = gap;
          if (index < gap && gap <= scenesRef.current.length - 1) toIndex--;
          if (toIndex !== index) {
            moveSceneRef.current(index, toIndex);
          }
        }
      };

      document.body.style.cursor = 'grabbing';
      handle.addEventListener('pointermove', handleMove);
      handle.addEventListener('pointerup', handleUp);
      handle.addEventListener('pointercancel', handleUp);
    },
    [],
  );

  // ── Compute indicator position ──

  const getIndicatorStyle = useCallback((): React.CSSProperties | null => {
    if (dragIdx === null || insertIdx === null || !gridRef.current) return null;
    // Don't show indicator if the effective destination is the same position
    const totalScenes = scenesRef.current.length;
    const effectiveTo = (dragIdx < insertIdx && insertIdx <= totalScenes - 1)
      ? insertIdx - 1
      : insertIdx;
    if (effectiveTo === dragIdx) return null;

    const cards = gridRef.current.querySelectorAll('.index-card');
    if (cards.length === 0) return null;

    const gridRect = gridRef.current.getBoundingClientRect();
    const rects: DOMRect[] = [];
    cards.forEach((card) => rects.push(card.getBoundingClientRect()));

    let x: number, y: number, height: number;

    if (insertIdx === 0) {
      x = rects[0].left - gridRect.left - 3;
      y = rects[0].top - gridRect.top;
      height = rects[0].height;
    } else if (insertIdx >= rects.length) {
      x = rects[rects.length - 1].right - gridRect.left;
      y = rects[rects.length - 1].top - gridRect.top;
      height = rects[rects.length - 1].height;
    } else {
      const prev = rects[insertIdx - 1];
      const curr = rects[insertIdx];
      if (Math.abs(prev.top - curr.top) < prev.height / 2) {
        // Same row
        x = (prev.right + curr.left) / 2 - gridRect.left - 1;
        y = curr.top - gridRect.top;
        height = curr.height;
      } else {
        // Different rows — show at left edge of current card
        x = curr.left - gridRect.left - 3;
        y = curr.top - gridRect.top;
        height = curr.height;
      }
    }

    return {
      position: 'absolute',
      left: x,
      top: y,
      width: 3,
      height,
      pointerEvents: 'none' as const,
      zIndex: 50,
    };
  }, [dragIdx, insertIdx]);

  if (!indexCardsOpen) return null;

  const containerClass = `index-cards${fullscreen ? ' index-cards-fullscreen' : ''}`;
  const indicatorStyle = getIndicatorStyle();

  return (
    <div className={containerClass}>
      <div className="index-cards-header">
        <span className="index-cards-title">Index Cards</span>
        <span className="index-cards-count">{scenes.length} scenes</span>
        <div className="index-cards-actions">
          <button
            className={`ic-action-btn${dragMode ? ' active' : ''}`}
            onClick={() => setDragMode(!dragMode)}
            title={dragMode ? 'Exit drag-drop mode' : 'Enter drag-drop mode'}
          >
            {dragMode ? 'Done' : 'Reorder'}
          </button>
          <button
            className="ic-action-btn ic-fullscreen-btn"
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="9,1 13,1 13,5" /><line x1="13" y1="1" x2="8" y2="6" />
                <polyline points="5,13 1,13 1,9" /><line x1="1" y1="13" x2="6" y2="8" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="1,5 1,1 5,1" /><line x1="1" y1="1" x2="6" y2="6" />
                <polyline points="13,9 13,13 9,13" /><line x1="13" y1="13" x2="8" y2="8" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="index-cards-grid" ref={gridRef} style={{ position: 'relative' }}>
        {scenes.length === 0 ? (
          <div className="index-cards-empty">
            No scenes yet. Write a scene heading to see index cards here.
          </div>
        ) : (
          <>
            {scenes.map((scene, index) => (
              <div
                key={scene.id}
                className={
                  `index-card` +
                  (dragMode ? ' ic-draggable' : '') +
                  (dragIdx === index ? ' ic-dragging' : '')
                }
              >
                {dragMode && (
                  <div
                    className="ic-drag-handle"
                    title="Drag to reorder"
                    onPointerDown={(e) => handleDragHandleDown(e, index)}
                  >
                    &#8942;&#8942;
                  </div>
                )}
                <div
                  className="index-card-color-strip"
                  style={{ backgroundColor: scene.color || '#4a9eff' }}
                />
                <div className="index-card-body">
                  <div className="index-card-top">
                    <span className="index-card-badge">
                      {scene.sceneNumber ?? index + 1}
                    </span>
                    <div
                      className="index-card-heading"
                      onClick={() => !dragMode && goToScene(index)}
                      title={dragMode ? undefined : 'Click to navigate to scene'}
                    >
                      {scene.heading}
                    </div>
                  </div>
                  <textarea
                    className="index-card-synopsis"
                    placeholder="Add synopsis..."
                    value={scene.synopsis}
                    onChange={(e) =>
                      updateSceneSynopsis(scene.id, e.target.value)
                    }
                    rows={3}
                    disabled={dragMode}
                  />
                </div>
              </div>
            ))}
            {/* Drop insertion indicator */}
            {indicatorStyle && (
              <div className="ic-insert-indicator" style={indicatorStyle}>
                <div className="ic-insert-indicator-dot" />
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating drag overlay — exact clone of the dragged card */}
      {dragIdx !== null && dragPos && dragCardHtml && (
        <div
          className="ic-drag-overlay"
          style={{
            left: dragPos.x - dragOffset.x,
            top: dragPos.y - dragOffset.y,
            width: dragCardSize.w,
            height: dragCardSize.h,
          }}
        >
          <div
            className="index-card ic-overlay-card"
            style={{ width: '100%', height: '100%', margin: 0 }}
            dangerouslySetInnerHTML={{ __html: dragCardHtml }}
          />
        </div>
      )}
    </div>
  );
};

export default IndexCards;
