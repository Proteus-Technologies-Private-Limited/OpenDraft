/**
 * View → Story Timeline
 *
 * The script's plotlines as rows across its scenes, each scene as wide as its
 * screen time (utils/storyTimeline). Click a scene in a row to put it in that
 * plotline or take it out; click a scene number to go to it. Plotlines are
 * named, coloured and removed in the column on the left, which also says how
 * much of the script, and how many beats, each one carries. Beats linked to
 * scenes on the Beat Board (utils/beatScenes) show in a row of their own,
 * under the scenes they are linked to.
 *
 * A dialog over the editor rather than a view in its place, because putting a
 * scene in a plotline is an edit to its scene heading, and the editor has to
 * be there to make it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { ModalOverlay } from './ModalOverlay';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
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
import { beatsByScene, linkableScenes } from '../utils/beatScenes';

interface Props {
  editor: Editor;
  onClose: () => void;
  docked?: boolean;
}

/** Narrowest a scene is drawn, so a short scene can still be clicked. */
const MIN_SCENE_PX = 18;
/** Width given to each second of screen time once a script is too long to fit
 *  the dialog — a minute is 36px — so the track scrolls with scenes still
 *  sized by screen time instead of all shrinking to MIN_SCENE_PX. */
const PX_PER_SECOND = 0.6;

