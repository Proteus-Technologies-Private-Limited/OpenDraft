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

/**
 * Decides how the open document is left behind. Registered by the menu bar,
 * which owns the unsaved-changes dialog; null while no editor is mounted.
 */
type LeaveGuard = (go: () => void) => void;

let leaveGuard: LeaveGuard | null = null;

/**
 * Register the guard that runs before leaving the editor for another screen.
 * Returns an unregister function, for the same reason as the flush above.
 */
export function setLeaveGuard(fn: LeaveGuard): () => void {
  leaveGuard = fn;
  return () => {
    if (leaveGuard === fn) leaveGuard = null;
  };
}

/**
 * Leave the editor for another screen of the app.
 *
 * With auto-save on, that means flushing first and going. With it off, the
 * writer has said nothing is written unless they ask (issue #135), so the
 * guard asks rather than saving on their behalf — a script reloaded from the
 * library on the way back would otherwise come back without their edits.
 */
export async function leaveEditor(go: () => void): Promise<void> {
  if (leaveGuard) {
    try {
      leaveGuard(go);
      return;
    } catch (err) {
      console.error('Leave guard failed; flushing instead:', err);
    }
  }
  await flushPendingSave();
  go();
}
