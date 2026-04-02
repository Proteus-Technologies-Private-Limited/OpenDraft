import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEditorStore, type BeatInfo } from '../stores/editorStore';

const BEAT_COLORS = [
  '', '#4a9eff', '#ff6b6b', '#51cf66', '#ffd43b',
  '#cc5de8', '#ff922b', '#20c997', '#f06595',
];

/* ─── Beat Card Resize Handle (pointer events for mouse + touch) ─── */
const useResizeHandle = (
  onResize: (dw: number, dh: number) => void,
) => {
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = (e.target as HTMLElement).closest('.beat-card') as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      startRef.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };

      const onMove = (ev: PointerEvent) => {
        if (!startRef.current) return;
        onResize(
          Math.max(160, startRef.current.w + (ev.clientX - startRef.current.x)),
          Math.max(80, startRef.current.h + (ev.clientY - startRef.current.y)),
        );
      };
      const onUp = () => {
        startRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [onResize],
  );

  return onPointerDown;
};

/* ─── Column Resize Handle (pointer events for mouse + touch) ─── */
const useColumnResize = (onResize: (width: number) => void) => {
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const col = (e.target as HTMLElement).closest('.beat-column') as HTMLElement;
      if (!col) return;
      startRef.current = { x: e.clientX, w: col.getBoundingClientRect().width };

      const onMove = (ev: PointerEvent) => {
        if (!startRef.current) return;
        onResize(Math.max(200, startRef.current.w + (ev.clientX - startRef.current.x)));
      };
      const onUp = () => {
        startRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [onResize],
  );

  return onPointerDown;
};

/* ─── Shared Beat Card Content (used in both auto and custom modes) ─── */
interface BeatCardContentProps {
  beat: BeatInfo;
  onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
  onDelete: (id: string) => void;
  dragHandleProps?: Record<string, unknown>;
  resizePointerDown: (e: React.PointerEvent) => void;
}

