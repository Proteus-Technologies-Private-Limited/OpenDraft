/**
 * Panels moved out of the editor window into windows of their own.
 *
 * Each panel window is a window this editor window opened with
 * `window.open('about:blank')`. It shares this page — the same stores, the
 * same editor — and the editor renders the panels' own React trees into it
 * (PanelWindows). So a panel works there exactly as it does in its dock, and
 * nothing has to be sent between windows.
 *
 * A window holds one panel or several, as tabs: a panel can be popped out
 * into a new window or added to one that is already open. Closing a window
 * puts its panels back in their docks; taking the last panel out of a window
 * closes it.
 *
 * Desktop apps and desktop browsers only: a phone or tablet has no second
 * window to put a panel in.
 */
import { create } from 'zustand';
import { isTauri, isMobileTauri } from '../services/platform';
import { cascade, mirrorDocument, forwardShortcut, parseBounds, placePanelWindow, popupFeatures,
  type DisplayArea, type WindowBounds } from '../utils/panelPopoutDom';

export interface PanelWindowEntry {
  window: Window;
  /** Where the panels render in that window. */
  root: HTMLElement;
  /** The panels in this window, in tab order. */
  panels: string[];
  /** The panel showing. */
  active: string;
  /** Whose remembered size and place the window uses: the panel it opened for. */
  boundsKey: string;
}

/** Where a panel is popped out from, for a window opening there the first
 * time: its area in the editor window (CSS pixels from the editor's top
 * left), or the panel window it leaves. */
export type PanelOrigin = { area: { left: number; top: number; width: number; height: number } } | { windowId: string };

interface PanelPopoutState {
  /** Panel windows by id. */
  windows: Record<string, PanelWindowEntry>;
  /** Which window each popped-out panel is in. */
  placed: Record<string, string>;
  /** Open `panel` in a new window of its own, taking it out of a shared one.
   * Call it straight from a click: browsers block a window opened any later.
   * `from` is the window the click was in. False when none could open. */
  popOut: (panel: string, title: string, from?: Window | null, origin?: PanelOrigin) => boolean;
  /** Move `panel` into an open panel window, as a tab, and bring that window
   * forward. `title`: the window's title with `panel` showing. */
  addToWindow: (panel: string, windowId: string, title?: string) => void;
  /** Bring a panel's tab to the front of its window. */
  showPanel: (panel: string) => void;
  /** Put a panel back in its dock; its window closes when it was the last. */
  returnToDock: (panel: string) => void;
  /** Close a window; its panels go back to their docks. */
  closeWindow: (windowId: string) => void;
  returnAll: () => void;
}

const BOUNDS_KEY = 'opendraft.panelWindow.';
const DEFAULT_SIZE = { width: 380, height: 640 };
/** Tells this page's panel windows apart from another editor window's. */
const pageId = Math.random().toString(36).slice(2, 10);
let nextWindow = 1;
const cleanups = new Map<string, () => void>();

/** Monitor work areas in CSS pixels, read ahead of time: a window has to be
 * opened synchronously in the click, so they cannot be asked for then. */
let displays: DisplayArea[] | null = null;
/** The desktop app's editor window, read the same way: its web view reports
 * no window position to the page (screenX is 0). */
let appEditorBounds: WindowBounds | null = null;
/** Where the desktop app's editor page starts on screen (its content). */
let appEditorContent: { left: number; top: number } | null = null;

/** Panel windows the desktop app places and measures (macOS, Linux), by id,
 * with where each was last. The page cannot read a panel window's place there
 * (panel_windows.rs); elsewhere screenX and friends are right. */
const nativeFrames = new Map<string, WindowBounds | null>();
let frameTimer: number | null = null;

async function invokeApp<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Panel window messages, to the console and, in the desktop app, to the
 * app's own log too (its web view's console is out of reach in a release). */
function panelLog(level: 'info' | 'warn' | 'error', message: string, error?: unknown): void {
  const text = `[panels] ${message}`;
  if (level === 'info') console.info(text);
  else if (error !== undefined) console[level](text, error);
  else console[level](text);
  if (!isTauri()) return;
  const detail = error === undefined ? '' : ` ${error instanceof Error ? error.message : String(error)}`;
  invokeApp('panel_window_log', { level, message: text + detail }).catch(() => { /* the log is best effort */ });
}

