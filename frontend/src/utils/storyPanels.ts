/**
 * Helpers Character Profiles, Location Profiles and Scene Details share.
 */
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { hidePanel, showPanel } from './panelActions';
import { SCENE_DETAILS_ATTR, readSceneDetails, sceneDetailsAttr, type SceneDetails } from './sceneDetails';

/** Put the cursor at `pos` and scroll the script so it sits near the top. */
export function goToPosition(editor: Editor | null, pos: number): void {
  if (!editor || editor.isDestroyed) return;
  try {
    const target = Math.max(0, Math.min(pos, editor.state.doc.content.size));
    // On a small screen the panel asking stays over the script, and focusing
    // the editor there only brings the keyboard up over it. The cursor still
    // moves — Scene Details follows it — and a tap on the script focuses it.
    if (isSmallScreen()) editor.commands.setTextSelection(target);
    else editor.chain().focus().setTextSelection(target).run();
    requestAnimationFrame(() => {
      try {
        const coords = editor.view.coordsAtPos(target);
        const main = document.querySelector('.editor-main');
        if (!main || !coords) return;
        const rect = main.getBoundingClientRect();
        main.scrollTo({ top: main.scrollTop + (coords.top - rect.top) - rect.height / 4, behavior: 'auto' });
      } catch (err) {
        console.warn('[story panels] could not scroll to the position', err);
      }
    });
  } catch (err) {
    console.warn('[story panels] could not move to the position', err);
  }
}

/**
 * Whether the panel is too narrow to show its list and a record side by
 * side. Follows the panel's own width — it is docked, resizable, and can sit
 * beside other panels — not the window's.
 */
export function useNarrowPanel(ref: React.RefObject<HTMLElement | null>, enabled: boolean, minWidth = 520): boolean {
  const [narrow, setNarrow] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => setNarrow(el.getBoundingClientRect().width < minWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled, minWidth]);
  return narrow;
}

/**
 * Rewrite one scene heading's details (utils/sceneDetails), outside the undo
 * history as the synopsis and scene colour are. Returns false when nothing
 * needed changing; throws when the heading is gone or the write fails, so
 * the caller can tell the writer.
 */
export function writeSceneDetails(
  editor: Editor | null,
  pos: number,
  change: (details: SceneDetails) => SceneDetails,
): boolean {
  if (!editor || editor.isDestroyed) throw new Error('The script is not open.');
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'sceneHeading') throw new Error(`No scene heading at ${pos}.`);
  const before = readSceneDetails(node.attrs[SCENE_DETAILS_ATTR]);
  const after = change(before);
  if (after === before) return false;
  const tr = editor.state.tr.setNodeAttribute(pos, SCENE_DETAILS_ATTR, sceneDetailsAttr(after));
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
  return true;
}

/** Whether the panels are slide-overs that cover the script (the small-screen layout). */
export function isSmallScreen(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  } catch (err) {
    console.warn('[story panels] could not read the screen size', err);
    return false;
  }
}

/**
 * Go from one panel to another — a name in Scene Details to Character
 * Profiles, a scene on a character's Scenes tab to Scene Details. On a small
 * screen the panels are slide-overs that each cover the script, so the one
 * left behind is closed, or it would stay on top of the one asked for. Docked
 * side by side on a larger screen, both stay open.
 */
export function jumpToPanel(target: string, from: string): void {
  showPanel(target);
  if (isSmallScreen() && from !== target) hidePanel(from);
}
