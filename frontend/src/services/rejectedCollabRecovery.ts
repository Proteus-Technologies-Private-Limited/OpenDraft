import type { JSONContent } from '@tiptap/core';

interface Recovery {
  isHost: boolean;
  projectId: string | null;
  scriptId: string | null;
  doc: JSONContent | null;
  preserve: (doc: JSONContent, projectId: string | null, scriptId: string | null) => void;
  disconnect: () => void;
  isCurrent: () => boolean;
  leave: () => void;
  clearGuestProject: () => void;
  markUnsaved: () => void;
  remount: () => void;
}

/** A refused socket must leave a working local editor, retaining the host's project. */
export function recoverRejectedCollaboration(recovery: Recovery): void {
  if (recovery.doc) {
    recovery.preserve(recovery.doc,
      recovery.isHost ? recovery.projectId : null,
      recovery.isHost ? recovery.scriptId : null);
  }
  recovery.disconnect();
  setTimeout(() => {
    if (!recovery.isCurrent()) return;
    recovery.leave();
    if (!recovery.isHost) recovery.clearGuestProject();
    recovery.markUnsaved();
    recovery.remount();
  }, 0);
}