const BeatCardContent: React.FC<BeatCardContentProps> = ({
  beat, onUpdate, onDelete, dragHandleProps, resizePointerDown,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgH = beat.imageHeight || 0;
  const isImgFull = imgH === -1; // -1 = full card

  const cardStyle: React.CSSProperties = {
    ...(beat.color ? { borderLeftColor: beat.color, borderLeftWidth: 4 } : {}),
    ...(beat.cardHeight ? { height: beat.cardHeight, overflow: 'auto' } : {}),
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => onUpdate(beat.id, { imageUrl: reader.result as string });
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [beat.id, onUpdate],
  );

  /* Image resize via bottom-edge drag */
  const imgResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const onImgResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const imgContainer = (e.target as HTMLElement).closest('.beat-card-image') as HTMLElement;
      if (!imgContainer) return;
      imgResizeRef.current = { startY: e.clientY, startH: imgContainer.getBoundingClientRect().height };

      const onMove = (ev: PointerEvent) => {
        if (!imgResizeRef.current) return;
        const newH = Math.max(40, imgResizeRef.current.startH + (ev.clientY - imgResizeRef.current.startY));
        onUpdate(beat.id, { imageHeight: newH });
      };
      const onUp = () => {
        imgResizeRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [beat.id, onUpdate],
  );

  const imgStyle: React.CSSProperties = isImgFull
    ? { flex: 1, maxHeight: 'none' }
    : imgH > 0
      ? { height: imgH, maxHeight: 'none' }
      : {};

  const imgElStyle: React.CSSProperties = isImgFull
    ? { maxHeight: 'none', height: '100%' }
    : imgH > 0
      ? { maxHeight: imgH }
      : {};

  return (
    <div className={`beat-card${isImgFull ? ' beat-card-img-full' : ''}`} style={cardStyle}>
      {/* Drag handle */}
      <div className="beat-card-drag-handle" {...(dragHandleProps || {})}>
        <span className="beat-drag-icon">&#x2630;</span>
      </div>

      {beat.imageUrl && (
        <>
          <div className="beat-card-image" style={imgStyle}>
            <img src={beat.imageUrl} alt="" style={imgElStyle} />
            {!isImgFull && (
              <>
                <div className="beat-card-image-actions">
                  <button
                    className="beat-card-image-action-btn"
                    onClick={() => onUpdate(beat.id, { imageHeight: -1 })}
                    title="Fill card"
                  >&#x229E;</button>
                  {imgH !== 0 && (
                    <button
                      className="beat-card-image-action-btn"
                      onClick={() => onUpdate(beat.id, { imageHeight: 0 })}
                      title="Reset image size"
                    >&#8634;</button>
                  )}
                  <button
                    className="beat-card-image-remove"
                    onClick={() => onUpdate(beat.id, { imageUrl: '', imageHeight: 0 })}
                    title="Remove image"
                  >&times;</button>
                </div>
                <div
                  className="beat-card-image-resize-handle"
                  onPointerDown={onImgResizeDown}
                  style={{ touchAction: 'none' }}
                />
              </>
            )}
          </div>
          {isImgFull && (
            <div className="beat-card-image-actions-floating">
              <button
                className="beat-card-image-action-btn"
                onClick={() => onUpdate(beat.id, { imageHeight: 0 })}
                title="Default size"
              >&#x229F;</button>
              <button
                className="beat-card-image-remove"
                onClick={() => onUpdate(beat.id, { imageUrl: '', imageHeight: 0 })}
                title="Remove image"
              >&times;</button>
            </div>
          )}
        </>
      )}

      {isImgFull ? (
        <div className="beat-card-content-bottom">
          <div className="beat-card-top">
            <input
              className="beat-card-title"
              value={beat.title}
              onChange={(e) => onUpdate(beat.id, { title: e.target.value })}
              placeholder="Beat title..."
            />
            <button className="beat-card-delete" onClick={() => onDelete(beat.id)} title="Delete beat">&times;</button>
          </div>
          <textarea
            className="beat-card-description"
            value={beat.description}
            onChange={(e) => onUpdate(beat.id, { description: e.target.value })}
            placeholder="Describe this beat..."
            rows={2}
          />
        </div>
      ) : (
        <>
          <div className="beat-card-top">
            <input
              className="beat-card-title"
              value={beat.title}
              onChange={(e) => onUpdate(beat.id, { title: e.target.value })}
              placeholder="Beat title..."
            />
            <button className="beat-card-delete" onClick={() => onDelete(beat.id)} title="Delete beat">&times;</button>
          </div>
          <textarea
            className="beat-card-description"
            value={beat.description}
            onChange={(e) => onUpdate(beat.id, { description: e.target.value })}
            placeholder="Describe this beat..."
            rows={3}
          />
        </>
      )}

      <div className="beat-card-toolbar">
        <div className="beat-color-picker-wrap">
          <button
            className="beat-toolbar-btn"
            onClick={() => setShowColorPicker(!showColorPicker)}
            title="Color"
            style={beat.color ? { color: beat.color } : undefined}
          >&#9679;</button>
          {showColorPicker && (
            <div className="beat-color-picker">
              {BEAT_COLORS.map((c) => (
                <button
                  key={c || 'none'}
                  className={`beat-color-swatch${beat.color === c ? ' active' : ''}`}
                  style={c ? { background: c } : undefined}
                  onClick={() => { onUpdate(beat.id, { color: c }); setShowColorPicker(false); }}
                  title={c || 'No color'}
                >{!c && <span className="beat-color-none">&times;</span>}</button>
              ))}
            </div>
          )}
        </div>
        <button className="beat-toolbar-btn" onClick={() => fileInputRef.current?.click()} title="Attach image">&#128247;</button>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        {(beat.cardWidth > 0 || beat.cardHeight > 0) && (
          <button
            className="beat-toolbar-btn"
            onClick={() => onUpdate(beat.id, { cardWidth: 0, cardHeight: 0 })}
            title="Reset size"
          >&#8634;</button>
        )}
      </div>

      {/* Resize handle */}
      <div className="beat-card-resize-handle" onPointerDown={resizePointerDown} style={{ touchAction: 'none' }} />
    </div>
  );
};

