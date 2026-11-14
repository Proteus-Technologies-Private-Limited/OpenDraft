/** The writing pad's visible layout-CSS rectangle. Android edge-to-edge IME
 * insets supplement VisualViewport, which can remain full-height. Intersect
 * the two rather than subtracting the keyboard twice on resizing WebViews. */
export function writingViewport(win: Window = window) {
  const vv = win.visualViewport;
  const left = Math.round(vv?.offsetLeft ?? 0);
  const top = Math.round(vv?.offsetTop ?? 0);
  const width = Math.round(vv?.width ?? win.innerWidth);
  let bottom = top + Math.round(vv?.height ?? win.innerHeight);
  let keyboard = false;
  try {
    const bridge = (win as Window & { OpenDraftKeyboard?: { snapshot?(): string } }).OpenDraftKeyboard;
    if (bridge?.snapshot) {
      const r = JSON.parse(bridge.snapshot());
      if (r.version === 1 && r.available === true && r.visible === true
        && [r.width, r.height, r.bottom].every(n => typeof n === 'number' && Number.isFinite(n))
        && r.width > 0 && r.height > 0 && r.bottom >= 0 && r.bottom <= r.height) {
        // Visual width / physical width also accounts for pinch scale. The
        // visible origin follows visual panning; the native edge is local to
        // the WebView, not to the scrolled layout viewport.
        const nativeBottom = top + r.bottom * width / r.width;
        keyboard = r.bottom < r.height;
        if (keyboard) bottom = Math.min(bottom, nativeBottom);
      }
    }
  } catch { /* Optional native geometry; retain browser behavior. */ }
  return { left, top, width, height: Math.max(0, Math.floor(bottom - top)), keyboard };
}

export function subscribeWritingViewport(notify: () => void) {
  window.addEventListener('resize', notify);
  window.addEventListener('opendraft:keyboardchange', notify);
  window.visualViewport?.addEventListener('resize', notify);
  window.visualViewport?.addEventListener('scroll', notify);
  return () => {
    window.removeEventListener('resize', notify);
    window.removeEventListener('opendraft:keyboardchange', notify);
    window.visualViewport?.removeEventListener('resize', notify);
    window.visualViewport?.removeEventListener('scroll', notify);
  };
}
