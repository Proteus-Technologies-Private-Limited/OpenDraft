/**
 * Plays a Table Read: walks the script line by line, gives each line to the
 * voice cast for it, and keeps the live preview and the editor highlight on
 * the word being spoken (issue #131).
 *
 * One read runs at a time. Every control — pause, skip, a speed change — ends
 * the line in flight through its AbortSignal and, where the read carries on,
 * starts a new run from the right place. Pausing remembers the word the voice
 * had reached, so Resume picks up there instead of from the top of the line.
 */
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../../stores/editorStore';
import { useTableReadStore, NARRATOR_KEY } from '../../stores/tableReadStore';
import { useVoiceSettingsStore } from '../../stores/voiceSettingsStore';
import { tableReadPluginKey, type TableReadMeta } from '../../editor/extensions/TableReadHighlight';
import { buildReadLines, lineIndexAt, spokenRangeToDoc, spokenRangeToText, type ReadLine } from './script';
import { castVoices, inferGenders, type Casting } from './voiceAssign';
import { activeEngineKind, engineFor, NeedsProviderError } from './engines';
import type { TtsEngine, VoiceInfo } from './types';

/** Silence after a line, by what kind of line it was. */
const PAUSE_AFTER: Partial<Record<ReadLine['kind'], number>> = {
  sceneHeading: 450,
  heading: 450,
  transition: 450,
  action: 250,
  character: 60,
  parenthetical: 120,
};
const DEFAULT_PAUSE = 200;
/** How many lines ahead to fetch for engines that synthesise remotely. */
const PREFETCH_AHEAD = 2;

let editorRef: Editor | null = null;
let engine: TtsEngine | null = null;
let voices: VoiceInfo[] = [];
let controller: AbortController | null = null;
let runId = 0;
/** Spoken-text index of the word the voice reached in the current line. */
let reached = 0;
/** Where the current line starts, kept valid across edits made during a read. */
let anchor: number | null = null;
let stale = false;
let detachEditor: (() => void) | null = null;

const store = () => useTableReadStore.getState();

function readOptions() {
  const o = useVoiceSettingsStore.getState().options;
  return {
    readSceneHeadings: o.readSceneHeadings,
    readAction: o.readAction,
    readParentheticals: o.readParentheticals,
    readTransitions: o.readTransitions,
    announceCharacters: o.announceCharacters,
  };
}

function speakersOf(lines: ReadLine[]): string[] {
  const seen: string[] = [];
  for (const l of lines) if (l.speaker && !seen.includes(l.speaker)) seen.push(l.speaker);
  return seen;
}

function cast(lines: ReadLine[]): Casting {
  const kind = store().engineKind ?? activeEngineKind();
  const settings = useVoiceSettingsStore.getState();
  const casting = castVoices({
    kind,
    voices,
    speakers: speakersOf(lines),
    inferred: inferGenders(lines, speakersOf(lines)),
    profiles: useEditorStore.getState().characterProfiles,
    narrator: settings.narratorVoice,
    preferredLang: typeof navigator !== 'undefined' ? navigator.language : 'en',
  });
  const record: Record<string, string | null> = { [NARRATOR_KEY]: casting.narrator };
  for (const [k, v] of casting.bySpeaker) record[k] = v;
  store().patch({ casting: record });
  return casting;
}

/** Narrator for everything but speech; parentheticals are directions, so the narrator reads those too. */
function voiceFor(line: ReadLine, casting: Casting): string | null {
  if (line.speaker && (line.kind === 'dialogue' || line.kind === 'lyrics')) {
    return casting.bySpeaker.get(line.speaker) ?? casting.narrator;
  }
  return casting.narrator;
}

/** Delivery note for the narrator, for voices that take one. */
const NARRATOR_STYLE = 'Neutral, measured narration of a screenplay at a table read';

/** Plain text of a profile's rich-text field. */
function plain(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How a line should be delivered: the parenthetical that directs it, and the
 * speech pattern on the character's profile. Only engines that take a
 * delivery instruction (Gemini) use it; it is never read aloud.
 */
function styleFor(line: ReadLine): string | undefined {
  if (!(line.speaker && (line.kind === 'dialogue' || line.kind === 'lyrics'))) return NARRATOR_STYLE;
  const profile = useEditorStore.getState().characterProfiles.find((p) => p.name === line.speaker);
  const parts = [line.direction, plain(profile?.speechPattern)].filter((p): p is string => !!p);
  const style = parts.join('; ');
  return style ? style.slice(0, 300) : undefined;
}

function highlight(meta: TableReadMeta) {
  const ed = editorRef;
  if (!ed || ed.isDestroyed) return;
  try {
    const tr = ed.state.tr.setMeta(tableReadPluginKey, meta).setMeta('addToHistory', false);
    ed.view.dispatch(tr);
  } catch (err) {
    console.warn('[tableRead] could not update the highlight:', err);
  }
}

/** Keep the line being read on screen, without fighting a writer who scrolled away on purpose mid-line. */
function follow(line: ReadLine) {
  const ed = editorRef;
  if (!ed || ed.isDestroyed || !useVoiceSettingsStore.getState().options.followScript) return;
  try {
    const dom = ed.view.nodeDOM(line.from - 1);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) return;
    const scroller = el.closest('.editor-main') as HTMLElement | null;
    const view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const rect = el.getBoundingClientRect();
    // The panel covers the bottom of the editor; treat that strip as off screen.
    const panel = document.querySelector('.table-read-panel') as HTMLElement | null;
    const bottom = panel ? Math.min(view.bottom, panel.getBoundingClientRect().top) : view.bottom;
    if (rect.top < view.top + 40 || rect.bottom > bottom - 40) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  } catch (err) {
    console.warn('[tableRead] could not scroll to the line:', err);
  }
}

