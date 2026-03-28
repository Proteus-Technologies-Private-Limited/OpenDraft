import React, { useMemo, useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';

interface BeatBoardProps {
  editor: Editor | null;
}

const BeatBoard: React.FC<BeatBoardProps> = ({ editor }) => {
  const { beats, beatBoardOpen, scenes, addBeat, updateBeat, deleteBeat } =
    useEditorStore();

  // Detect acts from the document (newAct nodes). If none, use a single default act.
  const acts = useMemo(() => {
    if (!editor) return [{ index: 0, title: 'Act 1' }];

    const found: { index: number; title: string }[] = [];
    let actIdx = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'newAct') {
        found.push({
          index: actIdx,
          title: node.textContent || `Act ${actIdx + 1}`,
        });
        actIdx++;
      }
      return true;
    });

    if (found.length === 0) {
      return [{ index: 0, title: 'Act 1' }];
    }
    return found;
  }, [editor, scenes]); // scenes dependency triggers re-compute on doc update

  const handleAddBeat = useCallback(
    (actIndex: number) => {
      addBeat('New Beat', actIndex);
    },
    [addBeat],
  );

  if (!beatBoardOpen) return null;

  return (
    <div className="beat-board">
      <div className="beat-board-header">
        <span className="beat-board-title">Beat Board</span>
        <span className="beat-board-info">
          {beats.length} beat{beats.length !== 1 ? 's' : ''} across{' '}
          {acts.length} act{acts.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="beat-board-columns">
        {acts.map((act) => {
          const actBeats = beats
            .filter((b) => b.actIndex === act.index)
            .sort((a, b) => a.position - b.position);

          return (
            <div key={act.index} className="beat-column">
              <div className="beat-column-header">{act.title}</div>
              <div className="beat-column-cards">
                {actBeats.map((beat) => (
                  <div key={beat.id} className="beat-card">
                    <div className="beat-card-top">
                      <input
                        className="beat-card-title"
                        value={beat.title}
                        onChange={(e) =>
                          updateBeat(beat.id, { title: e.target.value })
                        }
                        placeholder="Beat title..."
                      />
                      <button
                        className="beat-card-delete"
                        onClick={() => deleteBeat(beat.id)}
                        title="Delete beat"
                      >
                        &times;
                      </button>
                    </div>
                    <textarea
                      className="beat-card-description"
                      value={beat.description}
                      onChange={(e) =>
                        updateBeat(beat.id, { description: e.target.value })
                      }
                      placeholder="Describe this beat..."
                      rows={3}
                    />
                  </div>
                ))}
              </div>
              <button
                className="beat-add-btn"
                onClick={() => handleAddBeat(act.index)}
              >
                + Add Beat
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BeatBoard;
