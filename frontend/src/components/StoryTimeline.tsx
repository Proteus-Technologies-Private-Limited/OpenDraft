/**
 * View → Story Timeline
 *
 * The script's plotlines as rows across its scenes, each scene as wide as its
 * screen time (utils/storyTimeline). Click a scene in a row to put it in that
 * plotline or take it out; click a scene number to go to it. Plotlines are
 * named, coloured and removed in the column on the left, which also says how
 * much of the script, and how many beats, each one carries.
 *
 * A dialog over the editor rather than a view in its place, because putting a
 * scene in a plotline is an edit to its scene heading, and the editor has to
 * be there to make it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { PLOTLINE_COLORS, type Plotline } from '../utils/plotlines';
import {
  plotlineSummary,
  removePlotlineFromScenesTransaction,
  timelineScenes,
  toggleScenePlotlineTransaction,
  type TimelineScene,
} from '../utils/storyTimeline';
import { activeTimingOptions, formatSceneDuration } from '../utils/scriptTiming';

interface Props {
  editor: Editor;
  onClose: () => void;
}

/** Narrowest a scene is drawn, so a short scene can still be clicked. */
const MIN_SCENE_PX = 18;

const StoryTimeline: React.FC<Props> = ({ editor, onClose }) => {
  const plotlines = useEditorStore((s) => s.plotlines);
  const beats = useEditorStore((s) => s.beats);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const addPlotline = useEditorStore((s) => s.addPlotline);
  const updatePlotline = useEditorStore((s) => s.updatePlotline);
  const deletePlotline = useEditorStore((s) => s.deletePlotline);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Plotline | null>(null);

  // Redraw on every change to the script — a collaborator's included.
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    const bump = () => setDocVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  const scenes = useMemo<TimelineScene[]>(
    () => timelineScenes(editor.state.doc, activeTimingOptions(pageLayout)),
    // docVersion stands for editor.state.doc, which is not a React value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docVersion, pageLayout],
  );
  const totalSeconds = scenes.reduce((n, s) => n + s.seconds, 0);
  const unassigned = scenes.filter((s) => !s.plotlineIds.some((id) => plotlines.some((p) => p.id === id)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingDelete) setPendingDelete(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pendingDelete]);

  // A version from history is read-only, and so is its timeline.
  const editable = editor.isEditable;

  const toggle = (scene: TimelineScene, plotlineId: string) => {
    if (!editable) return;
    const tr = toggleScenePlotlineTransaction(editor.state, scene.pos, plotlineId);
    if (tr) editor.view.dispatch(tr);
  };

  const goTo = (scene: TimelineScene) => {
    onClose();
    editor.chain().focus().setTextSelection(scene.pos + 1).scrollIntoView().run();
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const tr = removePlotlineFromScenesTransaction(editor.state, pendingDelete.id);
    if (tr) editor.view.dispatch(tr);
    deletePlotline(pendingDelete.id);
    setPendingDelete(null);
  };

  const sceneTitle = (s: TimelineScene) => `${s.number}. ${s.heading} — ${formatSceneDuration(s.seconds)}`;
  // Every row lays its scenes out the same way, so the columns line up.
  const cellStyle = (s: TimelineScene): React.CSSProperties => ({
    flex: `${Math.max(s.seconds, 1)} 0 0`,
    minWidth: MIN_SCENE_PX,
  });
  const trackStyle: React.CSSProperties = { minWidth: scenes.length * MIN_SCENE_PX };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box story-timeline"
        onClick={(e) => { e.stopPropagation(); setColorPickerFor(null); }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-timeline-title"
      >
        <div className="dialog-header story-timeline-header">
          <span id="story-timeline-title">Story Timeline</span>
          <span className="story-timeline-meta">
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {formatSceneDuration(totalSeconds)}
          </span>
        </div>

        <div className="story-timeline-body">
          {scenes.length === 0 ? (
            <p className="story-timeline-empty">No scenes yet. Write a scene heading (INT. or EXT.) and it appears here.</p>
          ) : (
            <div className="story-timeline-grid">
              {/* Left: the plotlines */}
              <div className="story-timeline-labels">
                <div className="story-timeline-label story-timeline-ruler-label">Scene</div>
                {plotlines.map((p) => {
                  const sum = plotlineSummary(scenes, p.id);
                  const beatCount = beats.filter((b) => b.plotlineIds?.includes(p.id)).length;
                  return (
                    <div key={p.id} className="story-timeline-label">
                      <div className="story-timeline-swatch-wrap">
                        <button
                          className="story-timeline-swatch"
                          style={{ background: p.color }}
                          onClick={(e) => { e.stopPropagation(); setColorPickerFor(colorPickerFor === p.id ? null : p.id); }}
                          title="Colour"
                          aria-label={`Colour of ${p.name || 'plotline'}`}
                        />
                        {colorPickerFor === p.id && (
                          <div className="story-timeline-colors" onClick={(e) => e.stopPropagation()}>
                            {PLOTLINE_COLORS.map((c) => (
                              <button
                                key={c}
                                className={`story-timeline-color${p.color === c ? ' active' : ''}`}
                                style={{ background: c }}
                                onClick={() => { updatePlotline(p.id, { color: c }); setColorPickerFor(null); }}
                                aria-label={c}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="story-timeline-label-text">
                        <input
                          className="story-timeline-name"
                          value={p.name}
                          onChange={(e) => updatePlotline(p.id, { name: e.target.value })}
                          placeholder="Plotline name"
                          aria-label="Plotline name"
                        />
                        <span className="story-timeline-sum">
                          {sum.scenes} scene{sum.scenes === 1 ? '' : 's'} · {formatSceneDuration(sum.seconds)}
                          {beatCount > 0 && ` · ${beatCount} beat${beatCount === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <button
                        className="story-timeline-delete"
                        onClick={() => setPendingDelete(p)}
                        title="Delete plotline"
                        aria-label={`Delete ${p.name || 'plotline'}`}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                {plotlines.length > 0 && (
                  <div className="story-timeline-label story-timeline-unassigned-label">
                    <span>No plotline</span>
                    <span className="story-timeline-sum">
                      {unassigned.length} scene{unassigned.length === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
                <button className="story-timeline-add" onClick={() => addPlotline()}>+ Add Plotline</button>
              </div>

              {/* Right: the scenes, by screen time */}
              <div className="story-timeline-tracks">
                <div className="story-timeline-track story-timeline-ruler" style={trackStyle}>
                  {scenes.map((s) => (
                    <button
                      key={s.pos}
                      className="story-timeline-ruler-cell"
                      style={cellStyle(s)}
                      onClick={() => goTo(s)}
                      title={`${sceneTitle(s)} — go to scene`}
                    >
                      {s.number}
                    </button>
                  ))}
                </div>
                {plotlines.map((p) => (
                  <div key={p.id} className="story-timeline-track" style={trackStyle} role="group" aria-label={p.name || 'Plotline'}>
                    {scenes.map((s) => {
                      const on = s.plotlineIds.includes(p.id);
                      return (
                        <button
                          key={s.pos}
                          className={`story-timeline-cell${on ? ' on' : ''}`}
                          style={{ ...cellStyle(s), ...(on ? { background: p.color, borderColor: p.color } : {}) }}
                          onClick={() => toggle(s, p.id)}
                          disabled={!editable}
                          aria-pressed={on}
                          title={`${sceneTitle(s)} — ${on ? 'in' : 'not in'} ${p.name || 'this plotline'}; click to ${on ? 'take out' : 'add'}`}
                        />
                      );
                    })}
                  </div>
                ))}
                {plotlines.length > 0 && (
                  <div className="story-timeline-track story-timeline-unassigned" style={trackStyle}>
                    {scenes.map((s) => (
                      <span
                        key={s.pos}
                        className={`story-timeline-cell${unassigned.includes(s) ? ' gap' : ''}`}
                        style={cellStyle(s)}
                        title={unassigned.includes(s) ? `${sceneTitle(s)} — in no plotline` : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {scenes.length > 0 && plotlines.length === 0 && (
            <p className="story-timeline-empty">
              Add a plotline &mdash; the A story, the B story, a character&rsquo;s arc &mdash; then click the scenes that carry it.
            </p>
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-primary" onClick={onClose}>Done</button>
        </div>
      </div>

      {pendingDelete && (
        <div className="dialog-overlay" onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Plotline</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>
                Delete &ldquo;{pendingDelete.name || 'this plotline'}&rdquo;? Its scenes and beats stay in the script; they just leave this plotline.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryTimeline;