function attach(editor: Editor) {
  if (editorRef === editor) return;
  detachEditor?.();
  editorRef = editor;
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number) => number } } }) => {
    if (!transaction.docChanged) return;
    stale = true;
    if (anchor !== null) anchor = transaction.mapping.map(anchor);
  };
  editor.on('transaction', onTransaction);
  detachEditor = () => {
    editor.off('transaction', onTransaction);
    detachEditor = null;
  };
}

/** Rebuild the lines from the document as it is now. */
function refreshLines(): ReadLine[] {
  const ed = editorRef;
  if (!ed || ed.isDestroyed) return store().lines;
  const lines = buildReadLines(ed.state.doc, readOptions());
  stale = false;
  store().patch({ lines });
  return lines;
}

function abortCurrent() {
  runId++;
  controller?.abort();
  controller = null;
}

async function ensureEngine(): Promise<TtsEngine> {
  const kind = activeEngineKind();
  if (engine && store().engineKind === kind && engine.kind === kind) return engine;
  const found = await engineFor(kind);
  engine = found.engine;
  voices = found.voices;
  store().patch({ engineKind: kind, engineLabel: found.engine.label, voices: found.voices });
  return engine;
}

/** Forget the engine, so the next read picks up changed settings. */
export function resetEngine() {
  engine?.dispose?.();
  engine = null;
  voices = [];
  store().patch({ engineKind: null, engineLabel: '', voices: [] });
}

async function run(startIndex: number, startOffset: number) {
  abortCurrent();
  const myRun = runId;
  const ac = new AbortController();
  controller = ac;
  const alive = () => myRun === runId && !ac.signal.aborted;

  let lines = store().lines;
  let i = startIndex;
  let offset = startOffset;
  store().patch({ status: engine ? 'playing' : 'loading', error: null });

  try {
    const eng = await ensureEngine();
    if (!alive()) return;
    store().patch({ status: 'playing' });
    while (alive()) {
      if (stale && anchor !== null) {
        // The script was edited mid-read: rebuild, and find our place again.
        const at = anchor;
        lines = refreshLines();
        i = lineIndexAt(lines, at);
        offset = 0;
      }
      if (i >= lines.length) break;
      const line = lines[i];
      const casting = cast(lines);
      const voiceId = voiceFor(line, casting);
      const rate = useVoiceSettingsStore.getState().options.rate;
      anchor = line.from;
      reached = offset;
      store().patch({ current: i, word: null });
      highlight({ block: { from: line.from, to: line.to }, word: null });
      follow(line);

      const text = line.spoken.slice(offset);
      const base = offset;
      // Ask for this line before queueing the ones after it: an engine that
      // works one line at a time (Kokoro) would otherwise make the current
      // line wait behind the next two.
      const speaking = eng.speak(text, {
        voiceId,
        rate,
        pitch: 1,
        style: styleFor(line),
        signal: ac.signal,
        onWord: (s, e) => {
          if (!alive()) return;
          reached = base + s;
          store().patch({ word: spokenRangeToText(line, base + s, base + e) });
          highlight({ word: spokenRangeToDoc(line, base + s, base + e) });
        },
      });
      if (eng.prefetch) {
        for (let k = 1; k <= PREFETCH_AHEAD && i + k < lines.length; k++) {
          const next = lines[i + k];
          eng.prefetch(next.spoken, { voiceId: voiceFor(next, casting), rate, pitch: 1, style: styleFor(next) });
        }
      }
      await speaking;
      if (!alive()) return;
      offset = 0;
      i++;
      await new Promise((r) => setTimeout(r, PAUSE_AFTER[line.kind] ?? DEFAULT_PAUSE));
    }
    if (alive()) {
      // Reached the end of the script.
      store().patch({ status: 'idle', word: null, current: 0 });
      highlight({ block: null, word: null });
      controller = null;
    }
  } catch (err) {
    if (!alive()) return;
    controller = null;
    if (err instanceof NeedsProviderError) {
      store().patch({ status: 'idle', needsProvider: true, error: null });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tableRead] read stopped:', err);
    store().patch({ status: 'error', error: message, word: null });
  }
}

