/**
 * Shared helper for the blank-document data-loss guard.
 *
 * Returns true when a ProseMirror doc/JSON contains any non-whitespace text
 * anywhere in its body. An editor that was reset to its empty default (e.g. on
 * a re-mount before content reloads) serializes to a textless body, and we must
 * never let that overwrite a saved screenplay.
 *
 * Only `content` arrays are walked, so app-metadata keys carried alongside the
 * doc (e.g. `_notes`, `_tagCategories`) do NOT count as body text.
 *
 * Used by both the editor's auto-save guards (ScreenplayEditor.tsx) and the
 * storage-layer guard (local-storage.ts). Kept free of any framework/Tauri
 * imports so it is trivially unit-testable.
 */
export function docHasAnyText(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const node = doc as { type?: string; text?: string; content?: unknown[] };
  if (node.type === 'text' && typeof node.text === 'string' && node.text.trim().length > 0) return true;
  if (Array.isArray(node.content)) {
    for (const child of node.content) if (docHasAnyText(child)) return true;
  }
  return false;
}

/**
 * Decides whether a save would destructively blank a script: the incoming body
 * has no text but the already-stored body does. Returns false (allowed) when no
 * content is being written, when the caller explicitly opts in via
 * `allowEmptyBody`, or when the existing script was already empty (e.g. a brand
 * new screenplay). This is the core blank-document data-loss guard.
 */
export function isDestructiveEmptyOverwrite(
  incoming: unknown,
  existing: unknown,
  allowEmptyBody?: boolean,
): boolean {
  if (incoming === undefined) return false; // content not part of this save
  if (allowEmptyBody) return false;         // caller intentionally clears it
  return !docHasAnyText(incoming) && docHasAnyText(existing);
}
