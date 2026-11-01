import type { JSONContent } from '@tiptap/core';
import { withoutSuggestionsJSON } from '../editor/suggestions';
import { sha256Hex } from './sha256';

/** Increment with incompatible proposal payloads, independently of .odraft's envelope. */
export const REVIEW_SAVE_VERSION = 1;
export const REVIEW_SNAPSHOT_KEY = '_reviewSnapshot';

function documentPart(value: Record<string, unknown>): JSONContent {
  return {
    type: value.type as string,
    ...(value.attrs ? { attrs: value.attrs as JSONContent['attrs'] } : {}),
    content: value.content as JSONContent[],
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
function baselineHash(doc: JSONContent): string {
  return sha256Hex(canonical(doc));
}

function needsReviewEnvelope(node: JSONContent): boolean {
  return (
    !!node.marks?.some((mark) => mark.type === 'suggestionFormat') ||
    !!node.content?.some(needsReviewEnvelope)
  );
}

/**
 * Older schemas see accepted content only. The full live review is metadata,
 * which they ignore, rather than an unknown mark that can empty the document.
 * The fallback hash prevents resurrecting an old review over subsequently edited text.
 */
export function prepareReviewSave<T>(content: T): T {
  if (!content || typeof content !== 'object') return content;
  const payload = content as Record<string, unknown>;
  if (payload.type !== 'doc' || !Array.isArray(payload.content)) return content;
  const doc = documentPart(payload);
  if (!needsReviewEnvelope(doc)) return content;
  const fallback = withoutSuggestionsJSON(doc);
  return {
    ...payload,
    ...fallback,
    [REVIEW_SNAPSHOT_KEY]: {
      version: REVIEW_SAVE_VERSION,
      baseline: baselineHash(fallback),
      document: doc,
    },
  } as T;
}

/** New clients recover pending proposals; legacy edits always win over the sidecar. */
export function restoreReviewContent<T>(content: T): T {
  if (!content || typeof content !== 'object') return content;
  const payload = content as Record<string, unknown>;
  const snapshot = payload[REVIEW_SNAPSHOT_KEY] as
    | { version?: unknown; baseline?: unknown; document?: JSONContent }
    | undefined;
  if (
    !snapshot ||
    snapshot.version !== REVIEW_SAVE_VERSION ||
    typeof snapshot.baseline !== 'string' ||
    !snapshot.document ||
    snapshot.document.type !== 'doc' ||
    !Array.isArray(snapshot.document.content) ||
    payload.type !== 'doc' ||
    !Array.isArray(payload.content)
  )
    return content;
  const current = documentPart(payload);
  // Parsing and loading may both visit the same payload. Restoration is idempotent.
  if (canonical(current) === canonical(snapshot.document)) return content;
  const fallback = withoutSuggestionsJSON(snapshot.document);
  if (
    baselineHash(current) !== snapshot.baseline ||
    baselineHash(fallback) !== snapshot.baseline
  )
    return content;
  return { ...payload, ...snapshot.document } as T;
}

/** Script API write boundaries also cover imports that don't use buildSaveContent. */
export function prepareScriptWrite<T extends { content?: unknown }>(
  data: T,
): T {
  return data.content === undefined
    ? data
    : { ...data, content: prepareReviewSave(data.content) };
}
