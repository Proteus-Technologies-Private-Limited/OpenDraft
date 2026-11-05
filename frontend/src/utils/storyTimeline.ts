/**
 * The Story Timeline: the script's scenes laid out by screen time, from the
 * same timing engine as the status bar and the Timing Report, with the
 * plotlines each one carries (utils/plotlines). Also the edits the timeline
 * makes to scene headings.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { computeSceneTiming, type TimingOptions } from './scriptTiming';
import { plotlineIdsOf } from './plotlines';

export interface TimelineScene {
  /** Position of the scene heading in the document. */
  pos: number;
  index: number;
  /** The printed scene number, or the scene's place when it has none. */
  number: string;
  heading: string;
  seconds: number;
  /** Screen time before this scene starts, from the first scene. */
  startSeconds: number;
  plotlineIds: string[];
}

/**
 * The script's scenes with their screen time. A scene is what the timing
 * engine counts as one — a top-level scene heading with text — so the two
 * agree scene for scene.
 */
export function timelineScenes(doc: PmNode, timing: TimingOptions): TimelineScene[] {
  const found: Array<{ pos: number; node: PmNode }> = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'sceneHeading' && node.textContent.trim()) found.push({ pos: offset, node });
  });
  const times = computeSceneTiming(doc.toJSON(), timing).scenes;
  let start = 0;
  return found.map(({ pos, node }, index) => {
    const seconds = times[index]?.finalSeconds ?? 0;
    const scene: TimelineScene = {
      pos,
      index,
      number: node.attrs.sceneNumber != null && String(node.attrs.sceneNumber).trim()
        ? String(node.attrs.sceneNumber)
        : String(index + 1),
      heading: node.textContent.trim(),
      seconds,
      startSeconds: start,
      plotlineIds: plotlineIdsOf(node.attrs),
    };
    start += seconds;
    return scene;
  });
}

/**
 * How far apart the Story Map's time ruler labels sit, chosen for the script's
 * length. Shared with the strip that sits under the Index Cards.
 */
export function storyMapTimeStep(totalSeconds: number): number {
  if (totalSeconds <= 120) return 15;
  if (totalSeconds <= 300) return 30;
  if (totalSeconds <= 900) return 60;
  if (totalSeconds <= 1800) return 120;
  return 300;
}

/**
 * Screen seconds for every scene heading, matched by document position.
 *
 * `timelineScenes` skips a scene heading with no text, while the editor's
 * scene list includes it as "Untitled Scene". Aligning by index would shift
 * every duration after it onto the wrong block.
 */
export function secondsByScenePosition(
  positions: ReadonlyArray<number | null>,
  timeline: ReadonlyArray<Pick<TimelineScene, 'pos' | 'seconds'>>,
): number[] {
  const byPos = new Map(timeline.map((scene) => [scene.pos, scene.seconds]));
  return positions.map((pos) => (pos === null ? 0 : byPos.get(pos) ?? 0));
}

/** Put the scene heading at `pos` in a plotline, or take it out if it is in it. */
export function toggleScenePlotlineTransaction(state: EditorState, pos: number, plotlineId: string): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'sceneHeading') return null;
  const ids = plotlineIdsOf(node.attrs);
  const next = ids.includes(plotlineId) ? ids.filter((id) => id !== plotlineId) : [...ids, plotlineId];
  return state.tr.setNodeAttribute(pos, 'plotlines', next.length ? next : null);
}

/** Take a deleted plotline off every scene that carried it. */
export function removePlotlineFromScenesTransaction(state: EditorState, plotlineId: string): Transaction | null {
  const tr = state.tr;
  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'sceneHeading') return;
    const ids = plotlineIdsOf(node.attrs);
    if (!ids.includes(plotlineId)) return;
    const next = ids.filter((id) => id !== plotlineId);
    tr.setNodeAttribute(offset, 'plotlines', next.length ? next : null);
  });
  return tr.docChanged ? tr : null;
}

/** How much of the script a plotline carries. */
export function plotlineSummary(scenes: TimelineScene[], plotlineId: string): { scenes: number; seconds: number } {
  let count = 0;
  let seconds = 0;
  for (const s of scenes) {
    if (s.plotlineIds.includes(plotlineId)) {
      count++;
      seconds += s.seconds;
    }
  }
  return { scenes: count, seconds };
}