/* ─── Sortable Beat Card (auto-arrange mode) ─── */
interface SortableBeatCardProps {
  beat: BeatInfo;
  onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
  onDelete: (id: string) => void;
}

const SortableBeatCard: React.FC<SortableBeatCardProps> = ({ beat, onUpdate, onDelete }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: beat.id });

  const wrapStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    width: beat.cardWidth || undefined,
    flexShrink: 0,
  };

  const handleResize = useCallback(
    (w: number, h: number) => {
      onUpdate(beat.id, { cardWidth: w, cardHeight: h });
    },
    [beat.id, onUpdate],
  );
  const resizePointerDown = useResizeHandle(handleResize);

  return (
    <div ref={setNodeRef} style={wrapStyle} className="beat-card-wrap">
      <BeatCardContent
        beat={beat}
        onUpdate={onUpdate}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
        resizePointerDown={resizePointerDown}
      />
    </div>
  );
};

/* ─── Free-position Beat Card (custom-arrange mode) ─── */
interface FreeBeatCardProps {
  beat: BeatInfo;
  onUpdate: (id: string, updates: Partial<BeatInfo>) => void;
  onDelete: (id: string) => void;
}

const FreeBeatCard: React.FC<FreeBeatCardProps> = ({ beat, onUpdate, onDelete }) => {
  const dragRef = useRef<{ startX: number; startY: number; beatX: number; beatY: number } | null>(null);

  const handleResize = useCallback(
    (w: number, h: number) => {
      onUpdate(beat.id, { cardWidth: w, cardHeight: h });
    },
    [beat.id, onUpdate],
  );
  const resizePointerDown = useResizeHandle(handleResize);

  const bx = beat.x || 0;
  const by = beat.y || 0;

  const onDragPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { startX: e.clientX, startY: e.clientY, beatX: bx, beatY: by };

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const newX = Math.max(0, dragRef.current.beatX + (ev.clientX - dragRef.current.startX));
        const newY = Math.max(0, dragRef.current.beatY + (ev.clientY - dragRef.current.startY));
        onUpdate(beat.id, { x: newX, y: newY });
      };
      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [beat.id, bx, by, onUpdate],
  );

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: bx,
    top: by,
    width: beat.cardWidth || 240,
    zIndex: 1,
  };

  return (
    <div style={wrapStyle} className="beat-card-wrap beat-card-wrap-free">
      <BeatCardContent
        beat={beat}
        onUpdate={onUpdate}
        onDelete={onDelete}
        dragHandleProps={{ onPointerDown: onDragPointerDown, style: { touchAction: 'none', cursor: 'grab' } }}
        resizePointerDown={resizePointerDown}
      />
    </div>
  );
};

/* ─── DragOverlay card ─── */
const BeatCardOverlay: React.FC<{ beat: BeatInfo }> = ({ beat }) => (
  <div className="beat-card beat-card-overlay" style={beat.color ? { borderLeftColor: beat.color, borderLeftWidth: 4 } : {}}>
    <div className="beat-card-drag-handle"><span className="beat-drag-icon">&#x2630;</span></div>
    <div className="beat-card-top"><input className="beat-card-title" value={beat.title} readOnly /></div>
  </div>
);

/* ─── Custom Canvas (free-form mode) ─── */
interface CustomCanvasProps {
  beats: BeatInfo[];
  onUpdateBeat: (id: string, updates: Partial<BeatInfo>) => void;
  onDeleteBeat: (id: string) => void;
}

