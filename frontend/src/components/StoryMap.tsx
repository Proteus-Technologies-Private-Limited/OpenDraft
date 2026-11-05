/**
 * Story Map: the script's scenes as one strip, each as wide as it is long.
 *
 * It sits under the editor and answers the structural question a page count
 * cannot — where the scenes sit in the whole, and how much room each takes.
 * The strip can be measured in pages or in screen time, and the ruler below
 * marks the pages or the minutes the scenes cross.
 *
 * The same component draws the timeline under the Index Cards view
 * (`embedded`, `onSelectScene`), so the two strips cannot drift apart. Screen
 * time comes from `utils/storyTimeline` with `activeTimingOptions()`, the same
 * engine as the Story Timeline and the status bar's estimate.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaTimes } from 'react-icons/fa';
import { useEditorStore, type StoryMapUnits } from '../stores/editorStore';
import { activeTemplateHints, computeSceneLengths } from '../editor/pagination';
import { activeTimingOptions, formatSceneDuration } from '../utils/scriptTiming';
import { timelineScenes, secondsByScenePosition, storyMapTimeStep } from '../utils/storyTimeline';

interface Props {
  editor: Editor | null;
  onRequestClose?: () => void;
  /** The editor's scroll container, so a click moves the page to the scene. */
  scrollContainer?: HTMLElement | null;
  /** When set, a click selects the scene here instead of scrolling the editor. */
  onSelectScene?: (sceneIndex: number) => void;
  title?: string;
  /** Drawn inside another view (the Index Cards), not as its own panel. */
  embedded?: boolean;
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

/** The scene the caret is in, or null. */
function currentSceneIndex(editor: Editor): number | null {
  let index = -1;
  let current: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'sceneHeading') {
      index++;
      if (pos < editor.state.selection.from) current = index;
    }
    return true;
  });
  return current;
}

