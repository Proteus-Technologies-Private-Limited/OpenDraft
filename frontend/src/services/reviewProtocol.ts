import { platformFetch } from './platform';

/** Bump when a client cannot safely read the preceding review schema. */
export const REVIEW_PROTOCOL = 1;
export const REVIEW_COMPATIBILITY_MESSAGE =
  'Update OpenDraft and the collaboration server before using this session. This version requires compatible review support to protect your screenplay.';

/** Checked before provider creation and again before every authentication/reconnect. */
export async function requireReviewServer(
  wsUrl: string,
  fetcher: (
    url: string,
    options?: RequestInit,
  ) => Promise<Response> = platformFetch,
): Promise<void> {
  const base = wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/$/, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      fetcher(`${base}/health`, { cache: 'no-store' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Compatibility check timed out.')),
          10000,
        );
      }),
    ]);
    if (!response.ok) throw new Error(REVIEW_COMPATIBILITY_MESSAGE);
    const body = await response.json();
    if (
      body?.service !== 'opendraft-collab' ||
      body?.reviewProtocol !== REVIEW_PROTOCOL
    ) {
      throw new Error(REVIEW_COMPATIBILITY_MESSAGE);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === REVIEW_COMPATIBILITY_MESSAGE
    )
      throw error;
    throw new Error(
      `${REVIEW_COMPATIBILITY_MESSAGE} Could not verify the server.`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function reviewAuthToken(token: string): string {
  // A legacy server must NOT find a valid invite inside a compound token.
  // It treats this entire envelope as an invalid invite, before loading/sync.
  return `od-review.${REVIEW_PROTOCOL}.${encodeURIComponent(token)}`;
}
