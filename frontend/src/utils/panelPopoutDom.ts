/**
 * The document side of popped-out panels.
 *
 * A popped-out panel is the editor's own React tree rendered into a window the
 * editor opened with `window.open()`. That window shares the editor's page, but
 * not its document: the stylesheets, theme and language attributes have to be
 * copied into it, and kept in step, and app shortcuts typed there have to reach
 * the listeners on the editor's document.
 */

/** Copy every stylesheet, and the <html>/<body> attributes, from one document
 * to another, and keep copying as they change (lazy-loaded CSS, theme and
 * language switches). Returns a function that stops. */
export function mirrorDocument(source: Document, target: Document): () => void {
  const copies = new Map<Node, Node>();
  // Relative url()s in the copied rules resolve as they do in the editor.
  if (!target.querySelector('base')) {
    const base = target.createElement('base');
    base.href = source.baseURI;
    target.head.prepend(base);
  }
  /** The rules of a loaded, same-origin stylesheet, or null (not loaded yet,
   * or cross-origin, whose rules cannot be read). */
  const rulesOf = (sheet: CSSStyleSheet | null): string | null => {
    if (!sheet) return null;
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
    } catch {
      return null;
    }
  };
  const styleWith = (css: string, media: string) => {
    const style = target.createElement('style');
    style.textContent = css;
    if (media) style.media = media;
    return style;
  };
  const copyNode = (node: Node): Node | null => {
    if (node instanceof source.defaultView!.HTMLLinkElement && node.rel === 'stylesheet') {
      // The editor's parsed rules: styled at once, nothing fetched again.
      const css = rulesOf(node.sheet);
      if (css !== null) return styleWith(css, node.media);
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      // The resolved URL: a blank window's relative base is not the editor's.
      link.href = node.href;
      if (node.media) link.media = node.media;
      if (!node.sheet) {
        // Still loading in the editor: swap in its rules once it has them.
        node.addEventListener('load', () => {
          if (copies.get(node) !== link) return;
          const loaded = rulesOf(node.sheet);
          if (loaded === null) return;
          const style = styleWith(loaded, node.media);
          link.replaceWith(style);
          copies.set(node, style);
        }, { once: true });
      }
      return link;
    }
    if (node instanceof source.defaultView!.HTMLStyleElement) {
      return styleWith(node.textContent ?? '', node.media);
    }
    return null;
  };
  const add = (node: Node) => {
    const copy = copyNode(node);
    if (!copy) return;
    copies.set(node, copy);
    target.head.appendChild(copy);
  };
  const remove = (node: Node) => {
    const copy = copies.get(node);
    if (!copy) return;
    copies.delete(node);
    copy.parentNode?.removeChild(copy);
  };
  for (const node of Array.from(source.head.childNodes)) add(node);

  const copyAttributes = (from: Element, to: Element) => {
    for (const attr of Array.from(to.attributes)) {
      if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
    }
    for (const attr of Array.from(from.attributes)) {
      if (to.getAttribute(attr.name) !== attr.value) to.setAttribute(attr.name, attr.value);
    }
  };
  copyAttributes(source.documentElement, target.documentElement);
  copyAttributes(source.body, target.body);

  const View = source.defaultView!;
  const observer = new View.MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target === source.documentElement) copyAttributes(source.documentElement, target.documentElement);
        else if (record.target === source.body) copyAttributes(source.body, target.body);
        continue;
      }
      if (record.type === 'characterData' || (record.type === 'childList' && record.target !== source.head)) {
        // Text of a <style> changed (development hot reload): copy it again.
        const style = record.target.nodeType === 3 ? record.target.parentNode : record.target;
        if (style && copies.has(style)) { remove(style); add(style); }
        continue;
      }
      record.removedNodes.forEach(remove);
      record.addedNodes.forEach(add);
    }
  });
  observer.observe(source.head, { childList: true, subtree: true, characterData: true });
  observer.observe(source.documentElement, { attributes: true });
  observer.observe(source.body, { attributes: true });
  return () => {
    observer.disconnect();
    for (const copy of copies.values()) copy.parentNode?.removeChild(copy);
    copies.clear();
  };
}

interface ShortcutLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y']);

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

/** Which keys typed in a panel window are app shortcuts for the editor window:
 * modified keys and function keys, except the text-editing ones (copy, paste,
 * undo, select all) while typing in a field, which belong to that field. */
export function shouldForwardShortcut(event: ShortcutLike): boolean {
  const modified = event.metaKey || event.ctrlKey;
  if (!modified && !/^F\d{1,2}$/.test(event.key)) return false;
  if (modified && isEditable(event.target) && EDITING_KEYS.has(event.key.toLowerCase())) return false;
  return true;
}

