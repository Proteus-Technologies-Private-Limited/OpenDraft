import { platformFetch } from './platform';

/** Bump when a client cannot safely read the preceding review schema. */
export const REVIEW_PROTOCOL = 1;
/** Probe once before provider creation. Unavailable/older servers still allow text collaboration. */
export async function reviewServerSupportsFormatting(
  wsUrl: string,
  fetcher: (
    url: string,
    options?: RequestInit,
  ) => Promise<Response> = platformFetch,
): Promise<boolean> {
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
    if (!response.ok) return false;
    const body = await response.json();
    return body?.service === 'opendraft-collab' && body?.reviewProtocol === REVIEW_PROTOCOL;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function reviewAuthToken(token: string): string {
  // Legacy servers ignore unknown compound-token fields.
  const credential = token.includes('|') ? token : `invite:${token}`;
  return `${credential}|review:${REVIEW_PROTOCOL}`;
}

/** Also check restored review snapshots before seeding an older server. */
export function hasPendingFormat(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasPendingFormat);
  const node = value as Record<string, unknown>;
  return node.type === 'suggestionFormat' || Object.values(node).some(hasPendingFormat);
}
