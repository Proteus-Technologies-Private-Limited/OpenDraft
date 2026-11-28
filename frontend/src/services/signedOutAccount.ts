/**
 * Remembers which account was signed in when a session ended on its own —
 * a refresh token the server refused (most often one left unused past its
 * lifetime), or a 401 with nothing left to renew it with.
 *
 * The sign-in forms read it to pre-fill that email and tell the writer their
 * session ended, with a password reset one tap away. Without it the forms
 * came up blank: the admin console showed people signed out this way trying
 * several other emails, getting "User not found", and creating a second,
 * empty account instead of getting back into the one holding their scripts.
 *
 * A deliberate sign-out (or deleting the account) clears it, as does any
 * successful sign-in. It holds an email the writer typed on this device and
 * nothing else — no token, no user id.
 *
 * It is kept only while the writer has opted in to "Remember email" on this
 * device (the sign-in forms store that email under REMEMBERED_EMAIL_KEY and
 * drop it when the box is unticked). Without that, on a shared computer the
 * next person would be greeted with the previous writer's address. With the
 * preference off, nothing is recorded and any value left from before is
 * removed the next time it is read.
 */

const STORAGE_KEY = 'opendraft:signedOutEmail';
/** Set by the sign-in forms while "Remember email" is ticked. */
export const REMEMBERED_EMAIL_KEY = 'opendraft:rememberedEmail';

function rememberEmailIsOn(): boolean {
  try {
    return Boolean(localStorage.getItem(REMEMBERED_EMAIL_KEY));
  } catch {
    return false;
  }
}

/** Record the email of a session that just ended without the writer asking. */
export function recordSignedOutAccount(email: string | null | undefined): void {
  if (!rememberEmailIsOn()) {
    clearSignedOutAccount();
    return;
  }
  if (!email) return;
  try {
    localStorage.setItem(STORAGE_KEY, email);
  } catch (err) {
    console.warn('[signedOutAccount] could not remember the signed-out email:', err);
  }
}

/** The email of the account whose session ended on its own, if any. */
export function readSignedOutAccount(): string | null {
  let email: string | null;
  try {
    email = localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
  if (email && !rememberEmailIsOn()) {
    // Recorded before this rule, or "Remember email" was unticked since.
    clearSignedOutAccount();
    return null;
  }
  return email;
}

/** Forget it — after a sign-in, or a sign-out the writer chose. */
export function clearSignedOutAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[signedOutAccount] could not clear the signed-out email:', err);
  }
}