const CustomCanvas: React.FC<CustomCanvasProps> = ({
  beats, onUpdateBeat, onDeleteBeat,
}) => {
  return (
    <div className="beat-custom-canvas">
      {beats.map((beat) => (
        <FreeBeatCard
          key={beat.id}
          beat={beat}
          onUpdate={onUpdateBeat}
          onDelete={onDeleteBeat}
        />
      ))}
    </div>
  );
};

/* ─── Main Beat Board ─── */
const BeatBoard: React.FC = () => {
  const {
    beats, beatBoardOpen, beatColumns, beatArrangeMode,
    addBeat, updateBeat, deleteBeat, setBeats,
    addBeatColumn, updateBeatColumn, deleteBeatColumn,
    setBeatArrangeMode,
    beatUndo, beatRedo,
  } = useEditorStore();

  const boardRef = useRef<HTMLDivElement>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Undo/redo keyboard shortcut — only when focus is inside the beat board
  useEffect(() => {
    if (!beatBoardOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (!boardRef.current?.contains(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        beatUndo();
      } else if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        beatRedo();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [beatBoardOpen, beatUndo, beatRedo]);

  const sortedColumns = [...beatColumns].sort((a, b) => a.position - b.position);
  const isSingleColumn = sortedColumns.length === 1;

  const handleAddColumn = useCallback(() => {
    addBeatColumn(`Column ${beatColumns.length + 1}`);
  }, [addBeatColumn, beatColumns.length]);

  const handleDragStart = useCallback((e: DragStartEvent) => setActiveDragId(String(e.active.id)), []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeBeat = beats.find((b) => b.id === active.id);
      const overBeat = beats.find((b) => b.id === String(over.id));
      if (activeBeat && overBeat && overBeat.columnId !== activeBeat.columnId) {
        setBeats(beats.map((b) => b.id === activeBeat.id ? { ...b, columnId: overBeat.columnId } : b));
      }
    },
    [beats, setBeats],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeBeat = beats.find((b) => b.id === active.id);
      const overBeat = beats.find((b) => b.id === over.id);
      if (!activeBeat || !overBeat) return;

      const columnId = overBeat.columnId;
      const updated = beats.map((b) => b.id === activeBeat.id ? { ...b, columnId } : b);
      const colBeats = updated.filter((b) => b.columnId === columnId).sort((a, b) => a.position - b.position);
      const oldIdx = colBeats.findIndex((b) => b.id === active.id);
      const newIdx = colBeats.findIndex((b) => b.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(colBeats, oldIdx, newIdx);
      const posMap = new Map(reordered.map((b, i) => [b.id, i]));
      setBeats(updated.map((b) => { const p = posMap.get(b.id); return p !== undefined ? { ...b, position: p } : b; }));
    },
    [beats, setBeats],
  );

  const activeBeat = activeDragId ? beats.find((b) => b.id === activeDragId) : null;

  // Ensure at least one column exists for adding beats in custom mode
  const defaultColumnId = sortedColumns.length > 0 ? sortedColumns[0].id : '';

  const handleAddBeatFree = useCallback(() => {
    const colId = defaultColumnId || addBeatColumn('Column 1');
    const offset = (beats.length % 10) * 30;
    addBeat('New Beat', colId);
    setTimeout(() => {
      const store = useEditorStore.getState();
      const latest = store.beats[store.beats.length - 1];
      if (latest && (latest.x || 0) === 0 && (latest.y || 0) === 0) {
        updateBeat(latest.id, { x: 40 + offset, y: 40 + offset });
      }
    }, 0);
  }, [defaultColumnId, beats.length, addBeat, addBeatColumn, updateBeat]);

  if (!beatBoardOpen) return null;

  return (
    <div className="beat-board" ref={boardRef}>
      <div className="beat-board-header">
        <span className="beat-board-title">Beat Board</span>
        <span className="beat-board-info">
          {beats.length} beat{beats.length !== 1 ? 's' : ''}
        </span>

        {/* Mode toggle */}
        <div className="beat-mode-toggle">
          <button
            className={`beat-mode-btn${beatArrangeMode === 'auto' ? ' active' : ''}`}
            onClick={() => setBeatArrangeMode('auto')}
            title="Auto Arrange — column-based layout"
          >Auto Arrange</button>
          <button
            className={`beat-mode-btn${beatArrangeMode === 'custom' ? ' active' : ''}`}
            onClick={() => setBeatArrangeMode('custom')}
            title="Custom Arrange — free-form placement"
          >Custom</button>
        </div>

        {beatArrangeMode === 'auto' ? (
          <button className="beat-board-add-col-btn" onClick={handleAddColumn}>+ Add Column</button>
        ) : (
          <button className="beat-board-add-col-btn" onClick={handleAddBeatFree}>+ Add Beat</button>
        )}
      </div>

      {beatArrangeMode === 'auto' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="beat-board-columns">
            {sortedColumns.map((col) => {
              const colBeats = beats.filter((b) => b.columnId === col.id).sort((a, b) => a.position - b.position);

              return <BeatColumnView
                key={col.id}
                col={col}
                colBeats={colBeats}
                isSingleColumn={isSingleColumn}
                onUpdateColumn={updateBeatColumn}
                onDeleteColumn={deleteBeatColumn}
                onAddBeat={addBeat}
                onUpdateBeat={updateBeat}
                onDeleteBeat={deleteBeat}
              />;
            })}
          </div>
          <DragOverlay>{activeBeat ? <BeatCardOverlay beat={activeBeat} /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <CustomCanvas
          beats={beats}
          onUpdateBeat={updateBeat}
          onDeleteBeat={deleteBeat}
        />
      )}
    </div>
  );
};

/* ─── Column component with resize handle ─── */
interface BeatColumnViewProps {
  col: { id: string; title: string; width: number };
  colBeats: BeatInfo[];
  isSingleColumn: boolean;
  onUpdateColumn: (id: string, updates: Partial<{ title: string; width: number }>) => void;
  onDeleteColumn: (id: string) => void;
  onAddBeat: (title: string, columnId: string) => void;
  onUpdateBeat: (id: string, updates: Partial<BeatInfo>) => void;
  onDeleteBeat: (id: string) => void;
}

const BeatColumnView: React.FC<BeatColumnViewProps> = ({
  col, colBeats, isSingleColumn,
  onUpdateColumn, onDeleteColumn, onAddBeat, onUpdateBeat, onDeleteBeat,
}) => {
  const colResizePointerDown = useColumnResize((w) => onUpdateColumn(col.id, { width: w }));

  const colStyle: React.CSSProperties = isSingleColumn
    ? { flex: 1, maxWidth: 'none', minWidth: 0 }
    : col.width > 0
      ? { width: col.width, minWidth: 200, maxWidth: 'none', flexShrink: 0 }
      : {};

  return (
    <div className="beat-column" style={colStyle}>
      <div className="beat-column-header">
        <input
          className="beat-column-title-input"
          value={col.title}
          onChange={(e) => onUpdateColumn(col.id, { title: e.target.value })}
          placeholder="Column name..."
        />
        <button className="beat-column-delete" onClick={() => onDeleteColumn(col.id)} title="Delete column">&times;</button>
      </div>
      <SortableContext items={colBeats.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className={`beat-column-cards${isSingleColumn ? ' beat-column-cards-wrap' : ''}`}>
          {colBeats.map((beat) => (
            <SortableBeatCard key={beat.id} beat={beat} onUpdate={onUpdateBeat} onDelete={onDeleteBeat} />
          ))}
        </div>
      </SortableContext>
      <button className="beat-add-btn" onClick={() => onAddBeat('New Beat', col.id)}>+ Add Beat</button>
      {/* Column resize handle (right edge) */}
      {!isSingleColumn && <div className="beat-column-resize-handle" onPointerDown={colResizePointerDown} style={{ touchAction: 'none' }} />}
    </div>
  );
};

export default BeatBoard;
