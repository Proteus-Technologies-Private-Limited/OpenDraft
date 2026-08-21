/**
 * The open document, held across a route change.
 *
 * Settings, the project list and the plugin routes are separate routes, so
 * leaving the editor unmounts ScreenplayEditor and destroys the ProseMirror
 * document with it. A script opened from a `/project/:id/edit/:scriptId` URL is
 * refetched on the way back, but every other way of opening one leaves the URL
 * at `/`:
 *
 *   - File → Open, which sets the project/script in the store and never
 *     navigates
 *   - a file imported from disk, which has no library record at all
 *   - a new screenplay that was never saved
 *
 * Those came back blank. This module keeps the last document in memory (never
 * on disk — that is what backups and the library are for) so the editor can put
 * it back exactly as the writer left it.
 *
 * The stash is identified by project + script id, and reading it consumes it,
 * so a document can never be restored into a context it did not come from.
 */

export interface SessionDoc {
  /** ProseMirror JSON of the document body. */
  doc: unknown;
  projectId: string | null;
  scriptId: string | null;
}

let stash: SessionDoc | null = null;

export function stashSessionDoc(entry: SessionDoc): void {
  stash = entry;
}

/**
 * Take back the stashed document, but only when it belongs to the context asking
 * for it. A mismatch leaves the stash alone: the editor moved on to a different
 * document, and the stashed one may still be wanted if it comes back.
 */
export function takeSessionDoc(
  projectId: string | null,
  scriptId: string | null,
): unknown | null {
  if (!stash) return null;
  if (stash.projectId !== projectId || stash.scriptId !== scriptId) return null;
  const { doc } = stash;
  stash = null;
  return doc;
}

/**
 * Look at the stashed document without consuming it.
 *
 * Only for read-only inspection — the scratch sweeper has to know which images
 * a document held between routes, or visiting Settings with an unsaved
 * screenplay open would make its pictures look unreferenced.
 */
export function peekSessionDoc(): SessionDoc | null {
  return stash;
}

/**
 * Drop the stash. Called wherever the editor is deliberately reset — a new
 * screenplay, a sign-out — so an abandoned document can never reappear in a
 * blank one that happens to share its (null) ids.
 */
export function clearSessionDoc(): void {
  stash = null;
}
