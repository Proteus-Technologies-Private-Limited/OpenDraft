/**
 * Runtime estimate — one printed page ≈ one minute.
 *
 * Issue #144: the status bar's "Est." runtime counted words at 250 per page
 * and gave cues, headings and blank lines no time, so a feature came out far
 * shorter than Fade In or Screenweaver report. The estimate now measures
 * printed lines, white space included, and these tests hold it to the rule of
 * thumb against the editor's own page breaks.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import {
  computeSceneTiming, DEFAULT_TIMING_OPTIONS, formatRuntime, type TimingOptions,
} from './scriptTiming';
import { computeBreaks, getPageMetrics } from '../editor/pagination';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { DEFAULT_SPACE_BEFORE } from './elementSpacing';
import { pmDoc } from '../test/screenplaySchema';

const block = (type: string, text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type, ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const LETTER = { ...DEFAULT_PAGE_LAYOUT, pageWidth: 8.5, pageHeight: 11 };
const A4 = DEFAULT_PAGE_LAYOUT;
const optsFor = (layout: typeof A4, extra: Partial<TimingOptions> = {}): TimingOptions => ({
  ...DEFAULT_TIMING_OPTIONS,
  linesPerPage: getPageMetrics(layout).linesPerPage,
  ...extra,
});

// ── A deterministic, realistically shaped feature screenplay ──────────────

const WORDS = (
  'the a she he it door window light rain car street table looks turns walks ' +
  'slowly back into dark room hand phone gun quiet beat across toward old ' +
  'never what why you know me this that right now just maybe here there'
).split(' ');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function sentence(rand: () => number, min: number, max: number): string {
  const n = min + Math.floor(rand() * (max - min + 1));
  const words = Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  return words.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

/**
 * Scenes of a heading, a short action paragraph or two, and an exchange of
 * speeches — the shape of a typical spec feature, at roughly 55% dialogue.
 */
function featureScript(scenes: number, seed = 7): JSONContent {
  const rand = rng(seed);
  const content: JSONContent[] = [block('transition', 'FADE IN:')];
  const cast = ['MAYA', 'DETECTIVE ROSS', 'ELI', 'DR. OKAFOR'];
  for (let s = 0; s < scenes; s++) {
    content.push(block('sceneHeading', `${rand() < 0.6 ? 'INT.' : 'EXT.'} LOCATION ${s + 1} - ${rand() < 0.5 ? 'DAY' : 'NIGHT'}`));
    const actions = 1 + Math.floor(rand() * 2);
    for (let a = 0; a < actions; a++) {
      const sentences = 1 + Math.floor(rand() * 3);
      content.push(block('action', Array.from({ length: sentences }, () => sentence(rand, 6, 14)).join(' ')));
    }
    const speeches = 2 + Math.floor(rand() * 6);
    for (let d = 0; d < speeches; d++) {
      content.push(block('character', cast[Math.floor(rand() * cast.length)]));
      if (rand() < 0.15) content.push(block('parenthetical', '(quietly)'));
      const lines = 1 + Math.floor(rand() * 2);
      content.push(block('dialogue', Array.from({ length: lines }, () => sentence(rand, 3, 12)).join(' ')));
      if (rand() < 0.3) content.push(block('action', sentence(rand, 5, 12)));
    }
    if (rand() < 0.1) content.push(block('transition', 'CUT TO:'));
  }
  return doc(...content);
}

const wordCount = (json: JSONContent): number =>
  (json.content ?? []).reduce((n, b) =>
    n + (b.content ?? []).reduce((m, t) => m + (t.text ?? '').split(/\s+/).filter(Boolean).length, 0), 0);

// ── The rule of thumb ─────────────────────────────────────────────────────

describe('one page ≈ one minute', () => {
  for (const [name, layout] of [['US Letter', LETTER], ['A4', A4]] as const) {
    it(`a ~110-page feature on ${name} runs ~110 minutes`, () => {
      const json = featureScript(150);
      const pages = computeBreaks(pmDoc(json), layout).pageCount;
      const minutes = computeSceneTiming(json, optsFor(layout)).totalSeconds / 60;

      // The sample is a believable screenplay page, not prose: Fade In and
      // Final Draft pages carry roughly 150-200 words.
      const wordsPerPage = wordCount(json) / pages;
      expect(wordsPerPage).toBeGreaterThan(140);
      expect(wordsPerPage).toBeLessThan(220);

      // Content-based, so the white space pagination leaves at a page foot
      // (a heading pushed over, a speech kept together) is not charged —
      // but the estimate stays within a few minutes of the page count.
      expect(minutes / pages).toBeGreaterThan(0.9);
      expect(minutes / pages).toBeLessThanOrEqual(1.0);
    });
  }

  it('a page full of lines is exactly one minute', () => {
    const lpp = getPageMetrics(LETTER).linesPerPage; // 54
    // Action at 62 chars/line: one paragraph, no space above (first element).
    const json = doc(block('sceneHeading', 'INT. ROOM - DAY'),
      ...Array.from({ length: (lpp - 1) / 1 }, () => block('general', 'X')));
    const opts = optsFor(LETTER, { spaceBefore: { ...DEFAULT_SPACE_BEFORE, general: 0 } });
    expect(computeSceneTiming(json, opts).totalSeconds).toBe(60);
  });

  it('was badly under the old 250-words-per-page basis', () => {
    const json = featureScript(150);
    const pages = computeBreaks(pmDoc(json), LETTER).pageCount;
    const oldMinutes = wordCount(json) / 250; // ~1 minute per 250 words
    expect(oldMinutes / pages).toBeLessThan(0.85);
  });
});

