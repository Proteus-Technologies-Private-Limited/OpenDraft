/** Coarse-pointer phones use the screen short side. On iPhone only, use the
 * window so an inner-display Split View pane can return to phone chrome.
 * iPad Slide Over and narrow desktop windows retain the screen rule. */
export function isPhoneDevice(): boolean {
  try {
    if (typeof window === 'undefined' || typeof matchMedia !== 'function') return false;
    if (!matchMedia('(pointer: coarse)').matches) return false;
    const iphone = typeof navigator !== 'undefined' && /iphone/i.test(navigator.userAgent);
    const shortSide = iphone
      ? Math.min(window.innerWidth, window.innerHeight)
      : Math.min(window.screen?.width ?? Infinity, window.screen?.height ?? Infinity);
    return shortSide < 600;
  } catch {
    // matchMedia or screen unavailable (a test runner) — assume not a phone.
    return false;
  }
}

/** Fired on window after html.phone is toggled (main.tsx). */
export const PHONE_DEVICE_CHANGE_EVENT = 'opendraft:phonedevicechange';

/**
 * Call `onChange` whenever the answer above changes.
 *
 * A real phone never stops being one, but the browser can change what it
 * reports under a page that is already open: DevTools device mode switching
 * between a phone and a desktop, a tablet keyboard cover swapping the primary
 * pointer. Checked once at startup, the phone chrome stayed on a desktop-sized
 * window after device mode was turned off. Returns an unsubscribe function.
 */
export function watchPhoneDevice(onChange: (isPhone: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = isPhoneDevice();
  const check = () => {
    const now = isPhoneDevice();
    if (now === last) return;
    last = now;
    onChange(now);
  };

  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  let pointer: MediaQueryList | null = null;
  try {
    pointer = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    // Legacy WebKit has only the deprecated addListener (see Toolbar.tsx).
    if (pointer?.addEventListener) pointer.addEventListener('change', check);
    else pointer?.addListener?.(check);
  } catch {
    pointer = null;
  }

  return () => {
    window.removeEventListener('resize', check);
    window.removeEventListener('orientationchange', check);
    try {
      if (pointer?.removeEventListener) pointer.removeEventListener('change', check);
      else pointer?.removeListener?.(check);
    } catch {
      // Nothing to undo on an engine that never let us subscribe.
    }
  };
}
