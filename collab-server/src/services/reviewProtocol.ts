import { flatten, type YjsLike } from './suggestionGuard';

export const REVIEW_PROTOCOL = 1;
export const REVIEW_COMPATIBILITY_MESSAGE =
  'This screenplay has formatting suggestions. Update OpenDraft or resolve those suggestions before joining.';
export const REVIEW_REFUSED_REASON = 'review-incompatible';

type ReviewDocument = InstanceType<YjsLike['Doc']>;

export function supportsReview(token: string): boolean {
  return token.split('|').includes(`review:${REVIEW_PROTOCOL}`);
}

/** Only visible marks matter; deleted Yjs structs cannot damage an older schema. */
export function hasReviewFormats(Y: YjsLike, doc: ReviewDocument): boolean {
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
    const trial = new Y.Doc();
    try {
      Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
      Y.applyUpdate(trial, update);
      if (hasReviewFormats(Y, trial)) this.refuse();
    } finally {
      trial.destroy();
    }
  }

  private refuse(): never {
    throw Object.assign(new Error(REVIEW_COMPATIBILITY_MESSAGE), {
      code: 4409,
      reason: REVIEW_REFUSED_REASON,
    });
  }
}