const StoryMap: React.FC<Props> = ({
  editor,
  onRequestClose,
  scrollContainer,
  onSelectScene,
  title = 'Story Map',
  embedded = false,
}) => {
  const scenes = useEditorStore((s) => s.scenes);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const units = useEditorStore((s) => s.storyMapUnits);
  const setUnits = useEditorStore((s) => s.setStoryMapUnits);
  const [version, setVersion] = useState(0);

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

  const lengths = useMemo(() => {
    if (!editor) return [];
    try {
      return computeSceneLengths(editor.state.doc, pageLayout, activeTemplateHints());
    } catch {
      return [];
    }
  }, [editor, pageLayout, version, scenes]);

  // The same timing as the Story Timeline and the status bar, not a second
  // calculation with the defaults.
  const timeline = useMemo(() => {
    if (!editor) return [];
    try {
      return timelineScenes(editor.state.doc, activeTimingOptions(pageLayout));
    } catch {
      return [];
    }
  }, [editor, pageLayout, version, scenes]);

  // The timing engine counts only headings with text, while the store lists
  // every heading (an empty one reads "Untitled Scene"). Align the two by the
  // heading's document position, not by index, or one empty scene shifts every
  // duration after it onto the wrong block.
  const secondsByIndex = useMemo(() => {
    if (!editor) return [] as number[];
    const positions = scenes.map((_, index) => sceneHeadingPos(editor, index));
    return secondsByScenePosition(positions, timeline);
  }, [editor, scenes, timeline]);

  const activeScene = useMemo(() => (editor ? currentSceneIndex(editor) : null), [editor, version]);

  const byTime = units === 'time';
  const weights = useMemo(
    () => scenes.map((_, i) => Math.max(byTime ? (secondsByIndex[i] ?? 0) : (lengths[i] ?? 0), 0)),
    [scenes, secondsByIndex, lengths, byTime],
  );
  const total = useMemo(() => weights.reduce((sum, w) => sum + w, 0), [weights]);
  const totalPages = useMemo(() => lengths.reduce((sum, len) => sum + len, 0), [lengths]);
  const totalSeconds = useMemo(
    () => secondsByIndex.reduce((sum, seconds) => sum + (seconds || 0), 0),
    [secondsByIndex],
  );

  const goToScene = useCallback((sceneIndex: number) => {
    if (onSelectScene) {
      onSelectScene(sceneIndex);
      return;
    }
    if (!editor) return;
    const pos = sceneHeadingPos(editor, sceneIndex);
    if (pos === null) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
    // scrollIntoView alone moves the nearest scrollable ancestor just enough
    // to show the line; the Navigator puts the heading near the top instead,
    // and that is what writers expect from a scene jump.
    setTimeout(() => {
      const coords = editor.view.coordsAtPos(pos + 1);
      const container = scrollContainer
        ?? (editor.view.dom.closest('.editor-main') as HTMLElement | null);
      if (container) {
        const rect = container.getBoundingClientRect();
        const top = container.scrollTop + (coords.top - rect.top) - 60;
        container.scrollTo({ top, behavior: 'auto' });
      } else {
        window.scrollTo({ top: window.scrollY + coords.top - 60 });
      }
    }, 0);
  }, [editor, scrollContainer, onSelectScene]);

  const ticks = useMemo(() => {
    if (total <= 0) return [] as { key: string; label: string; left: number }[];
    if (byTime) {
      const step = storyMapTimeStep(total);
      const out: { key: string; label: string; left: number }[] = [];
      for (let seconds = 0; seconds < total; seconds += step) {
        out.push({
          key: `t-${seconds}`,
          label: formatSceneDuration(seconds),
          left: (seconds / total) * 100,
        });
      }
      return out;
    }
    const out: { key: string; label: string; left: number }[] = [];
    const last = Math.ceil(total);
    for (let page = 1; page <= last; page++) {
      out.push({
        key: `p-${page}`,
        label: String(page),
        left: ((page - 1) / total) * 100,
      });
    }
    return out;
  }, [total, byTime]);

  // The strip can be wider than the pane; the ruler below has to be as wide as
  // the scenes it measures, not as wide as the pane, or its ticks drift.
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const first = track.firstElementChild?.getBoundingClientRect();
      const last = track.lastElementChild?.getBoundingClientRect();
      setTrackWidth(first && last ? Math.ceil(last.right - first.left) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    Array.from(track.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [scenes.length, total, lengths, secondsByIndex]);

  const setMode = (mode: StoryMapUnits) => {
    if (mode !== units) setUnits(mode);
  };

  return (
    <div className={`story-map${embedded ? ' story-map-embedded' : ''}`}>
      <div className="story-map-header">
        <span className="story-map-title">{title}</span>
        <div className="story-map-units" role="group" aria-label="Measure the map in">
          <button
            className={!byTime ? 'active' : ''}
            onClick={() => setMode('pages')}
            title="Size the scenes by page length"
          >
            Pages
          </button>
          <button
            className={byTime ? 'active' : ''}
            onClick={() => setMode('time')}
            title="Size the scenes by estimated screen time"
          >
            Time
          </button>
        </div>
        <span className="story-map-count">
          {scenes.length} scene{scenes.length === 1 ? '' : 's'} {'\u00b7'}{' '}
          {byTime
            ? formatSceneDuration(totalSeconds)
            : `${totalPages > 0 ? totalPages.toFixed(1) : '0'} pages`}
        </span>
        {onRequestClose && (
          <button
            className="panel-close-btn"
            onClick={onRequestClose}
            title={`Close ${title}`}
            aria-label={`Close ${title}`}
          >
            <FaTimes />
          </button>
        )}
      </div>
      {scenes.length === 0 ? (
        <p className="story-map-empty">No scenes yet. Write a scene heading (INT. or EXT.) and it appears here.</p>
      ) : (
        <div className="story-map-scroll">
          <div className="story-map-track" ref={trackRef}>
            {scenes.map((scene, index) => {
              const seconds = secondsByIndex[index] ?? 0;
              const pages = lengths[index] ?? 0;
              const weight = Math.max(weights[index] ?? 0, byTime ? 2 : 0.15);
              return (
                <div
                  key={scene.id}
                  className={`story-map-block${activeScene === index ? ' active' : ''}`}
                  style={{ flexGrow: weight }}
                  title={
                    `${scene.heading}${scene.synopsis ? `\n${scene.synopsis}` : ''}\n` +
                    `${pages > 0 ? `${pages.toFixed(2)} pages` : 'No length yet'} \u00b7 ${formatSceneDuration(seconds)}`
                  }
                  onClick={() => goToScene(index)}
                >
                  <div className="story-map-block-top">
                    <span className="story-map-num">{scene.sceneNumber ?? index + 1}</span>
                    <span className="story-map-meta">
                      {byTime ? formatSceneDuration(seconds) : `${pages.toFixed(1)}p`}
                    </span>
                  </div>
                  <span className="story-map-heading">{scene.heading}</span>
                  {scene.synopsis && <span className="story-map-synopsis">{scene.synopsis}</span>}
                </div>
              );
            })}
          </div>
          <div className="story-map-ruler" style={{ width: trackWidth > 0 ? `${trackWidth}px` : '100%' }}>
            {ticks.map((tick) => (
              <span key={tick.key} className="story-map-tick" style={{ left: `${tick.left}%` }}>
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryMap;
