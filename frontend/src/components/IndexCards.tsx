import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { Editor } from '@tiptap/react';
import { useEditorStore, type SceneInfo } from '../stores/editorStore';
import { computeSceneLengths } from '../editor/pagination';
import { computeSceneTiming, formatSceneDuration, getTimingColor } from '../utils/scriptTiming';
import SynopsisModal from './SynopsisModal';

interface IndexCardsProps {
  editor: Editor | null;
  scrollContainer: HTMLDivElement | null;
}

const IndexCards: React.FC<IndexCardsProps> = ({ editor, scrollContainer }) => {
  const { scenes, indexCardsOpen, updateSceneSynopsis, updateSceneColor, toggleIndexCards, pageLayout } = useEditorStore();

  const [fullscreen, setFullscreen] = useState(false);
  const [dragMode, setDragMode] = useState(false);

  // Deferred reorder state: pending changes are visual-only until Apply
  const [pendingScenes, setPendingScenes] = useState<SceneInfo[] | null>(null);
  const [originalScenes, setOriginalScenes] = useState<SceneInfo[] | null>(null);

  // Undo/redo history for reorder operations
  const historyRef = useRef<{ stack: SceneInfo[][]; pointer: number }>({ stack: [], pointer: -1 });
  const [, setHistoryVersion] = useState(0); // trigger re-renders on undo/redo

  const canUndo = dragMode && historyRef.current.pointer > 0;
  const canRedo = dragMode && historyRef.current.pointer < historyRef.current.stack.length - 1;

  const pushHistory = useCallback((state: SceneInfo[]) => {
    const h = historyRef.current;
    // Truncate any redo states
    h.stack = h.stack.slice(0, h.pointer + 1);
    h.stack.push(state);
    h.pointer = h.stack.length - 1;
    setHistoryVersion(v => v + 1);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.pointer <= 0) return;
    h.pointer--;
    setPendingScenes(h.stack[h.pointer]);
    setHistoryVersion(v => v + 1);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.pointer >= h.stack.length - 1) return;
    h.pointer++;
    setPendingScenes(h.stack[h.pointer]);
    setHistoryVersion(v => v + 1);
  }, []);

  // Keyboard shortcuts for undo/redo in reorder mode
  useEffect(() => {
    if (!dragMode) return;
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        undo();
      } else if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        redo();
      } else if (mod && e.key === 'y') {
        e.preventDefault();
        e.stopImmediatePropagation();
        redo();
      }
    };
    // Capture phase fires before ProseMirror's editor keymap handlers
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [dragMode, undo, redo]);

  // Custom drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [insertIdx, setInsertIdx] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragCardSize, setDragCardSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dragCardHtml, setDragCardHtml] = useState<string>('');
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll refs for drag
  const scrollSpeedRef = useRef(0);
  const scrollRafRef = useRef<number>(0);
  const lastClientPosRef = useRef<{ x: number; y: number } | null>(null);

  // Synopsis modal state
  const [synopsisModal, setSynopsisModal] = useState<{ sceneIdx: number; id: string; heading: string; synopsis: string; color: string } | null>(null);

  const handleSaveSynopsis = useCallback(
    (synopsis: string, color: string, timingOverride?: number | null) => {
      if (!synopsisModal || !editor) return;
      const { sceneIdx, id } = synopsisModal;
      updateSceneSynopsis(id, synopsis);
      updateSceneColor(id, color);
      let currentScene = -1;
      let targetPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading') {
          currentScene++;
          if (currentScene === sceneIdx) { targetPos = pos; return false; }
        }
        return true;
      });
      if (targetPos >= 0) {
        const node = editor.state.doc.nodeAt(targetPos);
        if (node) {
          const { tr } = editor.state;
          const newAttrs = { ...node.attrs, synopsis, sceneColor: color, timingOverride: timingOverride ?? null };
          tr.setNodeMarkup(targetPos, undefined, newAttrs);
          tr.setMeta('addToHistory', false);
          editor.view.dispatch(tr);
        }
      }
    },
    [synopsisModal, editor, updateSceneSynopsis],
  );

  // The cards to display: pending order during reorder mode, otherwise live scenes
  const displayScenes = pendingScenes ?? scenes;

  // Whether there are pending changes to apply
  const hasChanges = pendingScenes && originalScenes &&
    pendingScenes.some((s, i) => s.id !== originalScenes[i]?.id);

  // Scene page lengths and timing
  const sceneLengths = useMemo(() => {
    if (!editor) return [];
    try { return computeSceneLengths(editor.state.doc, pageLayout); } catch { return []; }
  }, [editor, scenes, pageLayout]);

  const sceneTimings = useMemo(() => {
    if (!editor) return [];
    try { return computeSceneTiming(editor.getJSON()).scenes; } catch { return []; }
  }, [editor, scenes]);

  // Map from scene ID to its original 1-based position (for showing "was #N")
  const originalIndexMap = useRef(new Map<string, number>());

  // Update synopsis on the sceneHeading node attribute so it persists in the document
  const updateSynopsisAttr = useCallback(
    (sceneId: string, synopsis: string) => {
      if (!editor) return;
      // Extract 1-based index from scene ID (e.g. "scene-3" → 2)
      const sceneIndex = parseInt(sceneId.replace('scene-', ''), 10) - 1;
      if (isNaN(sceneIndex) || sceneIndex < 0) return;

      let currentScene = -1;
      let targetPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading') {
          currentScene++;
          if (currentScene === sceneIndex) {
            targetPos = pos;
            return false;
          }
        }
        return true;
      });

      if (targetPos >= 0) {
        const node = editor.state.doc.nodeAt(targetPos);
        if (node) {
          const { tr } = editor.state;
          tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, synopsis });
          tr.setMeta('addToHistory', false);
          editor.view.dispatch(tr);
        }
      }
    },
    [editor],
  );

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

  // ── Enter / Cancel / Apply reorder mode ──

  const enterReorderMode = useCallback(() => {
    const snapshot = [...scenes];
    setPendingScenes(snapshot);
    setOriginalScenes(snapshot);
    // Build original index map
    const map = new Map<string, number>();
    snapshot.forEach((s, i) => map.set(s.id, i + 1));
    originalIndexMap.current = map;
    // Initialize history with the original state
    historyRef.current = { stack: [snapshot], pointer: 0 };
    setHistoryVersion(0);
    setDragMode(true);
  }, [scenes]);

  const cancelReorder = useCallback(() => {
    setPendingScenes(null);
    setOriginalScenes(null);
    originalIndexMap.current = new Map();
    historyRef.current = { stack: [], pointer: -1 };
    setDragMode(false);
  }, []);

  const applyReorder = useCallback(() => {
    if (!editor || !pendingScenes || !originalScenes) {
      cancelReorder();
      return;
    }

    // Check if order actually changed
    const changed = pendingScenes.some((s, i) => s.id !== originalScenes[i]?.id);
    if (!changed) {
      cancelReorder();
      return;
    }

    const ranges = getSceneRanges();
    if (ranges.length === 0 || ranges.length !== originalScenes.length) {
      cancelReorder();
      return;
    }

    const { doc, tr } = editor.state;
    const sceneStart = ranges[0].from;
    const sceneEnd = ranges[ranges.length - 1].to;

    // Map original scene ID → original index in the document
    const idToOrigIdx = new Map<string, number>();
    originalScenes.forEach((s, i) => idToOrigIdx.set(s.id, i));

    // Extract slices for each scene from the document
    const sliceContents = ranges.map(r => doc.slice(r.from, r.to).content);

    // Build new order: for each scene in pendingScenes, get the original doc content
    const nodes: any[] = [];
    for (const scene of pendingScenes) {
      const origIdx = idToOrigIdx.get(scene.id);
      if (origIdx === undefined) continue;
      sliceContents[origIdx].forEach((node: any) => nodes.push(node));
    }

    // Replace the scene portion of the document
    tr.replaceWith(sceneStart, sceneEnd, nodes);
    editor.view.dispatch(tr);

    // Clean up
    setPendingScenes(null);
    setOriginalScenes(null);
    originalIndexMap.current = new Map();
    historyRef.current = { stack: [], pointer: -1 };
    setDragMode(false);
  }, [editor, pendingScenes, originalScenes, getSceneRanges, cancelReorder]);

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
  const pendingScenesRef = useRef(pendingScenes);
  pendingScenesRef.current = pendingScenes;
  const pushHistoryRef = useRef(pushHistory);
  pushHistoryRef.current = pushHistory;

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
      scrollSpeedRef.current = 0;
      lastClientPosRef.current = { x: e.clientX, y: e.clientY };

      // Auto-scroll loop: runs every frame while dragging, applies current speed
      const scrollLoop = () => {
        const container = containerRef.current;
        if (container && scrollSpeedRef.current !== 0) {
          container.scrollTop += scrollSpeedRef.current;
          // Recalculate insert index since visible cards shifted
          if (lastClientPosRef.current) {
            const gap = calcInsertIndexRef.current(lastClientPosRef.current.x, lastClientPosRef.current.y);
            setInsertIdx(gap);
          }
        }
        scrollRafRef.current = requestAnimationFrame(scrollLoop);
      };
      scrollRafRef.current = requestAnimationFrame(scrollLoop);

      const cleanup = () => {
        handle.removeEventListener('pointermove', handleMove);
        handle.removeEventListener('pointerup', handleUp);
        handle.removeEventListener('pointercancel', handleUp);
        handle.releasePointerCapture(e.pointerId);
        cancelAnimationFrame(scrollRafRef.current);
        scrollSpeedRef.current = 0;
        lastClientPosRef.current = null;
        document.body.style.cursor = '';
        setDragIdx(null);
        setInsertIdx(null);
        setDragPos(null);
      };

      const handleMove = (ev: PointerEvent) => {
        ev.preventDefault();
        setDragPos({ x: ev.clientX, y: ev.clientY });
        lastClientPosRef.current = { x: ev.clientX, y: ev.clientY };
        const gap = calcInsertIndexRef.current(ev.clientX, ev.clientY);
        setInsertIdx(gap);

        // Compute auto-scroll speed based on proximity to container edges
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const EDGE = 60; // px from edge to trigger
          const MAX = 12;  // max px per frame
          if (ev.clientY < rect.top + EDGE) {
            const t = 1 - Math.max(0, ev.clientY - rect.top) / EDGE;
            scrollSpeedRef.current = -(t * MAX);
          } else if (ev.clientY > rect.bottom - EDGE) {
            const t = 1 - Math.max(0, rect.bottom - ev.clientY) / EDGE;
            scrollSpeedRef.current = t * MAX;
          } else {
            scrollSpeedRef.current = 0;
          }
        }
      };

      const handleUp = (ev: PointerEvent) => {
        const gap = calcInsertIndexRef.current(ev.clientX, ev.clientY);
        cleanup();

        if (gap !== null && pendingScenesRef.current) {
          let toIndex = gap;
          if (index < gap && gap <= pendingScenesRef.current.length - 1) toIndex--;
          if (toIndex !== index) {
            // Reorder pendingScenes locally — no editor changes yet
            const updated = [...pendingScenesRef.current];
            const [moved] = updated.splice(index, 1);
            updated.splice(toIndex, 0, moved);
            setPendingScenes(updated);
            pushHistoryRef.current(updated);
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
    const totalScenes = (pendingScenesRef.current ?? []).length;
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
    <div className={containerClass} ref={containerRef}>
      <div className="index-cards-header">
        <span className="index-cards-title">Index Cards</span>
        <span className="index-cards-count">{scenes.length} scenes</span>
        <div className="index-cards-actions">
          {dragMode ? (
            <>
              <button
                className="ic-action-btn ic-undo-redo-btn"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7h7a4 4 0 0 1 0 8H7" />
                  <path d="M6 4L3 7l3 3" />
                </svg>
              </button>
              <button
                className="ic-action-btn ic-undo-redo-btn"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 7H6a4 4 0 0 0 0 8h3" />
                  <path d="M10 4l3 3-3 3" />
                </svg>
              </button>
              <button
                className="ic-action-btn"
                onClick={cancelReorder}
                title="Cancel reorder"
              >
                Cancel
              </button>
              <button
                className={`ic-action-btn ic-apply-btn${hasChanges ? ' active' : ''}`}
                onClick={applyReorder}
                title={hasChanges ? 'Apply scene reorder to screenplay' : 'No changes to apply'}
                disabled={!hasChanges}
              >
                Apply
              </button>
            </>
          ) : (
            <button
              className="ic-action-btn"
              onClick={enterReorderMode}
              title="Enter drag-drop mode"
            >
              Reorder
            </button>
          )}
          <button
            className="ic-action-btn ic-fullscreen-btn"
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="9,1 9,5 13,5" /><line x1="13" y1="1" x2="9" y2="5" />
                <polyline points="5,13 5,9 1,9" /><line x1="1" y1="13" x2="5" y2="9" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="9,1 13,1 13,5" /><line x1="8" y1="6" x2="13" y2="1" />
                <polyline points="5,13 1,13 1,9" /><line x1="6" y1="8" x2="1" y2="13" />
              </svg>
            )}
          </button>
          <button
            className="ic-action-btn ic-close-btn"
            onClick={() => { if (fullscreen) setFullscreen(false); toggleIndexCards(); }}
            title="Close Index Cards"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="index-cards-grid" ref={gridRef} style={{ position: 'relative' }}>
        {displayScenes.length === 0 ? (
          <div className="index-cards-empty">
            No scenes yet. Write a scene heading to see index cards here.
          </div>
        ) : (
          <>
            {displayScenes.map((scene, index) => {
              const origNum = originalIndexMap.current.get(scene.id);
              const newNum = index + 1;
              const movedUp = dragMode && origNum !== undefined && newNum < origNum;
              const movedDown = dragMode && origNum !== undefined && newNum > origNum;

              return (
                <div
                  key={scene.id}
                  className={
                    `index-card` +
                    (dragMode ? ' ic-draggable' : '') +
                    (dragIdx === index ? ' ic-dragging' : '') +
                    (movedUp ? ' ic-moved-up' : '') +
                    (movedDown ? ' ic-moved-down' : '')
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
                    style={{ backgroundColor: scene.color || 'var(--fd-text-muted)' }}
                  />
                  <div className="index-card-body">
                    <div className="index-card-top">
                      <span className="index-card-badge" style={scene.color ? { background: scene.color, borderColor: scene.color } : undefined}>
                        {(movedUp || movedDown) ? (
                          <><span className="ic-orig-num">{origNum}</span> → {newNum}</>
                        ) : (
                          scene.sceneNumber ?? newNum
                        )}
                      </span>
                      <div
                        className="index-card-heading"
                        onClick={() => !dragMode && goToScene(index)}
                        title={dragMode ? undefined : 'Click to navigate to scene'}
                      >
                        {scene.heading}
                      </div>
                      {(sceneLengths[index] > 0 || sceneTimings[index]?.finalSeconds > 0) && (
                        <div className="index-card-meta">
                          {sceneLengths[index] > 0 && (
                            <span className="ic-meta-item">{Number(sceneLengths[index].toFixed(1))}p</span>
                          )}
                          {sceneTimings[index]?.finalSeconds > 0 && (
                            <span className="ic-meta-item" style={{ color: getTimingColor(sceneTimings[index].finalSeconds) }}>
                              {formatSceneDuration(sceneTimings[index].finalSeconds)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="index-card-synopsis-wrap">
                      <textarea
                        className="index-card-synopsis"
                        placeholder="Add synopsis..."
                        value={scene.synopsis}
                        onChange={(e) => {
                          updateSceneSynopsis(scene.id, e.target.value);
                          updateSynopsisAttr(scene.id, e.target.value);
                        }}
                        rows={3}
                        disabled={dragMode}
                      />
                      <button
                        className="ic-synopsis-expand"
                        onClick={() => setSynopsisModal({ sceneIdx: index, id: scene.id, heading: scene.heading, synopsis: scene.synopsis, color: scene.color })}
                        title="Expand synopsis"
                        disabled={dragMode}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                          <polyline points="7,1 11,1 11,5" />
                          <line x1="11" y1="1" x2="6.5" y2="5.5" />
                          <polyline points="5,11 1,11 1,7" />
                          <line x1="1" y1="11" x2="5.5" y2="6.5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Drop insertion indicator */}
            {indicatorStyle && (
              <div className="ic-insert-indicator" style={indicatorStyle}>
                <div className="ic-insert-indicator-dot" />
              </div>
            )}
          </>
        )}
      </div>

      {/* Synopsis modal */}
      {synopsisModal && (
        <SynopsisModal
          sceneHeading={synopsisModal.heading}
          synopsis={synopsisModal.synopsis}
          sceneColor={synopsisModal.color}
          pageLength={sceneLengths[synopsisModal.sceneIdx]}
          autoTimingSeconds={sceneTimings[synopsisModal.sceneIdx]?.autoEstimateSeconds}
          timingOverride={sceneTimings[synopsisModal.sceneIdx]?.overrideSeconds}
          onSave={handleSaveSynopsis}
          onClose={() => setSynopsisModal(null)}
        />
      )}

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