/** Re-dispatch a shortcut on the editor's document, so the listeners there
 * (on document or window) handle it as if it had been typed in the editor. */
export function forwardShortcut(event: KeyboardEvent, editorDocument: Document): void {
  if (event.defaultPrevented || !shouldForwardShortcut(event)) return;
  const View = editorDocument.defaultView;
  if (!View) return;
  const copy = new View.KeyboardEvent('keydown', {
    key: event.key, code: event.code, location: event.location, repeat: event.repeat,
    metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey,
    bubbles: true, cancelable: true,
  });
  editorDocument.dispatchEvent(copy);
  if (copy.defaultPrevented) event.preventDefault();
}

export interface WindowBounds { left: number; top: number; width: number; height: number }
export interface DisplayArea { left: number; top: number; width: number; height: number }

/** Smallest panel window: about the narrowest a docked panel is. */
export const MIN_PANEL_WINDOW = { width: 200, height: 240 };

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseBounds(raw: string | null): WindowBounds | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<WindowBounds>;
    if (![b.left, b.top, b.width, b.height].every(finite)) return null;
    return { left: b.left!, top: b.top!, width: b.width!, height: b.height! };
  } catch {
    return null;
  }
}

/** Whether a window there would be reachable: enough of its title bar lies on
 * a display to grab it. */
export function onSomeDisplay(bounds: WindowBounds, displays: DisplayArea[]): boolean {
  const grab = Math.min(60, bounds.width);
  return displays.some((d) => {
    const across = Math.min(bounds.left + bounds.width, d.left + d.width) - Math.max(bounds.left, d.left);
    return across >= grab && bounds.top >= d.top - 10 && bounds.top <= d.top + d.height - 40;
  });
}

/** Where a panel window opens: where it was last, if that is still on a
 * display, otherwise beside the editor window, kept inside the editor's display.
 * `displays` null: unknown (a browser, which keeps windows on screen itself),
 * so the saved place is used as it is. */
export function placePanelWindow(
  saved: WindowBounds | null,
  editor: WindowBounds,
  screen: DisplayArea,
  displays: DisplayArea[] | null,
  size: { width: number; height: number },
): WindowBounds {
  const width = Math.max(MIN_PANEL_WINDOW.width, Math.round(saved?.width ?? size.width));
  const height = Math.max(MIN_PANEL_WINDOW.height, Math.round(saved?.height ?? size.height));
  if (saved && (displays === null || onSomeDisplay({ ...saved, width, height }, displays.length ? displays : [screen]))) {
    return { left: Math.round(saved.left), top: Math.round(saved.top), width, height };
  }
  const clampX = (x: number) => Math.min(Math.max(x, screen.left), screen.left + Math.max(0, screen.width - width));
  const clampY = (y: number) => Math.min(Math.max(y, screen.top), screen.top + Math.max(0, screen.height - height));
  // Prefer the right of the editor window, then its left, then over it.
  const right = editor.left + editor.width + 8;
  const left = right + width <= screen.left + screen.width ? right : editor.left - width - 8;
  return { left: clampX(left), top: clampY(editor.top + 40), width, height };
}

/** A new window stepped down and right, a title bar at a time, off any open
 * window it would otherwise cover exactly — two panels last placed in the same
 * spot would open one on top of the other, as if only one had opened. */
export function cascade(bounds: WindowBounds, open: Array<{ left: number; top: number }>, step = 28): WindowBounds {
  let placed = bounds;
  for (let i = 0; i < 12 && open.some((o) => Math.abs(o.left - placed.left) < 12 && Math.abs(o.top - placed.top) < 12); i++) {
    placed = { ...placed, left: placed.left + step, top: placed.top + step };
  }
  return placed;
}

export function popupFeatures(bounds: WindowBounds): string {
  return `popup=yes,left=${bounds.left},top=${bounds.top},width=${bounds.width},height=${bounds.height}`;
}

/** Watch an element's size with its own window's ResizeObserver. A panel
 * popped out into another window is observed from that window: WebKit
 * processes an observer per document, and one from the editor's window
 * watching the panel window's elements reports "ResizeObserver loop completed
 * with undelivered notifications" as the window settles. Null without
 * ResizeObserver (very old WebViews). */
export function observeSize(element: Element, callback: () => void): ResizeObserver | null {
  const own = element.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const Observer = own?.ResizeObserver ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
  if (!Observer) return null;
  const observer = new Observer(() => callback());
  observer.observe(element);
  return observer;
}
