/**
 * Script Timing — compute estimated runtime per scene and total.
 *
 * The industry rule of thumb is one page of a correctly formatted screenplay
 * per minute of screen time, and every other writing app (Final Draft, Fade
 * In, Screenweaver) reports runtime on that basis. A "page" here means the
 * printed page — about 55 lines of 12pt Courier — and most of it is white
 * space: the blank line above every action paragraph and every cue, the two
 * above a scene heading, the narrow dialogue column that wraps after ~35
 * characters, the character cue on a line of its own.
 *
 * So the estimate is measured in printed lines, not words. Each element is
 * wrapped at its own column width and charged the blank lines the template
 * puts above it — the same measure the editor's page breaks use — and the
 * total is converted at `pageTimeSeconds / linesPerPage`.
 *
 * It used to count words at 250 per page, which is a prose page, not a
 * screenplay page (a script page carries roughly 150-180), and it gave
 * character cues, scene headings and every blank line no time at all. A
 * 110-page feature came out at a little over an hour (issue #144).
 *
 * Checked against 13 released features (studio-published scripts, scored
 * against theatrical runtime minus end credits — see
 * docs/runtime-estimate-validation.md): bias +1%, mean error 15% per film,
 * against −29% / 29% for the old word count. Weighting dialogue and action
 * differently was tried and did worse on films it was not fitted to, so
 * every printed line is worth the same.
 *
 * What a page cannot show is how the film is directed. The writer's Pacing
 * setting (Format ▸ Genre & Pacing…) scales the whole estimate for that —
 * see utils/scriptProfile.
 */
import type { JSONContent } from '@tiptap/react';
import { jsonBlockText } from './nodeText';
import { getTextLines } from './wrapText';
import { isNonPrintingType } from './nonPrinting';
import { dualColumnsOf, dualDialogueLineCount } from './dualDialogue';
import { DEFAULT_SPACE_BEFORE } from './elementSpacing';
import { CHARS_PER_LINE, activeTemplateHints, getPageMetrics } from '../editor/pagination';
import { DEFAULT_PAGE_LAYOUT, useEditorStore, type PageLayout } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { pacingMultiplier } from './scriptProfile';

// ── Constants ────────────────────────────────────────────────────────

/** One printed page ≈ one minute of screen time — the screenplay standard. */
export const DEFAULT_PAGE_TIME_SECONDS = 60;

/** Elements that make up a dialogue block, for the per-scene breakdown. */
const DIALOGUE_TYPES = new Set(['character', 'dialogue', 'parenthetical', 'lyrics', 'dualDialogue']);

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

/** The page geometry the estimate is measured against. */
export interface TimingOptions {
  /** Printed lines on one page of script body. */
  linesPerPage: number;
  /** Blank lines above each element id. */
  spaceBefore: Record<string, number>;
  /** Per-element line-height multiplier (double-spaced sitcom dialogue). */
  lineHeightMultiplier: Record<string, number>;
  /** Screen time of one full page: 60 for a screenplay, 30 for a sitcom. */
  pageTimeSeconds: number;
  /**
   * The writer's pacing (utils/scriptProfile): 1 for Standard, below for a
   * brisk film, above for a measured one. Scales the estimate, never an
   * override the writer typed in.
   */
  pacingMultiplier: number;
}

/** Letter/A4 with the default template — what a headless caller gets. */
export const DEFAULT_TIMING_OPTIONS: TimingOptions = {
  linesPerPage: getPageMetrics(DEFAULT_PAGE_LAYOUT).linesPerPage,
  spaceBefore: DEFAULT_SPACE_BEFORE,
  lineHeightMultiplier: {},
  pageTimeSeconds: DEFAULT_PAGE_TIME_SECONDS,
  pacingMultiplier: 1,
};

/**
 * Timing options for the open document: its page layout and the active
 * template's spacing and page time. Falls back to the defaults piecewise when
 * a store has not hydrated (tests, headless export).
 */
