import { flatten, type YjsLike } from './suggestionGuard';

export const REVIEW_PROTOCOL = 1;
export const REVIEW_COMPATIBILITY_MESSAGE =
  'This screenplay has formatting suggestions. Update OpenDraft or resolve those suggestions before joining.';
export const REVIEW_REFUSED_REASON = REVIEW_COMPATIBILITY_MESSAGE;

type ReviewDocument = InstanceType<YjsLike['Doc']>;

export function supportsReview(token: string): boolean {
  return token.split('|').includes(`review:${REVIEW_PROTOCOL}`);
}

/** Visible marks and buffered marks awaiting dependencies must not reach older schemas. */
export function hasReviewFormats(Y: YjsLike, doc: ReviewDocument): boolean {
  // A later dependency could make buffered format structs visible without
  // sending another ContentFormat struct. Refuse legacy joins until resolved.
  const pending = doc.store?.pendingStructs?.update;
  if (pending && Y.decodeUpdateV2(pending).structs.some(({ content }) =>
    content?.key?.split('--')[0] === 'suggestionFormat'
      && content.value != null && content.value !== false,
  )) return true;
  return flatten(Y, doc.getXmlFragment('default')).some((unit) =>
    unit.kind === 'char' && Object.entries(unit.marks).some(([name, value]) =>
      name.split('--')[0] === 'suggestionFormat' && value != null && value !== false,
    ),
  );
}

/** Reservations cover authentication/loading too, before a connection can receive updates. */
export class ReviewGate {
  private legacy = new Map<string, Set<string>>();

  join(room: string, socket: string, capable: boolean): void {
    if (capable) return;
    let peers = this.legacy.get(room);
    if (!peers) this.legacy.set(room, peers = new Set());
    peers.add(socket);
  }

  leave(room: string, socket: string): void {
    const peers = this.legacy.get(room);
    peers?.delete(socket);
    if (!peers?.size) this.legacy.delete(room);
  }

  hasLegacy(room: string): boolean {
    return this.legacy.has(room);
  }

  checkClient(Y: YjsLike, doc: ReviewDocument, capable: boolean): void {
    if (!capable && hasReviewFormats(Y, doc)) this.refuse();
  }

  checkUpdate(Y: YjsLike, room: string, doc: ReviewDocument, update: Uint8Array, capable: boolean): void {
    if (capable && !this.legacy.has(room)) return;
    // ContentFormat structs carry y-prosemirror marks, including marks nested
    // in new blocks and updates whose dependencies have not arrived yet.
    // Scan the incoming delta only; cursor messages never reach this check.
    const known = Y.decodeStateVector(Y.encodeStateVector(doc));
    const decoded = Y.decodeUpdate(update);
    if (decoded.structs.some(({ id, content }) =>
      id && id.clock >= (known.get(id.client) ?? 0)
        && !decoded.ds.clients.get(id.client)?.some((range) => id.clock >= range.clock && id.clock < range.clock + range.len)
        && content?.key?.split('--')[0] === 'suggestionFormat'
        && content.value != null && content.value !== false,
    )) this.refuse();
  }

  private refuse(): never {
    throw Object.assign(new Error(REVIEW_COMPATIBILITY_MESSAGE), {
      code: 4409,
      reason: REVIEW_REFUSED_REASON,
    });
  }
}
