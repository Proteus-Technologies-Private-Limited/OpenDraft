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

/**
 * Opens a URL outside the app — the system browser.
 *
 * `window.open` is only right in a browser tab. Inside the iOS web view it
 * returns null and nothing happens, and the Android one takes the whole app
 * down with it, which is how the manual's "Read online" link behaved on both.
 * Tauri opens it through the platform instead: an Intent on Android,
 * UIApplication on iOS, the desktop's default browser elsewhere.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/** True when running as a Tauri desktop app (has sidecar backend). */
export function isDesktopTauri(): boolean {
  return isTauri() && !isMobileTauri();
}

/** How File → Print reaches a printer on this platform. */
export type PrintRoute =
  /** The web view's own print dialog. Desktop and browsers. */
  | 'dialog'
  /** iOS: the exported PDF, handed to the share sheet that carries AirPrint. */
  | 'ios-share-sheet'
  /** Android: the exported PDF, handed to the system print service. */
  | 'android-print-service';

/**
 * Where Print has to send the script, because neither mobile web view can open
 * a print dialog of its own.
 *
 * iOS is the loud failure (issue #97): Tauri swaps `window.print()` for an
 * invoke of `plugin:webview|print` but registers that command on desktop only,
 * so the call rejects with "not allowed by ACL". Granting the permission would
 * not help — there is no iOS implementation behind it, wry's print is
 * macOS-only. AirPrint is reached from the share sheet instead.
 *
 * Android is the quiet one: Tauri leaves `window.print()` alone there, and
 * Android's WebView — unlike Chrome for Android — simply does not implement
 * it, so Print has always been a menu item that did nothing at all. Android
 * prints through PrintManager, which takes a document rather than a page, so
 * that route hands it the same PDF.
 *
 * Both are given the file File → Export → PDF produces, so what comes out of
 * the printer is what the writer would have got out of the exporter.
 */
export function printRoute(): PrintRoute {
  if (isTauri()) {
    const os = getOS();
    if (os === 'ios') return 'ios-share-sheet';
    if (os === 'android') return 'android-print-service';
  }
  return 'dialog';
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

/**
 * Whether this device is one an Apple Pencil can be used with — an iPad.
 *
 * iPhone and iPod run the same OS and report the same way, but no Pencil pairs
 * with them, so the handwriting input is not offered there. iPadOS 13+ sends a
 * desktop-class "Macintosh" user agent, which is why a real Mac has to be told
 * apart by its lack of touch points rather than by its name.
 */
export function supportsApplePencil(): boolean {
  const ua = navigator.userAgent || '';
  if (/iphone|ipod/i.test(ua)) return false;
  if (/ipad/i.test(ua)) return true;
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Whether this device can show more than one OpenDraft window (issue #63).
 *
 * Always true on desktop. On mobile it has to be asked of the platform: iPadOS
 * can tile a second scene but iPhone cannot, and Android needs API 32+. Where
 * the answer is no, a second window would simply cover the document the writer
 * was editing with no way back, so "New Window" is hidden instead.
 */
export async function supportsMultipleWindows(): Promise<boolean> {
  if (!isTauri()) return false;
  if (isDesktopTauri()) return true;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('supports_multiple_windows');
  } catch (err) {
    // An older build without the command, or the check failed: offering a
    // window that cannot open is worse than not offering one.
    console.warn('[platform] could not check multi-window support:', err);
    return false;
  }
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