/**
 * Where a read starts: the line at the cursor — unless the cursor is on the
 * last line, which is where a freshly opened script leaves it, and a read
 * that starts by finishing would be no read at all.
 */
function startLine(lines: ReadLine[], editor: Editor): number {
  if (!lines.length) return 0;
  const at = lineIndexAt(lines, editor.state.selection.from);
  return at >= lines.length - 1 ? 0 : at;
}

/** Load the script into the panel without starting a read. */
export function prepare(editor: Editor) {
  attach(editor);
  const lines = refreshLines();
  store().patch({ current: startLine(lines, editor), word: null });
  // Find the voices now, so the cast list and the pickers can show who reads
  // whom before the first Play. A missing provider is not an error yet — the
  // writer has not asked to hear anything.
  ensureEngine()
    .then(() => cast(store().lines))
    .catch((err) => {
      if (!(err instanceof NeedsProviderError)) console.info('[tableRead] voices not ready yet:', err);
    });
}

/** Start reading at `index`, or at the cursor when not given. */
export function play(editor: Editor, index?: number) {
  attach(editor);
  const lines = refreshLines();
  if (!lines.length) {
    store().patch({ status: 'error', error: 'There is nothing to read — the script has no lines Table Read can speak with the current settings.' });
    return;
  }
  const at = index ?? startLine(lines, editor);
  void run(Math.max(0, Math.min(at, lines.length - 1)), 0);
}

export function pause() {
  if (store().status !== 'playing') return;
  abortCurrent();
  store().patch({ status: 'paused' });
}

export function resume() {
  const s = store();
  if (s.status !== 'paused' || !editorRef) return;
  if (stale) {
    // Edited while paused: start the current line again rather than mid-word.
    void run(s.current, 0);
    return;
  }
  void run(s.current, reached);
}

export function stop() {
  abortCurrent();
  engine?.dispose?.();
  reached = 0;
  anchor = null;
  store().patch({ status: 'idle', word: null });
  highlight({ block: null, word: null });
}

/** Jump to a line; keeps playing if a read is under way. */
export function jumpTo(index: number) {
  const s = store();
  if (!s.lines.length) return;
  const i = Math.max(0, Math.min(index, s.lines.length - 1));
  if (s.status === 'playing' || s.status === 'loading') {
    void run(i, 0);
    return;
  }
  abortCurrent();
  reached = 0;
  const line = s.lines[i];
  store().patch({ current: i, word: null, status: s.status === 'error' ? 'idle' : s.status });
  highlight({ block: { from: line.from, to: line.to }, word: null });
  follow(line);
}

export function step(delta: number) {
  jumpTo(store().current + delta);
}

/** First line of the next (+1) or previous (-1) scene; -1 from mid-scene goes to this scene's start. */
export function stepScene(delta: 1 | -1) {
  const { lines, current } = store();
  if (!lines.length) return;
  const scene = lines[current]?.sceneIndex ?? -1;
  if (delta > 0) {
    const next = lines.findIndex((l) => l.sceneIndex > scene);
    if (next >= 0) jumpTo(next);
    return;
  }
  const startOfThis = lines.findIndex((l) => l.sceneIndex === scene);
  const target = startOfThis < current ? scene : scene - 1;
  const idx = lines.findIndex((l) => l.sceneIndex === target);
  jumpTo(idx >= 0 ? idx : 0);
}

/** Apply a change in speed, voice or read settings to the line being read now. */
export function restartCurrentLine() {
  const s = store();
  if (s.status !== 'playing') return;
  void run(s.current, reached);
}

/** Rebuild the lines after the read settings change, keeping our place. */
export function rebuild() {
  if (!editorRef) return;
  const s = store();
  const at = s.lines[s.current]?.from ?? editorRef.state.selection.from;
  const lines = refreshLines();
  const idx = lines.length ? lineIndexAt(lines, at) : 0;
  if (s.status === 'playing') {
    void run(idx, 0);
  } else {
    store().patch({ current: idx, word: null });
  }
}

/** Say a short sample in a voice, for choosing one. Stops any read under way. */
export async function previewVoice(kind: 'system' | 'ai', voiceId: string | null, sample: string): Promise<void> {
  if (store().status === 'playing') pause();
  abortCurrent();
  const ac = new AbortController();
  controller = ac;
  const found = await engineFor(kind);
  await found.engine.speak(sample, {
    voiceId,
    rate: useVoiceSettingsStore.getState().options.rate,
    pitch: 1,
    signal: ac.signal,
  });
  if (controller === ac) controller = null;
}

/** Called when the editor goes away or the panel closes. */
export function teardown() {
  stop();
  detachEditor?.();
  editorRef = null;
}
