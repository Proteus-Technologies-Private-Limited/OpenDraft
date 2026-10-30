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
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { activeTemplateHints, computeSceneLengths } from '../editor/pagination';
import { computeScriptStructure, type StructureScene } from '../utils/scriptStructure';
import { reorderScene } from '../editor/sceneReorder';

interface Props {
  editor: Editor | null;
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

  const close = useCallback(() => setOutlineOpen(), [setOutlineOpen]);

  const goToScene = useCallback((sceneIndex: number) => {
    if (!editor) return;
    const pos = sceneHeadingPos(editor, sceneIndex);
    if (pos === null) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    close();
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

  const addSequence = useCallback(() => {
    if (!editor) return;
    const existing = (editor.getJSON().attrs?.sequences as Array<{ id: string; name: string; color?: string }> | undefined) ?? [];
    const id = `seq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = `Sequence ${existing.length + 1}`;
    const index = currentSceneIndex(editor);
    editor.chain().focus().command(({ tr }) => {
      tr.setDocAttribute('sequences', [...existing, { id, name, color: '#64748b' }]);
      if (index !== null) {
        const pos = sceneHeadingPos(editor, index);
        if (pos !== null) tr.setNodeAttribute(pos, 'sequenceId', id);
      }
      return true;
    }).run();
  }, [editor]);

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
        {pageLength > 0 && <span className="outline-pages">{pageLength.toFixed(1)}p</span>}
      </div>
    );
  };

  const sceneList = (list: StructureScene[]) => list.map(sceneRow);

  const actBlock = (act: NonNullable<typeof structure>['acts'][number]) => {
    if (act.actNumber === 0 && act.scenes.length === 0) return null;
    return (
      <section key={`act-${act.actNumber}-${act.docPos}`} className="outline-act">
        <div className="outline-row outline-act-row">
          <span className="outline-act-name">
            {act.customName || act.actName || (act.actNumber ? `ACT ${act.actNumber}` : 'PROLOGUE')}
          </span>
        </div>
        {act.sequences.map((sequence) => (
          <div key={sequence.id} className="outline-sequence">
            <div className="outline-row outline-sequence-row">
              <span className="outline-dot" style={{ background: sequence.color }} />
              <span>{sequence.name}</span>
            </div>
            {sceneList(sequence.scenes)}
          </div>
        ))}
        {sceneList(act.orphanScenes)}
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
      {sceneList(section.scenes)}
      {section.children.map((child) => sectionBlock(child, depth + 1))}
    </div>
  );

  if (!editor) return null;

  const actScenes = structure ? structure.acts.flatMap((act) => act.scenes) : [];
  const hasStructure = (structure?.acts.some((act) => act.actNumber > 0) ?? false)
    || (structure?.sections.length ?? 0) > 0;

  return (
    <div className="outline-view">
      <div className="outline-header">
        <span className="outline-title">Outline</span>
        <div className="outline-actions">
          <button className="outline-action" onClick={addAct}><FaPlus /> Act</button>
          <button className="outline-action" onClick={addSequence}><FaPlus /> Sequence</button>
          <button className="outline-action" onClick={addSection}><FaPlus /> Section</button>
          <button className="outline-close" onClick={close} title="Close Outline"><FaTimes /></button>
        </div>
      </div>
      <div className="outline-body">
        {!structure || structure.totalScenes === 0 ? (
          <p className="outline-empty">No scenes yet. Write a scene heading, or add an act, sequence or section.</p>
        ) : (
          <>
            {hasStructure
              ? structure.acts.map(actBlock)
              : sceneList(actScenes)}
            {structure.sections.length > 0 && (
              <section className="outline-sections">
                <div className="outline-row outline-act-row"><span className="outline-act-name">Sections</span></div>
                {structure.sections.map((section) => sectionBlock(section))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OutlineView;
