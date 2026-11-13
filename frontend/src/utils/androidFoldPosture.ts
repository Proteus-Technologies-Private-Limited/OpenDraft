/** Optional Android WindowManager bridge. It exposes geometry only, with no
 * persistent capability flag. Coordinates arrive in window pixels and must
 * be translated/scaled into this WebView's layout-viewport CSS pixels. */
export const ANDROID_FOLD_CHANGE_EVENT = 'opendraft:androidfoldchange';
export interface AndroidFoldSnapshot {
  version: 1;
  status: 'pending' | 'available' | 'unavailable';
  active: boolean;
  confirmed: boolean;
  webView: { left: number; top: number; width: number; height: number };
  feature: { left: number; top: number; width: number; height: number; orientation: 'horizontal' | 'vertical'; folded: boolean } | null;
}
type BridgeWindow = Window & { OpenDraftAndroidFold?: { snapshot(): string } };
const rect = (value: unknown): value is AndroidFoldSnapshot['webView'] => {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return ['left', 'top', 'width', 'height'].every(key => typeof r[key] === 'number' && Number.isFinite(r[key]))
    && (r.width as number) >= 0 && (r.height as number) >= 0;
};

export function readAndroidFoldSnapshot(): AndroidFoldSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = (window as BridgeWindow).OpenDraftAndroidFold?.snapshot();
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const s = data as AndroidFoldSnapshot;
    if (s.version !== 1 || !['pending', 'available', 'unavailable'].includes(s.status)
      || typeof s.active !== 'boolean' || typeof s.confirmed !== 'boolean' || !rect(s.webView)) return null;
    const f = s.feature;
    if (f !== null && (!rect(f) || !['horizontal', 'vertical'].includes(f.orientation) || typeof f.folded !== 'boolean')) return null;
    // Copy fixed fields only; diagnostics never copy arbitrary native data.
    const copyRect = (r: AndroidFoldSnapshot['webView']) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
    return { version: 1, status: s.status, active: s.active, confirmed: s.confirmed,
      webView: copyRect(s.webView), feature: f ? { ...copyRect(f), orientation: f.orientation, folded: f.folded } : null };
  } catch { return null; }
}

export function androidFoldGeometry(snapshot: AndroidFoldSnapshot, width: number, height: number): { fold: 'flat' | 'laptop' | 'book'; foldRect: DOMRect | null } {
  const flat = { fold: 'flat' as const, foldRect: null };
  const { feature: f, webView: v } = snapshot;
  if (!snapshot.active || snapshot.status !== 'available' || !snapshot.confirmed || !f
    || v.width <= 0 || v.height <= 0 || width <= 0 || height <= 0) return flat;
  const x = (f.left - v.left) * width / v.width;
  const y = (f.top - v.top) * height / v.height;
  const w = f.width * width / v.width;
  const h = f.height * height / v.height;
  // A hinge elsewhere in the Activity must not split a single-half WebView.
  // Cross-axis clipping accounts for system insets / edge-to-edge placement.
  if (f.orientation === 'vertical' && x > 0 && x + w < width && y <= 0 && y + h >= height) {
    return { fold: f.folded ? 'book' : 'flat', foldRect: new DOMRect(x, 0, w, height) };
  }
  if (f.orientation === 'horizontal' && y > 0 && y + h < height && x <= 0 && x + w >= width) {
    return { fold: f.folded ? 'laptop' : 'flat', foldRect: new DOMRect(0, y, width, h) };
  }
  return flat;
}
