/**
 * The safe-area insets in CSS px, as `env(safe-area-inset-*)` resolves them.
 *
 * JavaScript has no API for these, so a hidden fixed element padded by them is
 * measured. It is created once and kept: re-reading after a rotation or a fold
 * is one getComputedStyle. Zeros where env() is unsupported or there is no DOM
 * (tests, server rendering).
 */
export interface SafeAreaInsets { top: number; right: number; bottom: number; left: number }

const ZERO: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
let probe: HTMLElement | null = null;

export function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined' || !document.body) return ZERO;
  try {
    if (!probe || !probe.isConnected) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;'
        + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
      document.body.appendChild(probe);
    }
    const style = getComputedStyle(probe);
    const px = (value: string) => {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    };
    return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
  } catch (error) {
    console.warn('[safeArea] could not read the safe-area insets', error);
    return ZERO;
  }
}
