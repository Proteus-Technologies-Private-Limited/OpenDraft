import * as Y from 'yjs';

/** Guard before Yjs mutates: a ProseMirror filter runs after collaborative undo. */
export function guardReviewUndo(manager: Y.UndoManager, allowed: () => boolean, blocked: () => void): () => void {
  const originals = { undo: manager.undo, redo: manager.redo };
  for (const action of ['undo', 'redo'] as const) {
    manager[action] = () => {
      if (!allowed() && restoresReviewFormat(manager, action)) {
        manager.stopCapturing();
        blocked();
        return null;
      }
      return originals[action].call(manager);
    };
  }
  return () => { manager.undo = originals.undo; manager.redo = originals.redo; };
}

/** Preview an occasional history action, never each edit or network message. */
function restoresReviewFormat(manager: Y.UndoManager, action: 'undo' | 'redo'): boolean {
  const stack = action === 'undo' ? manager.undoStack : manager.redoStack;
  if (!stack.length) return false;
  const trial = new Y.Doc({ gc: false });
  const history = new Y.UndoManager(trial.getXmlFragment('default'), {
    deleteFilter: manager.deleteFilter,
    ignoreRemoteMapChanges: manager.ignoreRemoteMapChanges,
  });
  try {
    Y.applyUpdate(trial, Y.encodeStateAsUpdate(manager.doc));
    const vector = Y.encodeStateVector(trial);
    // The trial changes only its own arrays, document and inverse history.
    history.undoStack = manager.undoStack.slice();
    history.redoStack = manager.redoStack.slice();
    history[action]();
    const update = Y.decodeUpdate(Y.encodeStateAsUpdate(trial, vector));
    return update.structs.some((struct) =>
      struct instanceof Y.Item && !Y.isDeleted(update.ds, struct.id)
        && struct.content instanceof Y.ContentFormat
        && struct.content.key.split('--')[0] === 'suggestionFormat'
        && struct.content.value != null && struct.content.value !== false,
    );
  } finally {
    history.destroy();
    trial.destroy();
  }
}
