/**
 * Script Timing — compute estimated runtime per scene and total.
 *
 * Element-type weights (seconds per page of that element type):
 * - Dialogue: 50s/page (people talk fast on screen)
 * - Action:   65s/page (action takes more screen time than reading)
 * - Parenthetical: 30s/page (stage directions)
 * - Transition: 2s each
 * - Scene heading: 0s (just a label)
 * - General: 60s/page (default)
 */
import type { JSONContent } from '@tiptap/react';

// ── Constants ────────────────────────────────────────────────────────

/** Seconds per page for each element type */
const ELEMENT_RATES: Record<string, number> = {
  dialogue: 50,
  action: 65,
  parenthetical: 30,
  general: 60,
  lyrics: 55,
  shot: 60,
  newAct: 0,
  endOfAct: 0,
  castList: 0,
  showEpisode: 0,
  titlePage: 0,
  sceneHeading: 0,
};

/** Fixed time for transition elements (seconds) */
const TRANSITION_SECONDS = 2;

/** Approximate words per page */
const WORDS_PER_PAGE = 250;

// ── Types ────────────────────────────────────────────────────────────

export interface SceneTiming {
  sceneIndex: number;
  heading: string;
  autoEstimateSeconds: number;
  overrideSeconds: number | null;
  finalSeconds: number;          // override ?? autoEstimate
  cumulativeSeconds: number;
  breakdown: {
    dialogueSeconds: number;
    actionSeconds: number;
    otherSeconds: number;
  };
}

export interface TimingResult {
  scenes: SceneTiming[];
  totalSeconds: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getTextContent(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(getTextContent).join('');
}

// ── Main computation ─────────────────────────────────────────────────

export function computeSceneTiming(doc: JSONContent): TimingResult {
  if (!doc.content) return { scenes: [], totalSeconds: 0 };

  const scenes: SceneTiming[] = [];
  let currentScene: {
    heading: string;
    dialogueWords: number;
    actionWords: number;
    otherWords: number;
    transitionCount: number;
    overrideSeconds: number | null;
  } | null = null;

  for (const node of doc.content) {
    const type = node.type || '';
    if (type === 'titlePage') continue;

    const text = getTextContent(node);
    const words = countWords(text);

    if (type === 'sceneHeading') {
      // Finalize previous scene
      if (currentScene) {
        pushScene(scenes, currentScene);
      }
      currentScene = {
        heading: text,
        dialogueWords: 0,
        actionWords: 0,
        otherWords: 0,
        transitionCount: 0,
        overrideSeconds: node.attrs?.timingOverride != null ? Number(node.attrs.timingOverride) : null,
      };
    } else if (currentScene) {
      if (type === 'dialogue') {
        currentScene.dialogueWords += words;
      } else if (type === 'action') {
        currentScene.actionWords += words;
      } else if (type === 'transition') {
        currentScene.transitionCount++;
      } else if (type !== 'character') {
        // character names don't take screen time
        currentScene.otherWords += words;
      }
    }
  }

  // Finalize last scene
  if (currentScene) {
    pushScene(scenes, currentScene);
  }

  // Compute cumulative
  let cumulative = 0;
  for (const scene of scenes) {
    cumulative += scene.finalSeconds;
    scene.cumulativeSeconds = cumulative;
  }

  return { scenes, totalSeconds: cumulative };
}

function pushScene(
  scenes: SceneTiming[],
  current: {
    heading: string;
    dialogueWords: number;
    actionWords: number;
    otherWords: number;
    transitionCount: number;
    overrideSeconds: number | null;
  },
): void {
  const dialoguePages = current.dialogueWords / WORDS_PER_PAGE;
  const actionPages = current.actionWords / WORDS_PER_PAGE;
  const otherPages = current.otherWords / WORDS_PER_PAGE;

  const dialogueSeconds = dialoguePages * ELEMENT_RATES.dialogue;
  const actionSeconds = actionPages * ELEMENT_RATES.action;
  const otherSeconds = otherPages * (ELEMENT_RATES.general || 60) + current.transitionCount * TRANSITION_SECONDS;

  const autoEstimateSeconds = Math.round(dialogueSeconds + actionSeconds + otherSeconds);

  scenes.push({
    sceneIndex: scenes.length,
    heading: current.heading,
    autoEstimateSeconds,
    overrideSeconds: current.overrideSeconds,
    finalSeconds: current.overrideSeconds ?? autoEstimateSeconds,
    cumulativeSeconds: 0, // filled in after
    breakdown: {
      dialogueSeconds: Math.round(dialogueSeconds),
      actionSeconds: Math.round(actionSeconds),
      otherSeconds: Math.round(otherSeconds),
    },
  });
}

// ── Formatting ───────────────────────────────────────────────────────

/** Format seconds as "1h 47m" or "2:15" (mm:ss for short durations) */
export function formatRuntime(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format seconds as "M:SS" for per-scene display */
export function formatSceneDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Get color for scene duration (for SceneNavigator timing column) */
export function getTimingColor(seconds: number): string {
  if (seconds < 60) return '#94a3b8';   // grey — very short
  if (seconds < 180) return '#10b981';  // green — normal
  if (seconds < 300) return '#f59e0b';  // yellow — long
  return '#ef4444';                     // red — very long
}
