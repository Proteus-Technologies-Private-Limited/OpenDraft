/**
 * Locked pages — page numbers that stop moving once a script is in production.
 *
 * Tools → Production → Lock Pages records where every page begins by putting
 * the page's printed number on the block it starts with (`lockedPage`). From
 * then on:
 *
 *  - each anchored block opens a new page, so an edit on page 12 can never push
 *    page 13 along — the editor's paginator and the PDF exporter both treat the
 *    anchor as a forced break;
 *  - a page that overflows spills onto 12A, 12B… rather than renumbering
 *    everything after it;
 *  - a page whose anchor has gone (its text deleted, or joined to the page
 *    before) is absorbed: the page before it reads "12-13", or, when page 12
 *    has overflowed, the overflow takes the number 13 back.
 *
 * Anchors live on the document's own nodes, so they sync, undo, save and move
 * with the text like any other attribute. An older version of the app drops
 * the attribute it does not know and simply paginates normally.
 *
 * A page that began part-way through a speech (a (MORE)/(CONT'D) split) is
 * anchored `lockedPageMid`: there the natural split is kept rather than forced,
 * since forcing a break before a dialogue node would lose the (MORE)/(CONT'D).
 */

export const LOCKED_PAGE_ATTR = 'lockedPage';
export const LOCKED_PAGE_MID_ATTR = 'lockedPageMid';

/** Every top-level block type a page can begin with. */
export const LOCKABLE_BLOCK_TYPES = [
  'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical', 'transition',
  'general', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList',
  'customElement', 'dualDialogue', 'screenplayImage', 'avBlock', 'section', 'note',
  'titlePage',
];

/** The anchor a block carries, or null. */
export function lockedPageOf(attrs: Record<string, unknown> | null | undefined): { label: string; mid: boolean } | null {
  const label = attrs?.[LOCKED_PAGE_ATTR];
  if (typeof label !== 'string' || label === '') return null;
  return { label, mid: attrs?.[LOCKED_PAGE_MID_ATTR] === true };
}

/** True when this block must open a page because pages are locked. */
export function startsLockedPage(attrs: Record<string, unknown> | null | undefined): boolean {
  const a = lockedPageOf(attrs);
  return !!a && !a.mid;
}

/** An anchor found in the document, and the page its block now starts on. */
export interface PageAnchor {
  /** 1-based script page the anchored block starts on. */
  page: number;
  label: string;
  mid: boolean;
}

/** A, B … Z, AA, AB … — the letters of the nth page after a locked one. */
export function letterSuffix(n: number): string {
  let s = '';
  let k = n;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

const isWhole = (label: string) => /^\d+$/.test(label);

/**
 * The printed label of every script page, given the anchors in document order.
 *
 * An anchor counts only when it lands after the last one that counted, both in
 * page and in number: a block pasted out of order, or two anchors that edits
 * have pushed onto one page, must not number a page backwards.
 */
export function lockedPageLabels(pageCount: number, anchors: PageAnchor[]): string[] {
  const n = Math.max(0, pageCount);
  const labels: string[] = new Array(n).fill('');
  if (n === 0) return labels;

  const accepted: Array<{ page: number; label: string }> = [];
  for (const a of anchors) {
    const last = accepted[accepted.length - 1];
    // A mid-speech anchor whose speech has fitted back onto the page before
    // numbers the page after it instead.
    const page = a.mid && last && a.page <= last.page ? last.page + 1 : a.page;
    if (page < 1 || page > n) continue;
    if (last && page <= last.page) continue;
    if (last && isWhole(last.label) && isWhole(a.label) && Number(a.label) <= Number(last.label)) continue;
    accepted.push({ page, label: a.label });
  }

  if (accepted.length === 0) {
    for (let p = 1; p <= n; p++) labels[p - 1] = String(p);
    return labels;
  }

  // Before the first locked page: A1, B1 … counting back from it.
  const first = accepted[0];
  for (let p = 1; p < first.page; p++) {
    labels[p - 1] = `${letterSuffix(p)}${first.label}`;
  }

  for (let k = 0; k < accepted.length; k++) {
    const a = accepted[k];
    const next = accepted[k + 1];
    const end = next ? next.page - 1 : n; // last page of this run
    const count = end - a.page + 1;
    // Numbers between this anchor and the next that no longer have a page.
    const missing = next && isWhole(a.label) && isWhole(next.label)
      ? Math.max(0, Number(next.label) - Number(a.label) - 1)
      : 0;
    const base = isWhole(a.label) ? Number(a.label) : null;
    for (let j = 0; j < count; j++) {
      const p = a.page + j;
      if (j === 0) labels[p - 1] = a.label;
      else if (base !== null && j <= missing) labels[p - 1] = String(base + j);
      else {
        const stem = base !== null ? String(base + missing) : a.label;
        labels[p - 1] = `${stem}${letterSuffix(base !== null ? j - missing : j)}`;
      }
    }
    // Fewer pages than numbers: the last page of the run stands for the rest.
    if (base !== null && count - 1 < missing) {
      const p = end;
      const from = base + count - 1;
      labels[p - 1] = `${from}-${base + missing}`;
    }
  }
  return labels;
}

/** A break as the editor's paginator reports it — the fields this needs. */
export interface LockBreak {
  nodeIndex: number;
  pageNumber: number;
  isDialogueSplit: boolean;
  isTitlePage: boolean;
}

/**
 * The page each top-level node starts on (0 for the title page), from the
 * paginator's breaks. Every break begins its page at the start of a node.
 */
export function startPages(nodeCount: number, breaks: LockBreak[]): number[] {
  const titleEnd = breaks.find((b) => b.isTitlePage)?.nodeIndex ?? 0;
  const body = breaks.filter((b) => !b.isTitlePage).sort((a, b) => a.nodeIndex - b.nodeIndex);
  const out = new Array<number>(nodeCount).fill(1);
  let bi = 0;
  let page = 1;
  for (let k = 0; k < nodeCount; k++) {
    if (k < titleEnd) { out[k] = 0; continue; }
    while (bi < body.length && body[bi].nodeIndex <= k) { page = body[bi].pageNumber; bi++; }
    out[k] = page;
  }
  return out;
}

/** What Lock Pages writes: the node index each page starts at, and its label. */
export function lockPlan(
  nodeCount: number,
  breaks: LockBreak[],
  label: (page: number) => string,
): Array<{ nodeIndex: number; label: string; mid: boolean }> {
  if (nodeCount === 0) return [];
  const titleEnd = breaks.find((b) => b.isTitlePage)?.nodeIndex ?? 0;
  if (titleEnd >= nodeCount) return [];
  const plan = [{ nodeIndex: titleEnd, label: label(1), mid: false }];
  for (const b of breaks) {
    if (b.isTitlePage || b.nodeIndex >= nodeCount) continue;
    plan.push({ nodeIndex: b.nodeIndex, label: label(b.pageNumber), mid: b.isDialogueSplit });
  }
  return plan;
}
