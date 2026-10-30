/**
 * Story Map: the script's scenes as one strip, each as wide as it is long.
 *
 * It sits under the editor and answers the structural question a page count
 * cannot — where the scenes sit in the whole, and how much room each takes.
 * Clicking a scene goes to it. The ruler below marks the pages the scenes
 * cross, so the map doubles as a one-line page map.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FaTimes } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { activeTemplateHints, computeSceneLengths } from '../editor/pagination';

interface Props {
  editor: Editor | null;
  onRequestClose: () => void;
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

const StoryMap: React.FC<Props> = ({ editor, onRequestClose }) => {
  const scenes = useEditorStore((s) => s.scenes);
  const pageLayout = useEditorStore((s) => s.pageLayout);
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

  const activeScene = useMemo(() => (editor ? currentSceneIndex(editor) : null), [editor, version]);

  const totalPages = useMemo(
    () => lengths.reduce((sum, len) => sum + len, 0),
    [lengths],
  );

  const goToScene = useCallback((sceneIndex: number) => {
    if (!editor) return;
    const pos = sceneHeadingPos(editor, sceneIndex);
    if (pos === null) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  }, [editor]);

  const pageTicks = useMemo(() => {
    if (totalPages <= 0) return [];
    const ticks: { page: number; left: number }[] = [];
    const last = Math.ceil(totalPages);
    for (let page = 1; page <= last; page++) {
      ticks.push({ page, left: totalPages > 0 ? ((page - 1) / totalPages) * 100 : 0 });
    }
    return ticks;
  }, [totalPages]);

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
  }, [scenes.length, totalPages, lengths]);

  return (
    <div className="story-map">
      <div className="story-map-header">
        <span className="story-map-title">Story Map</span>
        <span className="story-map-count">
          {scenes.length} scene{scenes.length === 1 ? '' : 's'} {'\u00b7'} {totalPages > 0 ? totalPages.toFixed(1) : '0'} pages
        </span>
        <button
          className="panel-close-btn"
          onClick={onRequestClose}
          title="Close Story Map"
          aria-label="Close Story Map"
        >
          <FaTimes />
        </button>
      </div>
      {scenes.length === 0 ? (
        <p className="story-map-empty">No scenes yet. Write a scene heading (INT. or EXT.) and it appears here.</p>
      ) : (
        <div className="story-map-scroll">
          <div className="story-map-track" ref={trackRef}>
            {scenes.map((scene, index) => {
              const length = lengths[index] ?? 0;
              return (
                <div
                  key={scene.id}
                  className={`story-map-block${activeScene === index ? ' active' : ''}`}
                  style={{ flexGrow: Math.max(length, 0.15) }}
                  title={`${scene.heading}${scene.synopsis ? `\n${scene.synopsis}` : ''}\n${length > 0 ? `${length.toFixed(2)} pages` : 'No length yet'}`}
                  onClick={() => goToScene(index)}
                >
                  <span className="story-map-num">{scene.sceneNumber ?? index + 1}</span>
                  <span className="story-map-heading">{scene.heading}</span>
                  {scene.synopsis && <span className="story-map-synopsis">{scene.synopsis}</span>}
                </div>
              );
            })}
          </div>
          <div className="story-map-ruler" style={{ width: trackWidth > 0 ? `${trackWidth}px` : '100%' }}>
            {pageTicks.map((tick) => (
              <span key={tick.page} className="story-map-tick" style={{ left: `${tick.left}%` }}>
                {tick.page}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryMap;