// ── White space is screen time ────────────────────────────────────────────

describe('lines, not words', () => {
  const opts = optsFor(LETTER);
  const perLine = 60 / opts.linesPerPage;

  it('a one-line speech costs its blank line, its cue and its line', () => {
    const base = doc(block('sceneHeading', 'INT. ROOM - DAY'));
    const withSpeech = doc(block('sceneHeading', 'INT. ROOM - DAY'),
      block('character', 'MAYA'), block('dialogue', 'Hi.'));
    const delta = computeSceneTiming(withSpeech, opts).scenes[0].breakdown.dialogueSeconds
      - computeSceneTiming(base, opts).scenes[0].breakdown.dialogueSeconds;
    expect(delta).toBe(Math.round(3 * perLine));
  });

  it('dialogue wraps in its narrow column, so it takes more lines than action', () => {
    const text = sentence(rng(1), 40, 40);
    const speech = computeSceneTiming(doc(block('sceneHeading', 'INT. A - DAY'),
      block('dialogue', text)), opts).scenes[0].breakdown.dialogueSeconds;
    const action = computeSceneTiming(doc(block('sceneHeading', 'INT. A - DAY'),
      block('action', text)), opts).scenes[0].breakdown.actionSeconds;
    expect(speech).toBeGreaterThan(action);
  });

  it('a scene heading gets its two lines of air', () => {
    const one = computeSceneTiming(doc(block('sceneHeading', 'INT. A - DAY')), opts);
    const two = computeSceneTiming(doc(block('sceneHeading', 'INT. A - DAY'),
      block('sceneHeading', 'INT. B - DAY')), opts);
    expect(two.totalSeconds - one.totalSeconds).toBe(Math.round(3 * perLine));
  });

  it('Sections, Notes and the title page are not on the clock', () => {
    const plain = doc(block('sceneHeading', 'INT. A - DAY'), block('action', 'She waits.'));
    const annotated = doc(
      { type: 'titlePage', attrs: {} },
      block('section', 'ACT ONE'),
      block('sceneHeading', 'INT. A - DAY'),
      block('note', 'tighten this'),
      block('action', 'She waits.'),
    );
    expect(computeSceneTiming(annotated, opts).totalSeconds)
      .toBe(computeSceneTiming(plain, opts).totalSeconds);
  });

  it('a blank new document has no runtime, and empty paragraphs add none', () => {
    expect(computeSceneTiming(doc({ type: 'action', content: [] }), opts).totalSeconds).toBe(0);
    const plain = doc(block('sceneHeading', 'INT. A - DAY'), block('action', 'She waits.'));
    const withBlanks = doc(block('sceneHeading', 'INT. A - DAY'), { type: 'action', content: [] },
      block('action', 'She waits.'), { type: 'dialogue', content: [{ type: 'text', text: '   ' }] });
    expect(computeSceneTiming(withBlanks, opts).totalSeconds).toBe(computeSceneTiming(plain, opts).totalSeconds);
  });

  it('a few lines read as under a minute, not as "0m"', () => {
    expect(formatRuntime(12)).toBe('<1m');
    expect(formatRuntime(0)).toBe('0m');
    expect(formatRuntime(45)).toBe('1m');
    expect(formatRuntime(6420)).toBe('1h 47m');
  });

  it('a cold open before the first heading counts toward the total', () => {
    const json = doc(block('action', 'Darkness. A heartbeat.'), block('sceneHeading', 'INT. A - DAY'));
    const r = computeSceneTiming(json, opts);
    expect(r.totalSeconds).toBeGreaterThan(r.scenes[0].finalSeconds);
    expect(r.scenes[0].cumulativeSeconds).toBe(r.totalSeconds);
  });

  it('honours the template page time (a sitcom page is 30 seconds)', () => {
    const json = featureScript(20);
    const film = computeSceneTiming(json, opts).totalSeconds;
    const sitcom = computeSceneTiming(json, { ...opts, pageTimeSeconds: 30 }).totalSeconds;
    expect(Math.abs(sitcom - film / 2)).toBeLessThanOrEqual(1);
  });

  it('a manual scene override still wins', () => {
    const json = doc(block('sceneHeading', 'INT. A - DAY', { timingOverride: 90 }), block('action', 'Long.'));
    const scene = computeSceneTiming(json, opts).scenes[0];
    expect(scene.finalSeconds).toBe(90);
    expect(scene.autoEstimateSeconds).not.toBe(90);
  });
});
