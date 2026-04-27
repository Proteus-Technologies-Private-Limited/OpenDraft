/**
 * Platform detection utilities.
 *
 * Determines whether we are running as:
 *  - a plain web app in the browser,
 *  - a Tauri desktop app (macOS / Windows / Linux), or
 *  - a Tauri mobile app (iOS / Android).
 *
 * On mobile Tauri the Python sidecar backend is unavailable, so the
 * frontend uses a local SQLite database for storage instead of HTTP.
 */

/** True when running inside any Tauri WebView (desktop or mobile). */
export function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

/** True when running inside a Tauri *mobile* WebView (iOS or Android). */
export function isMobileTauri(): boolean {
  if (!isTauri()) return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ sends a desktop-class UA ("Macintosh") so also check touch
  return /android/i.test(ua) || /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/** True when running as a Tauri desktop app (has sidecar backend). */
export function isDesktopTauri(): boolean {
  return isTauri() && !isMobileTauri();
}

/** True when running as a plain browser web app (no Tauri). */
export function isWeb(): boolean {
  return !isTauri();
}

/** Detects the OS from the user agent. */
export function getOS(): 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'unknown' {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS 13+ uses a desktop-class user agent containing "Macintosh".
  // Detect it via touch support — real Macs have maxTouchPoints === 0.
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return 'unknown';
}

/** True when the window uses a custom titlebar (decorations: false).
 *  On Tauri desktop the MenuBar acts as the titlebar with window controls. */
export function hasCustomTitlebar(): boolean {
  return isDesktopTauri();
}

/**
 * Platform-aware fetch that works around Tauri's mixed-content restriction.
 *
 * The Tauri WebView loads from https://tauri.localhost, so browser fetch()
 * to plain http:// addresses (collab server, local backends) is blocked by
 * WKWebView as mixed content.  On Tauri we route through a Rust command
 * that uses curl; on web we use standard fetch().
 */
/**
 * Read a header value from any of the three shapes RequestInit.headers can
 * take: Headers, Record<string,string>, or [name,value][]. The previous
 * implementation only handled the plain-object form, which silently dropped
 * the Authorization header that authedFetch attaches via `new Headers()` —
 * resulting in a 401 storm on every authed request from Tauri.
 */
function pickHeader(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => String(k).toLowerCase() === lower);
    return hit ? hit[1] : undefined;
  }
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export async function platformFetch(url: string, options?: RequestInit): Promise<Response> {
  if (!isTauri()) return fetch(url, options);

  const method = options?.method || 'GET';
  console.log(`[platformFetch] ${method} ${url} (via Tauri invoke)`);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ status: number; body: string }>('http_fetch', {
      url,
      method,
      body: typeof options?.body === 'string' ? options.body : undefined,
      contentType: pickHeader(options?.headers, 'Content-Type'),
      authorization: pickHeader(options?.headers, 'Authorization'),
    });

    console.log(`[platformFetch] ${method} ${url} → ${result.status} (${result.body.length} bytes)`);

    return new Response(result.body, {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[platformFetch] ${method} ${url} → invoke FAILED:`, err);
    throw err;
  }
}
