/**
 * The Outline Editor: the whole script as structure.
 *
 * Acts, sequences and Fountain sections, with their scenes in order. A scene
 * row shows its number, heading, synopsis and length in pages; clicking it
 * opens the scene in the editor. Rows can be dragged to reorder scenes, and the
 * header adds an act break, a sequence or a section.
 *
 * This is the dedicated view ScriptCraft calls Outline and Final Draft calls
 * the Outline Editor. It reads the same structure data as the Navigator's
 * Structure tab (`utils/scriptStructure`); it does not keep a second model.
 *
 * A script can have acts and Sections at once, and they cut across each other:
 * a scene belongs to one act and to one Section. Showing both trees with their
 * scenes would list every scene twice, so the header switches between the two
 * views; only the one selected draws scene rows.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaPlus, FaPen, FaTimes, FaTrashAlt } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { activeTemplateHints, computeSceneLengths } from '../editor/pagination';
import { computeScriptStructure, type StructureScene } from '../utils/scriptStructure';
import { reorderScene } from '../editor/sceneReorder';

interface Props {
  editor: Editor | null;
}

interface SequenceInfo {
  id: string;
  name: string;
  color: string;
}

/** Absolute ProseMirror position of the nth scene heading. */
function sceneHeadingPos(editor: Editor, sceneIndex: number): number | null {
  let index = -1;
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'sceneHeading') {
      index++;
      if (index === sceneIndex) {
        found = pos;
        return false;
      }
    }
    return true;
  });
  return found;
}

/** The scene the caret is in, or the first one. */
function currentSceneIndex(editor: Editor): number | null {
  let index = -1;
  let current = -1;
  let last = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'sceneHeading') {
      index++;
      last = index;
      if (pos < editor.state.selection.from) current = index;
    }
    return true;
  });
  return current >= 0 ? current : (last >= 0 ? 0 : null);
}

