/** Must match the client schema, not the application's marketing version. */
export const REVIEW_PROTOCOL = 1;
export const REVIEW_COMPATIBILITY_MESSAGE =
  'Update OpenDraft and the collaboration server before using this session. This version requires compatible review support to protect your screenplay.';

/** Authentication runs before document loading or sync, for EVERY role. */
export function requireReviewClient(wireToken: string): string {
  const match = /^od-review\.([0-9]+)\.([^|]+)$/.exec(wireToken);
  if (match && match[1] === String(REVIEW_PROTOCOL)) {
    try {
      const token = decodeURIComponent(match[2]);
      if (token) return token;
    } catch {
      /* malformed envelope */
    }
  }
  throw Object.assign(new Error(REVIEW_COMPATIBILITY_MESSAGE), {
    reason: REVIEW_COMPATIBILITY_MESSAGE,
  });
}
