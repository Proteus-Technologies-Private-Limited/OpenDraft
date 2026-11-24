/**
 * The on-screen keyboard, for code that has to move focus without changing it.
 *
 * A scripted focus() on a text field raises Android's keyboard, so focus put
 * back after a layout change opened a keyboard the writer had closed. Only
 * the Android app can tell whether it was up: its windows are edge to edge,
 * so the keyboard covers the page without resizing anything the page can
 * measure. The activities report it (KeyboardVisibility in
 * src-tauri/android-src/WindowActivities.kt).
 */

interface KeyboardReport { isVisible(): boolean }

/**
 * Whether the soft keyboard is up: true or false in the Android app, null
 * anywhere it cannot be known (iOS, desktop, a browser), where callers keep
 * their usual behaviour.
 */
export function nativeKeyboardVisible(win: unknown = typeof window === 'undefined' ? undefined : window): boolean | null {
  try {
    const report = (win as { OpenDraftKeyboard?: KeyboardReport } | undefined)?.OpenDraftKeyboard;
    if (!report || typeof report.isVisible !== 'function') return null;
    return report.isVisible() === true;
  } catch (error) {
    console.error('[keyboard] could not read the keyboard state:', error);
    return null;
  }
}

/**
 * Where the soft keyboard begins, in CSS pixels from the top of the page, or
 * null when it is down or cannot be known.
 *
 * The page cannot measure this itself in the Android app. Older WebViews
 * report the full height while the keyboard covers half the page; newer ones
 * shrink only the visual viewport and leave the layout at full height, so
 * the browser pans the whole page up to show the caret and the menu bar
 * goes with it. The activities' geometry report (`snapshot()`, in window
 * pixels local to the WebView) says where the keyboard starts either way.
 */
export function nativeKeyboardTop(win: unknown = typeof window === 'undefined' ? undefined : window): number | null {
  try {
    const w = win as { OpenDraftKeyboard?: { snapshot?(): string }; innerWidth?: number } | undefined;
    const bridge = w?.OpenDraftKeyboard;
    if (!bridge || typeof bridge.snapshot !== 'function') return null;
    const r = JSON.parse(bridge.snapshot());
    if (r?.version !== 1 || r.available !== true || r.visible !== true) return null;
    if (![r.width, r.height, r.bottom].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.bottom >= r.height) return null;
    const cssWidth = typeof w?.innerWidth === 'number' && w.innerWidth > 0 ? w.innerWidth : null;
    if (cssWidth === null) return null;
    return r.bottom * cssWidth / r.width;
  } catch (error) {
    console.error('[keyboard] could not read where the keyboard begins:', error);
    return null;
  }
}

/** The parts of a text field focusWithoutKeyboard touches. */
export interface KeyboardField {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  focus(options?: FocusOptions): void;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Put the caret back in a field without raising the on-screen keyboard.
 *
 * On Android a scripted focus() on a text field raises the keyboard, so the
 * writing pad taking focus back when the app returns (#112) brought up a
 * keyboard the writer had closed, and Android then restored it again on
 * every later return to the window. `inputmode="none"` keeps it down for that
 * focus; the field's own mode comes back on the next press on the field —
 * the tap that should raise the keyboard — or when it loses focus. A
 * hardware keyboard and the Pencil are unaffected by inputmode.
 */
export function focusWithoutKeyboard(field: KeyboardField): void {
  const mode = field.getAttribute('inputmode');
  if (mode === 'none') {
    field.focus({ preventScroll: true });
    return;
  }
  const restore = () => {
    field.removeEventListener('pointerdown', restore);
    field.removeEventListener('blur', restore);
    if (mode === null) field.removeAttribute('inputmode');
    else field.setAttribute('inputmode', mode);
  };
  field.setAttribute('inputmode', 'none');
  field.addEventListener('pointerdown', restore, { once: true });
  field.addEventListener('blur', restore, { once: true });
  field.focus({ preventScroll: true });
}