const OutlineView: React.FC<Props> = ({ editor }) => {
  const setOutlineOpen = useEditorStore((s) => s.toggleOutline);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const scenes = useEditorStore((s) => s.scenes);
  const [version, setVersion] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [mode, setMode] = useState<'acts' | 'sections'>('acts');
  const [editingSequence, setEditingSequence] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    editor.on('selectionUpdate', bump);
    return () => {
      editor.off('update', bump);
      editor.off('selectionUpdate', bump);
    };
  }, [editor]);

  const structure = useMemo(() => {
    if (!editor) return null;
    try {
      return computeScriptStructure(editor.getJSON());
    } catch {
      return null;
    }
  }, [editor, version]);

  const lengths = useMemo(() => {
    if (!editor) return [];
    try {
      return computeSceneLengths(editor.state.doc, pageLayout, activeTemplateHints());
    } catch {
      return [];
    }
  }, [editor, pageLayout, version, scenes]);

  /** Every sequence label used by a scene, in first-use order. */
  const sequences = useMemo<SequenceInfo[]>(() => {
    const found = new Map<string, SequenceInfo>();
    for (const act of structure?.acts ?? []) {
      for (const scene of act.scenes) {
        if (scene.sequenceId && !found.has(scene.sequenceId)) {
          found.set(scene.sequenceId, {
            id: scene.sequenceId,
            name: scene.sequenceName || 'Untitled Sequence',
            color: scene.sequenceColor || '#64748b',
          });
        }
      }
    }
    return [...found.values()];
  }, [structure]);

  const close = useCallback(() => setOutlineOpen(), [setOutlineOpen]);

  const goToScene = useCallback((sceneIndex: number) => {
    if (!editor) return;
    if (sceneHeadingPos(editor, sceneIndex) === null) return;
    // The Outline stands in for the script: close it first, then move the
    // caret once the editor is back on screen. Scrolling while it is hidden
    // leaves the rebuilt editor at the top. The editor's DOM is re-attached a
    // frame or two after the Outline unmounts, so wait until it is connected
    // before scrolling.
    close();
    let attempts = 0;
    const reveal = () => {
      if (editor.isDestroyed) return;
      const pos = sceneHeadingPos(editor, sceneIndex);
      if (pos === null) return;
      const heading = editor.view.nodeDOM(pos) as HTMLElement | null;
      const container = heading?.closest('.editor-main') as HTMLElement | null;
      if (!heading || !heading.isConnected || !container || container.clientHeight === 0) {
        if (attempts++ < 30) requestAnimationFrame(reveal);
        return;
      }
      try {
        editor.chain().focus().setTextSelection(pos + 1).run();
        heading.scrollIntoView({ block: 'center' });
      } catch (err) {
        console.error('[Outline] could not go to the scene', err);
      }
    };
    setTimeout(() => requestAnimationFrame(reveal), 0);
  }, [editor, close]);

  const insertAtSelection = useCallback((content: Record<string, unknown>) => {
    if (!editor) return;
    const index = currentSceneIndex(editor);
    const pos = index === null ? null : sceneHeadingPos(editor, index);
    editor.chain().focus()
      .insertContentAt(pos ?? editor.state.doc.content.size, content)
      .run();
  }, [editor]);

  const addAct = useCallback(() => {
    insertAtSelection({ type: 'newAct' });
  }, [insertAtSelection]);

  const addSection = useCallback(() => {
    insertAtSelection({
      type: 'section',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'New Section' }],
    });
  }, [insertAtSelection]);

  /** Put a sequence label on one scene (or take it off). */
  const setSceneSequence = useCallback((sceneIndex: number, sequence: SequenceInfo | null) => {
    if (!editor) return;
    const pos = sceneHeadingPos(editor, sceneIndex);
    if (pos === null) return;
    const tr = editor.state.tr;
    tr.setNodeAttribute(pos, 'sequenceId', sequence?.id ?? null);
    tr.setNodeAttribute(pos, 'sequenceName', sequence?.name ?? null);
    tr.setNodeAttribute(pos, 'sequenceColor', sequence?.color ?? null);
    editor.view.dispatch(tr);
  }, [editor]);

  /** Rename every scene of a sequence, or clear the label from all of them. */
  const updateSequence = useCallback((id: string, name: string | null) => {
    if (!editor) return;
    const tr = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'sceneHeading' || node.attrs?.sequenceId !== id) return true;
      if (name === null) {
        tr.setNodeAttribute(pos, 'sequenceId', null);
        tr.setNodeAttribute(pos, 'sequenceName', null);
        tr.setNodeAttribute(pos, 'sequenceColor', null);
      } else {
        tr.setNodeAttribute(pos, 'sequenceName', name);
      }
      changed = true;
      return true;
    });
    if (changed) editor.view.dispatch(tr);
  }, [editor]);

  const addSequence = useCallback(() => {
    if (!editor) return;
    const target = currentSceneIndex(editor);
    if (target === null) return;
    const id = `seq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setSceneSequence(target, {
      id,
      name: `Sequence ${sequences.length + 1}`,
      color: '#64748b',
    });
  }, [editor, sequences.length, setSceneSequence]);

  const commitRename = useCallback(() => {
    if (!editingSequence) return;
    const name = editingSequence.name.trim();
    if (name) updateSequence(editingSequence.id, name);
    setEditingSequence(null);
  }, [editingSequence, updateSequence]);

  const sceneRow = (scene: StructureScene) => {
    const info = scenes[scene.sceneIndex];
    const pageLength = lengths[scene.sceneIndex] ?? 0;
    return (
      <div
        key={`scene-${scene.sceneIndex}`}
        className={`outline-row outline-scene${dragFrom === scene.sceneIndex ? ' dragging' : ''}`}
        draggable
        onDragStart={() => setDragFrom(scene.sceneIndex)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (editor && dragFrom !== null && dragFrom !== scene.sceneIndex) {
            reorderScene(editor, dragFrom, scene.sceneIndex);
          }
          setDragFrom(null);
        }}
        onDragEnd={() => setDragFrom(null)}
        onClick={() => goToScene(scene.sceneIndex)}
      >
        <span className="outline-grip" aria-hidden="true">⠿</span>
        <span className="outline-num">{info?.sceneNumber ?? scene.sceneIndex + 1}</span>
        <div className="outline-scene-text">
          <div className="outline-heading">{info?.heading ?? scene.heading}</div>
          {info?.synopsis ? <div className="outline-synopsis">{info.synopsis}</div> : null}
        </div>
        {sequences.length > 0 && (
          <select
            className="outline-seq-select"
            title="Sequence"
            aria-label={`Sequence for scene ${scene.sceneIndex + 1}`}
            value={scene.sequenceId ?? ''}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const sequence = sequences.find((s) => s.id === e.target.value) ?? null;
              setSceneSequence(scene.sceneIndex, sequence);
            }}
          >
            <option value="">—</option>
            {sequences.map((sequence) => (
              <option key={sequence.id} value={sequence.id}>{sequence.name}</option>
            ))}
          </select>
        )}
        {pageLength > 0 && <span className="outline-pages">{pageLength.toFixed(1)}p</span>}
      </div>
    );
  };

  const sequenceHeader = (scene: StructureScene) => {
    const id = scene.sequenceId;
    if (!id) return null;
    const name = scene.sequenceName || sequences.find((s) => s.id === id)?.name || 'Untitled Sequence';
    const color = scene.sequenceColor || sequences.find((s) => s.id === id)?.color || '#64748b';
    const editing = editingSequence?.id === id;
    return (
      <div key={`sequence-${id}-${scene.sceneIndex}`} className="outline-row outline-sequence-row">
        <span className="outline-dot" style={{ background: color }} />
        {editing ? (
          <input
            className="outline-seq-input"
            aria-label="Sequence name"
            autoFocus
            value={editingSequence.name}
            onChange={(e) => setEditingSequence({ id, name: e.target.value })}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingSequence(null); }
            }}
          />
        ) : (
          <span className="outline-seq-name">{name}</span>
        )}
        <span className="outline-seq-actions">
          <button
            type="button"
            className="outline-seq-action"
            title="Rename sequence"
            onClick={(e) => { e.stopPropagation(); setEditingSequence({ id, name }); }}
          >
            <FaPen />
          </button>
          <button
            type="button"
            className="outline-seq-action"
            title="Delete sequence (undoable)"
            onClick={(e) => { e.stopPropagation(); updateSequence(id, null); }}
          >
            <FaTrashAlt />
          </button>
        </span>
      </div>
    );
  };

  /**
   * Scene rows in script order, with a sequence heading whenever the label
   * changes. The old outline listed a sequence's scenes first and the rest
   * after it, which broke the order of the script.
   */
  const sceneRows = (list: StructureScene[]) => {
    const rows: React.ReactNode[] = [];
    let previousSequence: string | null = null;
    for (const scene of list) {
      if (scene.sequenceId && scene.sequenceId !== previousSequence) rows.push(sequenceHeader(scene));
      previousSequence = scene.sequenceId;
      rows.push(sceneRow(scene));
    }
    return rows;
  };

  const actBlock = (act: NonNullable<typeof structure>['acts'][number]) => {
    if (act.actNumber === 0 && act.scenes.length === 0) return null;
    return (
      <section key={`act-${act.actNumber}-${act.docPos}`} className="outline-act">
        <div className="outline-row outline-act-row">
          <span className="outline-act-name">
            {act.customName || act.actName || (act.actNumber ? `ACT ${act.actNumber}` : 'PROLOGUE')}
          </span>
        </div>
        {sceneRows(act.scenes)}
      </section>
    );
  };

  const sectionBlock = (section: NonNullable<typeof structure>['sections'][number], depth = 0) => (
    <div key={`section-${section.sectionIndex}`} className="outline-section" style={{ marginLeft: depth * 16 }}>
      <div className="outline-row outline-section-row">
        <span className="outline-section-level">{'#'.repeat(section.level)}</span>
        <span>{section.title || 'Untitled section'}</span>
      </div>
      {section.synopsis ? <div className="outline-synopsis outline-section-synopsis">{section.synopsis}</div> : null}
      {sceneRows(section.scenes)}
      {section.children.map((child) => sectionBlock(child, depth + 1))}
    </div>
  );

  if (!editor) return null;

  const hasActs = structure?.acts.some((act) => act.actNumber > 0) ?? false;
  const hasSections = (structure?.sections.length ?? 0) > 0;
  // Without acts there is no act tree; without Sections there is no section
  // tree. Only show the switch when both exist, and never both at once.
  const activeMode: 'acts' | 'sections' = hasActs ? mode : 'sections';
  const allScenes = structure ? structure.acts.flatMap((act) => act.scenes) : [];

  return (
    <div className="outline-view">
      <div className="outline-header">
        <span className="outline-title">Outline</span>
        {hasActs && hasSections && (
          <div className="outline-modes" role="tablist" aria-label="Outline view">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'acts'}
              className={`outline-mode${activeMode === 'acts' ? ' active' : ''}`}
              onClick={() => setMode('acts')}
            >
              Acts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'sections'}
              className={`outline-mode${activeMode === 'sections' ? ' active' : ''}`}
              onClick={() => setMode('sections')}
            >
              Sections
            </button>
          </div>
        )}
        <div className="outline-actions">
          <button className="outline-action" onClick={addAct}><FaPlus /> Act</button>
          <button
            className="outline-action"
            onClick={addSequence}
            disabled={(structure?.totalScenes ?? 0) === 0}
            title={(structure?.totalScenes ?? 0) === 0 ? 'Write a scene first' : 'Tag the current scene with a new sequence'}
          >
            <FaPlus /> Sequence
          </button>
          <button className="outline-action" onClick={addSection}><FaPlus /> Section</button>
          <button className="outline-close" onClick={close} title="Close Outline"><FaTimes /></button>
        </div>
      </div>
      <div className="outline-body">
        {!structure || structure.totalScenes === 0 ? (
          <p className="outline-empty">No scenes yet. Write a scene heading, or add an act, sequence or section.</p>
        ) : activeMode === 'sections' && hasSections ? (
          <section className="outline-sections">
            {structure.sections.map((section) => sectionBlock(section))}
          </section>
        ) : hasActs ? (
          structure.acts.map(actBlock)
        ) : (
          // No acts and no Sections: one flat list, with no invented PROLOGUE.
          sceneRows(allScenes)
        )}
      </div>
    </div>
  );
};

export default OutlineView;
