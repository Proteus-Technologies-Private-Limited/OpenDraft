/**
 * The open screenplay's "write anything outstanding, now" hook.
 *
 * The editor's auto-save runs on a 30-second tick, so leaving it in between
 * two ticks can drop up to half a minute of typing. Closing the window was
 * always covered — `beforeunload` and Tauri's `onCloseRequested` both flush —
 * but a router navigation fires neither, and the menu has several of those:
 * Manage Projects, Settings, the back control on a script inside a project.
 * Losing work on the way to a screen you can walk straight back from is the
 * data-loss angle issue #65 was really about.
 *
 * ScreenplayEditor registers the flush while it holds a saveable document;
 * anything that navigates away awaits it first. Deliberately a registry rather
 * than a prop: AuthIndicator and the menu bar are nowhere near each other in
 * the tree, and both leave the editor.
 */

type Flush = () => Promise<void>;

let flush: Flush | null = null;

/**
 * Register the open editor's flush. Returns an unregister function; call it on
 * unmount so a torn-down editor is never asked to save (its document is gone,
 * and saving an empty one would overwrite the real file).
 */
export function setPendingSaveFlush(fn: Flush): () => void {
  flush = fn;
  return () => {
    if (flush === fn) flush = null;
  };
}

/**
 * Write out anything the open document has not saved yet.
 *
 * Never throws: the caller is on its way to another screen and a failed save
 * must not strand it there. The editor reports its own save failures, and the
 * blocking SaveErrorDialog lives above the router, so it survives the move.
 */
export async function flushPendingSave(): Promise<void> {
  if (!flush) return;
  try {
    await flush();
  } catch (err) {
    console.error('Flush before leaving the editor failed:', err);
  }
}