export async function refreshPanelDisplays(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const editor = getCurrentWindow();
    const [position, size, scale] = await Promise.all([editor.outerPosition(), editor.outerSize(), editor.scaleFactor()]);
    appEditorBounds = { left: position.x / scale, top: position.y / scale, width: size.width / scale, height: size.height / scale };
    const inner = await editor.innerPosition();
    appEditorContent = { left: inner.x / scale, top: inner.y / scale };
  } catch (error) {
    panelLog('warn', 'Could not read the editor window\'s place.', error);
  }
  try {
    const { availableMonitors } = await import('@tauri-apps/api/window');
    const monitors = await availableMonitors();
    displays = monitors.map((m) => {
      const area = m.workArea ?? { position: m.position, size: m.size };
      return {
        left: area.position.x / m.scaleFactor, top: area.position.y / m.scaleFactor,
        width: area.size.width / m.scaleFactor, height: area.size.height / m.scaleFactor,
      };
    });
  } catch (error) {
    panelLog('warn', 'Could not read the displays; panel windows open beside the editor.', error);
  }
}

export function canPopOutPanels(): boolean {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
  if (isTauri()) return !isMobileTauri();
  const ua = navigator.userAgent || '';
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return false;
  return !(/macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

function readBounds(key: string): WindowBounds | null {
  try { return parseBounds(localStorage.getItem(BOUNDS_KEY + key)); } catch { return null; }
}

/** Where a panel window is: from the app where it measures them, else from
 * the window itself. Null when unknown. */
function boundsOf(id: string, win: Window): WindowBounds | null {
  if (nativeFrames.has(id)) return nativeFrames.get(id) ?? null;
  try {
    if (win.closed || !win.outerWidth || !win.outerHeight) return null;
    return { left: win.screenX, top: win.screenY, width: win.outerWidth, height: win.outerHeight };
  } catch {
    return null;
  }
}

function writeBounds(key: string, bounds: WindowBounds | null): void {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
  try {
    localStorage.setItem(BOUNDS_KEY + key, JSON.stringify({
      left: Math.round(bounds.left), top: Math.round(bounds.top), width: Math.round(bounds.width), height: Math.round(bounds.height),
    }));
  } catch { /* Placement is a convenience; storage may be unavailable. */ }
}

/** Where a new panel window opens the first time: over the panel's place in
 * the editor (`content`: these are the window's content, under its title
 * bar), or on the panel window it leaves. */
function originBounds(origin: PanelOrigin): { bounds: WindowBounds; content: boolean } | null {
  if ('windowId' in origin) {
    const entry = usePanelPopoutStore.getState().windows[origin.windowId];
    const bounds = entry ? boundsOf(origin.windowId, entry.window) : null;
    return bounds ? { bounds, content: false } : null;
  }
  const { area } = origin;
  if (!(area.width > 0 && area.height > 0)) return null;
  let page: { left: number; top: number };
  if (isTauri()) {
    if (!appEditorContent) return null;
    page = appEditorContent;
  } else {
    // A browser's page starts below its toolbars, inside its side borders.
    const side = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    page = { left: window.screenX + side, top: window.screenY + Math.max(0, window.outerHeight - window.innerHeight - side) };
  }
  return {
    bounds: { left: page.left + area.left, top: page.top + area.top, width: area.width, height: area.height },
    content: true,
  };
}

function editorBounds(): WindowBounds {
  if (isTauri() && appEditorBounds) return appEditorBounds;
  return { left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight };
}

/** Ask the app where its panel windows are, now and then (moving a window
 * fires nothing the page hears), and remember each one's place. */
function watchNativeFrames(): void {
  if (frameTimer !== null) return;
  frameTimer = window.setInterval(() => {
    if (!nativeFrames.size) {
      window.clearInterval(frameTimer!);
      frameTimer = null;
      return;
    }
    invokeApp<Array<WindowBounds & { id: string }>>('panel_window_frames')
      .then((frames) => {
        const windows = usePanelPopoutStore.getState().windows;
        for (const { id, ...frame } of frames) {
          if (!nativeFrames.has(id)) continue;
          nativeFrames.set(id, frame);
          const entry = windows[id];
          if (entry) writeBounds(entry.boundsKey, frame);
        }
      })
      .catch((error) => panelLog('warn', 'Could not read where the panel windows are:', error));
    void refreshPanelDisplays();
  }, 1000);
}

function editorScreen(): DisplayArea {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth || s.width, height: s.availHeight || s.height };
}

/** A blank window, made ready to hold panels: the editor's styles and theme,
 * and app shortcuts typed there handled by the editor window. */
function prepare(id: string, boundsKey: string, win: Window, title: string, onGone: () => void): HTMLElement {
  const doc = win.document;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
    + '<body><div class="panel-window-root"></div></body></html>');
  doc.close();
  doc.title = title;
  const root = doc.querySelector<HTMLElement>('.panel-window-root')!;
  const stopMirror = mirrorDocument(document, doc);
  const keydown = (event: KeyboardEvent) => {
    try { forwardShortcut(event, document); } catch (error) { panelLog('error', 'Shortcut not passed on:', error); }
  };
  doc.addEventListener('keydown', keydown);
  // Moving a window fires nothing, so its bounds are read now and then
  // (the app's own windows: by watchNativeFrames).
  let last = '';
  const timer = window.setInterval(() => {
    if (win.closed) { onGone(); return; }
    if (nativeFrames.has(id)) return;
    const bounds = boundsOf(id, win);
    const now = JSON.stringify(bounds);
    if (now !== last) { last = now; writeBounds(boundsKey, bounds); }
  }, 1000);
  const gone = () => { writeBounds(boundsKey, boundsOf(id, win)); onGone(); };
  win.addEventListener('pagehide', gone);
  cleanups.set(id, () => {
    window.clearInterval(timer);
    try {
      win.removeEventListener('pagehide', gone);
      doc.removeEventListener('keydown', keydown);
      stopMirror();
    } catch { /* The window is already gone. */ }
  });
  return root;
}