const StoryTimeline: React.FC<Props> = ({ editor, onClose, docked = false }) => {
  const { t } = useTranslation(['story', 'common']);
  const plotlines = useEditorStore((s) => s.plotlines);
  const beats = useEditorStore((s) => s.beats);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const addPlotline = useEditorStore((s) => s.addPlotline);
  const updatePlotline = useEditorStore((s) => s.updatePlotline);
  const deletePlotline = useEditorStore((s) => s.deletePlotline);
  const rootRef = useRef<HTMLDivElement>(null);
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
  // The same scenes as above, in the same order, with their stable ids.
  const sceneUids = useMemo(
    () => linkableScenes(editor.state.doc).map((s) => s.uid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docVersion],
  );
  const linkedBeats = useMemo(() => beatsByScene(beats), [beats]);
  const beatsAt = (s: TimelineScene) => {
    const uid = sceneUids[s.index];
    return (uid && linkedBeats.get(uid)) || [];
  };
  const linkedBeatCount = useMemo(() => {
    const live = new Set(sceneUids.filter(Boolean));
    return beats.filter((b) => (b.sceneIds ?? []).some((id) => live.has(id))).length;
  }, [beats, sceneUids]);
  const totalSeconds = scenes.reduce((n, s) => n + s.seconds, 0);
  const unassigned = scenes.filter((s) => !s.plotlineIds.some((id) => plotlines.some((p) => p.id === id)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (docked && (e.defaultPrevented || !rootRef.current?.contains(e.target as Node))) return;
      e.preventDefault();
      if (pendingDelete) setPendingDelete(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, onClose, pendingDelete]);

  // A version from history is read-only, and so is its timeline.
  useModalAccessibility(rootRef, !docked);
  const editable = editor.isEditable;

  const toggle = (scene: TimelineScene, plotlineId: string) => {
    if (!editable) return;
    const tr = toggleScenePlotlineTransaction(editor.state, scene.pos, plotlineId);
    if (tr) editor.view.dispatch(tr);
  };

  const goTo = (scene: TimelineScene) => {
    if (!docked) onClose();
    editor.chain().focus().setTextSelection(scene.pos + 1).scrollIntoView().run();
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const tr = removePlotlineFromScenesTransaction(editor.state, pendingDelete.id);
    if (tr) editor.view.dispatch(tr);
    deletePlotline(pendingDelete.id);
    setPendingDelete(null);
  };

  const sceneTitle = (s: TimelineScene) => t('timeline.sceneTitle', { number: s.number, heading: s.heading, duration: formatSceneDuration(s.seconds) });
  // Every row lays its scenes out the same way, so the columns line up.
  const cellStyle = (s: TimelineScene): React.CSSProperties => ({
    flex: `${Math.max(s.seconds, 1)} 0 0`,
    minWidth: MIN_SCENE_PX,
  });
  // Room for every scene at its screen-time width. Sized only to fit them at
  // MIN_SCENE_PX, a feature-length script left no width over to share out by
  // screen time, and every scene came out the same.
  const trackMinWidth = useMemo(
    () => scenes.reduce((w, s) => w + Math.max(MIN_SCENE_PX, s.seconds * PX_PER_SECOND), 0),
    [scenes],
  );
  const trackStyle: React.CSSProperties = { minWidth: trackMinWidth };

  return (
    <div ref={rootRef} className={docked ? "story-timeline-dock" : "dialog-overlay"} onClick={docked ? undefined : onClose}>
      <div
        className="dialog-box story-timeline"
        onClick={(e) => { e.stopPropagation(); setColorPickerFor(null); }}
        role={docked ? "region" : "dialog"}
        aria-modal={docked ? undefined : true}
        aria-labelledby="story-timeline-title"
      >
        <div className="dialog-header story-timeline-header">
          <span id="story-timeline-title">{t('timeline.title')}</span>
          <span className="story-timeline-meta">
            {t('timeline.meta', { scenes: t('timeline.sceneCount', { count: scenes.length }), duration: formatSceneDuration(totalSeconds) })}
          </span>
        </div>

        <div className="story-timeline-body">
          {scenes.length === 0 ? (
            <p className="story-timeline-empty">{t('timeline.empty')}</p>
          ) : (
            <div className="story-timeline-grid">
              {/* Left: the plotlines */}
              <div className="story-timeline-labels">
                <div className="story-timeline-label story-timeline-ruler-label">{t('timeline.scene')}</div>
                {linkedBeatCount > 0 && (
                  <div className="story-timeline-label story-timeline-beats-label">
                    <span>{t('timeline.beats')}</span>
                    <span className="story-timeline-sum">{t('timeline.linked', { count: linkedBeatCount })}</span>
                  </div>
                )}
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
                          title={t('timeline.colour')}
                          aria-label={t('timeline.colourOf', { name: p.name || t('timeline.plotlineLower') })}
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
                          placeholder={t('timeline.plotlineName')}
                          aria-label={t('timeline.plotlineName')}
                        />
                        <span className="story-timeline-sum">
                          {beatCount > 0
                            ? t('timeline.summaryWithBeats', { scenes: t('timeline.sceneCount', { count: sum.scenes }), duration: formatSceneDuration(sum.seconds), beats: t('timeline.beatCount', { count: beatCount }) })
                            : t('timeline.summary', { scenes: t('timeline.sceneCount', { count: sum.scenes }), duration: formatSceneDuration(sum.seconds) })}
                        </span>
                      </div>
                      <button
                        className="story-timeline-delete"
                        onClick={() => setPendingDelete(p)}
                        title={t('timeline.deletePlotlineTitle')}
                        aria-label={t('timeline.deleteNamed', { name: p.name || t('timeline.plotlineLower') })}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
                {plotlines.length > 0 && (
                  <div className="story-timeline-label story-timeline-unassigned-label">
                    <span>{t('timeline.noPlotline')}</span>
                    <span className="story-timeline-sum">
                      {t('timeline.sceneCount', { count: unassigned.length })}
                    </span>
                  </div>
                )}
                <button className="story-timeline-add" onClick={() => addPlotline()}>{t('timeline.addPlotline')}</button>
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
                      title={t('timeline.goToScene', { scene: sceneTitle(s) })}
                    >
                      {s.number}
                    </button>
                  ))}
                </div>
                {linkedBeatCount > 0 && (
                  <div className="story-timeline-track story-timeline-beats" style={trackStyle} role="group" aria-label={t('timeline.linkedBeats')}>
                    {scenes.map((s) => {
                      const here = beatsAt(s);
                      if (!here.length) return <span key={s.pos} className="story-timeline-beat-cell empty" style={cellStyle(s)} />;
                      return (
                        <button
                          key={s.pos}
                          className="story-timeline-beat-cell"
                          style={cellStyle(s)}
                          onClick={() => goTo(s)}
                          title={t('timeline.beatsTitle', { scene: sceneTitle(s), beats: here.map((b) => `• ${b.title || t('timeline.untitledBeat')}`).join('\n') })}
                          aria-label={t('timeline.beatsAtScene', { count: here.length, number: s.number })}
                        >
                          {here.slice(0, 3).map((b) => (
                            <span key={b.id} className="story-timeline-beat" style={b.color ? { background: b.color } : undefined} />
                          ))}
                          {here.length > 3 && <span className="story-timeline-beat-more">+{here.length - 3}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {plotlines.map((p) => (
                  <div key={p.id} className="story-timeline-track" style={trackStyle} role="group" aria-label={p.name || t('timeline.plotlineCap')}>
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
                          title={t(on ? 'timeline.cellOn' : 'timeline.cellOff', { scene: sceneTitle(s), name: p.name || t('timeline.thisPlotline') })}
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
                        title={unassigned.includes(s) ? t('timeline.inNoPlotline', { scene: sceneTitle(s) }) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {scenes.length > 0 && plotlines.length === 0 && (
            <p className="story-timeline-empty">
              {t('timeline.addHint')}
            </p>
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-primary" onClick={onClose}>{t('common:done')}</button>
        </div>
      </div>

      {pendingDelete && (
        <ModalOverlay className="dialog-overlay" onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">{t('timeline.deleteHeader')}</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>
                {t('timeline.deleteConfirm', { name: pendingDelete.name || t('timeline.thisPlotline') })}
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDelete(null)}>{t('common:cancel')}</button>
              <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={confirmDelete}>{t('common:delete')}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default StoryTimeline;
