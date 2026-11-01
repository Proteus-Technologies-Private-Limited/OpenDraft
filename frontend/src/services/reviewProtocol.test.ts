import { describe, expect, it, vi } from 'vitest';
import {
  requireReviewServer,
  reviewAuthToken,
  REVIEW_PROTOCOL,
} from './reviewProtocol';
import {
  requireReviewClient,
  REVIEW_PROTOCOL as SERVER_PROTOCOL,
} from '../../../collab-server/src/services/reviewProtocol';
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

describe('review compatibility before any document sync', () => {
  it('keeps client and server protocol declarations aligned', () => {
    expect(REVIEW_PROTOCOL).toBe(SERVER_PROTOCOL);
    expect(requireReviewClient(reviewAuthToken('my-invite'))).toBe('my-invite');
    expect(
      requireReviewClient(reviewAuthToken('jwt:access|invite:my-invite')),
    ).toBe('jwt:access|invite:my-invite');
  });
  it('refuses legacy hosts, editors, viewers and suggesters before role handling', () => {
    for (const token of [
      'invite',
      'jwt:access|invite:token',
      'invite:token|review:0',
      'invite:token|review:999',
      `od-review.${REVIEW_PROTOCOL}.%invalid`,
      `od-review.999.invite`,
    ]) {
      expect(() => requireReviewClient(token)).toThrow('Update OpenDraft');
    }
  });
  it('makes the auth envelope unusable by legacy servers even behind mixed-version load balancers', () => {
    for (const token of ['my-invite', 'jwt:access|invite:my-invite']) {
      const wire = reviewAuthToken(token);
      expect(wire).not.toContain('|');
      expect(wire).not.toBe('my-invite');
      // Old servers treat any token without a pipe as a plain invite. The
      // envelope is not a valid invite, so they cannot sync this client.
      expect(requireReviewClient(wire)).toBe(token);
    }
  });
  it('checks the configured server without sending script or authentication data', async () => {
    const fetcher = vi.fn(async () =>
      response({
        service: 'opendraft-collab',
        reviewProtocol: REVIEW_PROTOCOL,
      }),
    );
    await requireReviewServer('wss://example.test/collab/', fetcher);
    expect(fetcher).toHaveBeenCalledWith('https://example.test/collab/health', {
      cache: 'no-store',
    });
  });
  it('fails closed for old/mismatched servers and unavailable/malformed responses', async () => {
    for (const fetcher of [
      async () => response({ service: 'opendraft-collab' }),
      async () =>
        response({ service: 'opendraft-collab', reviewProtocol: 999 }),
      async () =>
        response({ service: 'other', reviewProtocol: REVIEW_PROTOCOL }),
      async () => response({}, 503),
      async () => new Response('not JSON'),
      async () => {
        throw new Error('Offline');
      },
    ])
      await expect(
        requireReviewServer('ws://example.test', fetcher),
      ).rejects.toThrow('Update OpenDraft');
  });
  it('does not cache verification across reconnects or server downgrades', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          service: 'opendraft-collab',
          reviewProtocol: REVIEW_PROTOCOL,
        }),
      )
      .mockResolvedValueOnce(response({ service: 'opendraft-collab' }));
    await requireReviewServer('ws://example.test', fetcher);
    await expect(
      requireReviewServer('ws://example.test', fetcher),
    ).rejects.toThrow('Update OpenDraft');
  });
});
