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
