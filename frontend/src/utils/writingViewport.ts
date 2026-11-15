/** The writing pad's visible layout-CSS rectangle. Android edge-to-edge IME
 * insets supplement VisualViewport, which can remain full-height. Intersect
 * the two rather than subtracting the keyboard twice on resizing WebViews. */
function measureWritingViewport(win: Window) {
  const vv = win.visualViewport;
  const left = Math.round(vv?.offsetLeft ?? 0);
  const originTop = Math.round(vv?.offsetTop ?? 0);
  let top = originTop;
  const width = Math.round(vv?.width ?? win.innerWidth);
  let bottom = top + Math.round(vv?.height ?? win.innerHeight);
  let keyboard = false;
  try {
    const bridge = (win as Window & { OpenDraftKeyboard?: { snapshot?(): string } }).OpenDraftKeyboard;
    if (bridge?.snapshot) {
      const r = JSON.parse(bridge.snapshot());
      const safeTop = r.top ?? 0;
      if (r.version === 1 && r.available === true && typeof r.visible === 'boolean'
        && [r.width, r.height, r.bottom, safeTop].every(n => typeof n === 'number' && Number.isFinite(n))
        && r.width > 0 && r.height > 0 && r.bottom >= 0 && r.bottom <= r.height && safeTop >= 0 && safeTop <= r.height) {
        // Visual width / physical width also accounts for pinch scale. The
        // visible origin follows visual panning; the native edge is local to
        // the WebView, not to the scrolled layout viewport.
        const nativeBottom = originTop + r.bottom * width / r.width;
        top = Math.max(top, originTop + safeTop * width / r.width);
        keyboard = r.visible && r.bottom < r.height;
        if (keyboard) bottom = Math.min(bottom, nativeBottom);
      }
    }
  } catch { /* Optional native geometry; retain browser behavior. */ }
  return { left, top, width, height: Math.max(0, Math.floor(bottom - top)), keyboard };
}

type WritingViewport = Readonly<ReturnType<typeof measureWritingViewport>>;
interface ViewportStore {
  snapshot: WritingViewport;
  listeners: Set<() => void>;
  detach?: () => void;
}
const stores = new WeakMap<Window, ViewportStore>();

function storeFor(win: Window): ViewportStore {
  let store = stores.get(win);
  if (!store) {
    store = { snapshot: measureWritingViewport(win), listeners: new Set() };
    stores.set(win, store);
  }
  return store;
}

/** Stable React snapshot shared by layout, resize and drag consumers. The
 * optional native bridge is read on startup and geometry events, not renders. */
export function writingViewport(win: Window = window): WritingViewport {
  return storeFor(win).snapshot;
}

export function subscribeWritingViewport(notify: () => void, win: Window = window) {
  const existing = stores.has(win);
  const store = storeFor(win);
  const listener = () => notify();
  store.listeners.add(listener);
  if (!store.detach) {
    const refresh = () => {
      const next = measureWritingViewport(win);
      const prev = store.snapshot;
      if (next.left === prev.left && next.top === prev.top && next.width === prev.width
        && next.height === prev.height && next.keyboard === prev.keyboard) return;
      store.snapshot = next;
      for (const listener of store.listeners) listener();
    };
    const viewport = win.visualViewport;
    win.addEventListener('resize', refresh);
    win.addEventListener('opendraft:keyboardchange', refresh);
    viewport?.addEventListener('resize', refresh);
    viewport?.addEventListener('scroll', refresh);
    store.detach = () => {
      win.removeEventListener('resize', refresh);
      win.removeEventListener('opendraft:keyboardchange', refresh);
      viewport?.removeEventListener('resize', refresh);
      viewport?.removeEventListener('scroll', refresh);
    };
    // A bridge event may have arrived between render and first subscription.
    if (existing) refresh();
  }
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    store.listeners.delete(listener);
    if (store.listeners.size === 0) {
      store.detach?.();
      stores.delete(win);
    }
  };
}