export function activeTimingOptions(layout?: PageLayout): TimingOptions {
  const opts = { ...DEFAULT_TIMING_OPTIONS };
  try {
    const state = useEditorStore.getState();
    const pageLayout = layout ?? state.pageLayout;
    if (pageLayout) opts.linesPerPage = getPageMetrics(pageLayout).linesPerPage;
    opts.pacingMultiplier = pacingMultiplier(state.scriptProfile?.pacing);
  } catch (err) {
    console.warn('[scriptTiming] could not read page layout, using defaults', err);
  }
  try {
    const hints = activeTemplateHints();
    opts.spaceBefore = hints.spaceBefore;
    opts.lineHeightMultiplier = hints.lineHeightMultiplier;
    const pts = useFormattingTemplateStore.getState().getActiveTemplate()?.pageTimeSeconds;
    if (typeof pts === 'number' && pts > 0) opts.pageTimeSeconds = pts;
  } catch (err) {
    console.warn('[scriptTiming] could not read template, using defaults', err);
  }
  if (!(opts.linesPerPage > 0)) opts.linesPerPage = DEFAULT_TIMING_OPTIONS.linesPerPage;
  if (!(opts.pacingMultiplier > 0)) opts.pacingMultiplier = 1;
  return opts;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Element id of a top-level JSON node — a custom element's own id. */
function elementIdOf(node: JSONContent): string {
  if (node.type === 'customElement' && typeof node.attrs?.customTypeId === 'string') {
    return node.attrs.customTypeId;
  }
  return node.type || '';
}

/**
 * Printed lines an element occupies, excluding the space above it — measured
 * exactly as editor pagination measures it, so a scene's time and its length
 * in pages tell the same story. Hard breaks count as line breaks.
 */
function elementLines(node: JSONContent, opts: TimingOptions): number {
  const type = node.type || '';
  if (type === 'screenplayImage') return Math.max(1, Number(node.attrs?.heightLines) || 8);
  if (type === 'dualDialogue') return dualDialogueLineCount(dualColumnsOf(node, (c) => jsonBlockText(c as JSONContent)));
  const lines = getTextLines(jsonBlockText(node), CHARS_PER_LINE[type] || 62);
  return lines * (opts.lineHeightMultiplier[elementIdOf(node)] ?? 1);
}

// ── Main computation ─────────────────────────────────────────────────

interface SceneAccumulator {
  heading: string;
  dialogueLines: number;
  actionLines: number;
  otherLines: number;
  overrideSeconds: number | null;
}

export function computeSceneTiming(
  doc: JSONContent,
  opts: TimingOptions = activeTimingOptions(),
): TimingResult {
  if (!doc.content) return { scenes: [], totalSeconds: 0 };

  const secondsPerLine = (opts.pageTimeSeconds / opts.linesPerPage) * (opts.pacingMultiplier || 1);
  const scenes: SceneTiming[] = [];
  // Whatever plays before the first scene heading — a cold open's action, a
  // FADE IN: — is screen time too, though it belongs to no scene.
  let preambleLines = 0;
  let current: SceneAccumulator | null = null;
  let isFirst = true;

  for (const node of doc.content) {
    const type = node.type || '';
    // Neither the title page nor a Section/Note is ever on a script page.
    if (type === 'titlePage' || isNonPrintingType(type)) continue;
    // An empty paragraph is the caret's resting place, not script — a new
    // document is one, and must read as no runtime at all rather than "0m".
    if (type !== 'screenplayImage' && type !== 'dualDialogue' && !jsonBlockText(node).trim()) continue;

    const space = isFirst ? 0 : (opts.spaceBefore[elementIdOf(node)] ?? 0);
    const lines = space + elementLines(node, opts);
    isFirst = false;

    if (type === 'sceneHeading') {
      if (current) pushScene(scenes, current, secondsPerLine);
      current = {
        heading: jsonBlockText(node),
        dialogueLines: 0,
        actionLines: 0,
        // The heading's own lines and the gap above it are scene time.
        otherLines: lines,
        overrideSeconds: node.attrs?.timingOverride != null ? Number(node.attrs.timingOverride) : null,
      };
    } else if (!current) {
      preambleLines += lines;
    } else if (DIALOGUE_TYPES.has(type)) {
      current.dialogueLines += lines;
    } else if (type === 'action') {
      current.actionLines += lines;
    } else {
      current.otherLines += lines;
    }
  }

  if (current) pushScene(scenes, current, secondsPerLine);

  let cumulative = Math.round(preambleLines * secondsPerLine);
  for (const scene of scenes) {
    cumulative += scene.finalSeconds;
    scene.cumulativeSeconds = cumulative;
  }

  return { scenes, totalSeconds: cumulative };
}

function pushScene(scenes: SceneTiming[], current: SceneAccumulator, secondsPerLine: number): void {
  const dialogueSeconds = current.dialogueLines * secondsPerLine;
  const actionSeconds = current.actionLines * secondsPerLine;
  const otherSeconds = current.otherLines * secondsPerLine;
  const autoEstimateSeconds = Math.round(dialogueSeconds + actionSeconds + otherSeconds);
  const override = current.overrideSeconds != null && Number.isFinite(current.overrideSeconds)
    ? current.overrideSeconds
    : null;

  scenes.push({
    sceneIndex: scenes.length,
    heading: current.heading,
    autoEstimateSeconds,
    overrideSeconds: override,
    finalSeconds: override ?? autoEstimateSeconds,
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
  // Some content but under half a minute would round to "0m", which reads as
  // "nothing here" on a page that plainly has something on it.
  if (seconds > 0 && seconds < 30) return '<1m';
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
