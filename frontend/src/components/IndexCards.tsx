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
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
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

      // Exit fullscreen after navigating
      if (fullscreen) setFullscreen(false);
    },
    [editor, scrollContainer, fullscreen],
  );

  /**
   * Reorder scenes in the actual document by moving all nodes belonging to
   * a scene (from its sceneHeading to the next sceneHeading or end of doc).
   */
  const reorderScenes = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!editor || fromIndex === toIndex) return;

      const { doc, tr, schema } = editor.state;

      // Collect all top-level nodes into scene groups.
      // Each group starts at a sceneHeading and includes all following nodes
      // until the next sceneHeading (or end of doc).
      // Nodes before the first sceneHeading are a "preamble" group.
      type NodeEntry = { node: typeof doc.content.content[0] };
      const preamble: NodeEntry[] = [];
      const sceneGroups: NodeEntry[][] = [];
      let currentGroup: NodeEntry[] | null = null;

      doc.forEach((node) => {
        if (node.type.name === 'sceneHeading') {
          currentGroup = [{ node }];
          sceneGroups.push(currentGroup);
        } else if (currentGroup) {
          currentGroup.push({ node });
        } else {
          preamble.push({ node });
        }
      });

      if (fromIndex >= sceneGroups.length || toIndex >= sceneGroups.length) return;

      // Reorder: remove the moved group and insert at new position
      const [movedGroup] = sceneGroups.splice(fromIndex, 1);
      sceneGroups.splice(toIndex, 0, movedGroup);

      // Rebuild document content in new order
      const newContent = [
        ...preamble.map((e) => e.node),
        ...sceneGroups.flatMap((g) => g.map((e) => e.node)),
      ];

      const newDoc = schema.nodes.doc.create(null, newContent);
      tr.replaceWith(0, doc.content.size, newDoc.content);
      editor.view.dispatch(tr);
    },
    [editor],
  );

  // ── Drag handlers ──
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!dragMode) return;
      setDragIdx(index);
      e.dataTransfer.effectAllowed = 'move';
      // Set a transparent drag image
      const el = e.currentTarget as HTMLElement;
      e.dataTransfer.setDragImage(el, 20, 20);
    },
    [dragMode],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!dragMode || dragIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOverIdx(index);
    },
    [dragMode, dragIdx],
  );

  const handleDragLeave = useCallback(() => {
    setOverIdx(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragIdx !== null && dragIdx !== index) {
        reorderScenes(dragIdx, index);
      }
      setDragIdx(null);
      setOverIdx(null);
    },
    [dragIdx, reorderScenes],
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  if (!indexCardsOpen) return null;

  const containerClass = `index-cards${fullscreen ? ' index-cards-fullscreen' : ''}`;

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
      <div className="index-cards-grid" ref={gridRef}>
        {scenes.length === 0 ? (
          <div className="index-cards-empty">
            No scenes yet. Write a scene heading to see index cards here.
          </div>
        ) : (
          scenes.map((scene, index) => {
            const isDragging = dragIdx === index;
            const isOver = overIdx === index && dragIdx !== index;

            return (
              <div
                key={scene.id}
                className={
                  `index-card` +
                  (dragMode ? ' ic-draggable' : '') +
                  (isDragging ? ' ic-dragging' : '') +
                  (isOver ? ' ic-drag-over' : '')
                }
                draggable={dragMode}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
              >
                {dragMode && (
                  <div className="ic-drag-handle" title="Drag to reorder">
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
            );
          })
        )}
      </div>
    </div>
  );
};

export default IndexCards;