function dispose(id: string) {
  cleanups.get(id)?.();
  cleanups.delete(id);
  nativeFrames.delete(id);
}

/** Bring a panel window to the front. The macOS app ignores a page's
 * window.focus() for these windows, so the app is asked to raise it. */
function bringForward(id: string, win: Window, title?: string): void {
  try {
    if (title) win.document.title = title;
  } catch (error) {
    panelLog('warn', 'Could not title the panel window:', error);
  }
  if (nativeFrames.has(id)) {
    invokeApp<boolean>('focus_panel_window', { id })
      .then((found) => { if (!found) win.focus(); })
      .catch((error) => {
        panelLog('warn', 'Could not bring the panel window forward:', error);
        try { win.focus(); } catch { /* focus is a courtesy */ }
      });
    return;
  }
  try { win.focus(); } catch { /* focus is a courtesy */ }
}

type Windows = Record<string, PanelWindowEntry>;
type Placed = Record<string, string>;
export interface Grouping { windows: Windows; placed: Placed; emptied: string | null }

/** `panel` taken out of whichever window holds it. `emptied` is the id of a
 * window left with no panels, which the caller closes. The tab showing
 * passes to the one before it. */
export function withoutPanel(windows: Windows, placed: Placed, panel: string): Grouping {
  const id = placed[panel];
  if (!id || !windows[id]) return { windows, placed, emptied: null };
  const nextPlaced = { ...placed };
  delete nextPlaced[panel];
  const entry = windows[id];
  const panels = entry.panels.filter((p) => p !== panel);
  if (!panels.length) return { windows, placed: nextPlaced, emptied: id };
  const active = entry.active === panel ? panels[Math.max(0, entry.panels.indexOf(panel) - 1)] ?? panels[0] : entry.active;
  return { windows: { ...windows, [id]: { ...entry, panels, active } }, placed: nextPlaced, emptied: null };
}

/** `panel` moved into window `id`, as its last tab and the one showing. */
export function withPanelIn(windows: Windows, placed: Placed, panel: string, id: string): Grouping {
  if (!windows[id]) return { windows, placed, emptied: null };
  if (placed[panel] === id) return { windows: { ...windows, [id]: { ...windows[id], active: panel } }, placed, emptied: null };
  const out = withoutPanel(windows, placed, panel);
  const into = out.windows[id];
  return {
    windows: { ...out.windows, [id]: { ...into, panels: [...into.panels, panel], active: panel } },
    placed: { ...out.placed, [panel]: id },
    emptied: out.emptied,
  };
}

