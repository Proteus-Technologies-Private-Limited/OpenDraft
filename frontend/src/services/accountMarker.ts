/**
 * Remembers, per device, that someone has signed in or signed up here before.
 *
 * The sign-in forms use it to tell first-time visitors that they need to
 * create an account before they can sign in — most failed logins on the
 * public server were people typing a new email and password into Sign In and
 * getting a bare "User not found".
 *
 * It is only a hint, never an auth signal: it holds no email, token or user
 * id, and clearing it just brings the new-user note back.
 *
 * Stored as a cookie (as asked for the web app) and mirrored to localStorage,
 * because cookies on the desktop and mobile webviews' custom schemes
 * (tauri://localhost, http://tauri.localhost) are not reliably persisted.
 * Either one being present counts.
 */

const COOKIE_NAME = 'opendraft_has_account';
const STORAGE_KEY = 'opendraft:hasAccount';
// Set when "remember my email" is ticked — anyone with one has signed in here.
const REMEMBERED_EMAIL_KEY = 'opendraft:rememberedEmail';
const FIVE_YEARS_SEC = 5 * 365 * 24 * 60 * 60;

function readCookie(): boolean {
  try {
    if (typeof document === 'undefined' || !document.cookie) return false;
    return document.cookie.split(';').some((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
  } catch {
    return false;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Record that an account has been used on this device. Safe to call often. */
export function markSignedUp(): void {
  try {
    if (typeof document !== 'undefined') {
      const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${COOKIE_NAME}=1; Max-Age=${FIVE_YEARS_SEC}; Path=/; SameSite=Lax${secure}`;
    }
  } catch (err) {
    console.warn('[accountMarker] could not set cookie:', err);
  }
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch (err) {
    console.warn('[accountMarker] could not write localStorage:', err);
  }
}

/** True when someone has signed in or signed up on this device before. */
export function hasSignedUpBefore(): boolean {
  return readCookie()
    || readStorage(STORAGE_KEY) === '1'
    || Boolean(readStorage(REMEMBERED_EMAIL_KEY));
}