export const usePanelPopoutStore = create<PanelPopoutState>((set, get) => {
  /** Close a window that has lost its panels, and forget it. */
  const shut = (id: string) => {
    const entry = get().windows[id];
    panelLog('info', `closing window ${id} (${entry?.panels.join(', ') ?? 'unknown'})`);
    // Where it was, before dispose() forgets the app's measure of it.
    if (entry) writeBounds(entry.boundsKey, boundsOf(id, entry.window));
    dispose(id);
    set((s) => {
      if (!s.windows[id]) return s;
      const windows = { ...s.windows };
      delete windows[id];
      const placed = Object.fromEntries(Object.entries(s.placed).filter(([, w]) => w !== id));
      return { windows, placed };
    });
    if (!entry) return;
    try { entry.window.close(); } catch (error) { panelLog('warn', 'Could not close the panel window:', error); }
  };

  return {
    windows: {},
    placed: {},

    popOut: (panel, title, from, origin) => {
      const { windows, placed } = get();
      const current = placed[panel] ? windows[placed[panel]] : undefined;
      if (current && current.panels.length === 1 && !current.window.closed) { current.window.focus(); return true; }
      if (!canPopOutPanels()) return false;
      const openWindows = Object.entries(windows)
        .map(([openId, e]) => boundsOf(openId, e.window))
        .filter((b): b is WindowBounds => b !== null);
      // Where it was left; the first time, right where the panel was.
      const saved = readBounds(panel);
      const start = saved ? null : origin ? originBounds(origin) : null;
      const content = !!start?.content;
      const bounds = cascade(placePanelWindow(saved ?? start?.bounds ?? null, editorBounds(), editorScreen(),
        isTauri() ? displays : null, DEFAULT_SIZE), openWindows);
      const id = `${pageId}-${nextWindow++}`;
      // A browser lets a click open a window only from the window clicked in;
      // the desktop app opens every panel window through the editor's own.
      const opener = !isTauri() && from && !from.closed ? from : window;
      let win: Window | null = null;
      try {
        // 'about:blank', not '': WebKit hands the desktop app an empty URL for
        // window.open(''), which Tauri cannot parse and so refuses the window
        // before its new-window handler is asked. about:blank still shares this
        // page's origin, so the window's document can be written to.
        win = opener.open('about:blank', `opendraft-panel-${id}`, popupFeatures(bounds));
      } catch (error) {
        panelLog('error', 'window.open failed:', error);
      }
      if (!win) {
        panelLog('warn', `No window opened for "${panel}" (refused by the app or a pop-up blocker).`);
        return false;
      }
      try {
        const opened = win;
        const root = prepare(id, panel, opened, title, () => {
          // The window went (closed by the writer): its panels go back.
          panelLog('info', `window ${id} went; its panels go back`);
          dispose(id);
          set((s) => {
            if (s.windows[id]?.window !== opened) return s;
            const rest = { ...s.windows };
            delete rest[id];
            const placedNow = Object.fromEntries(Object.entries(s.placed).filter(([, w]) => w !== id));
            return { windows: rest, placed: placedNow };
          });
        });
        const out = withoutPanel(get().windows, get().placed, panel);
        set({
          windows: { ...out.windows, [id]: { window: opened, root, panels: [panel], active: panel, boundsKey: panel } },
          placed: { ...out.placed, [panel]: id },
        });
        if (out.emptied) shut(out.emptied);
        opened.focus();
        if (isTauri()) {
          // The app places the window exactly (the page's features cannot,
          // across displays, in the macOS web view) and from now on says
          // where it is. False: the browser engine handles that (Windows).
          nativeFrames.set(id, bounds);
          // The panel's place in this page, for the app to measure exactly.
          const area = start && origin && 'area' in origin ? origin.area : undefined;
          invokeApp<boolean>('panel_window_opened', {
            id, frame: bounds, content, area, viewport: area ? [window.innerWidth, window.innerHeight] : undefined,
          })
            .then((managed) => {
              panelLog('info', `window ${id} (${panel}) opened at ${JSON.stringify(bounds)}; app manages it: ${managed}`);
              if (!managed) { nativeFrames.delete(id); return; }
              if (nativeFrames.has(id)) watchNativeFrames();
            })
            .catch((error) => panelLog('warn', 'The app did not take the panel window:', error));
        }
        return true;
      } catch (error) {
        panelLog('error', 'Could not set up the panel window:', error);
        dispose(id);
        try { win.close(); } catch { /* nothing to close */ }
        return false;
      }
    },

    addToWindow: (panel, windowId, title) => {
      const { windows, placed } = get();
      const target = windows[windowId];
      if (!target || target.window.closed) return;
      const next = withPanelIn(windows, placed, panel, windowId);
      set({ windows: next.windows, placed: next.placed });
      if (next.emptied) shut(next.emptied);
      bringForward(windowId, target.window, title);
    },

    showPanel: (panel) => {
      const id = get().placed[panel];
      const entry = id ? get().windows[id] : undefined;
      if (!entry || entry.active === panel) return;
      set((s) => ({ windows: { ...s.windows, [id]: { ...entry, active: panel } } }));
    },

    returnToDock: (panel) => {
      const out = withoutPanel(get().windows, get().placed, panel);
      if (out.windows === get().windows && out.placed === get().placed) return;
      set({ windows: out.windows, placed: out.placed });
      if (out.emptied) shut(out.emptied);
    },

    closeWindow: (windowId) => shut(windowId),

    returnAll: () => {
      for (const id of Object.keys(get().windows)) shut(id);
    },
  };
});

if (typeof window !== 'undefined') {
  // Panel windows belong to this page: they go when it does (closing the
  // editor window, reloading, signing out to the start screen).
  window.addEventListener('pagehide', () => usePanelPopoutStore.getState().returnAll());
}
