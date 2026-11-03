import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { guardReviewUndo } from './reviewUndo';
import type { YjsLike } from '../../../collab-server/src/services/suggestionGuard';
import { ReviewGate } from '../../../collab-server/src/services/reviewProtocol';
const stamp = { id: 'f', by: 'Ann', at: 1, format: 'bold', before: false, after: true };
function fixture() {
  const doc = new Y.Doc();
  const action = new Y.XmlElement('action');
  const text = new Y.XmlText(); text.insert(0, 'Keep these words.');
  action.insert(0, [text]); doc.getXmlFragment('default').insert(0, [action]);
  const undo = new Y.UndoManager(doc.getXmlFragment('default'), { captureTimeout: 0 });
  const blocked = vi.fn(); let allowed = true;
  guardReviewUndo(undo, () => allowed, blocked);
  return { doc, text, undo, blocked, restrict: () => { allowed = false; }, allow: () => { allowed = true; } };
}
describe('collaborative undo before format capability returns', () => {
  it('leaves history, content and synchronization untouched when undo would restore a proposal', () => {
    const f = fixture();
    f.text.format(0, 4, { suggestionFormat: stamp, bold: {} });
    f.text.format(0, 4, { suggestionFormat: null });
    const before = Y.encodeStateAsUpdate(f.doc);
    const updates = vi.fn(); f.doc.on('update', updates);
    const historyLength = f.undo.undoStack.length;
    f.restrict();
    expect(f.undo.undo()).toBeNull();
    expect(f.blocked).toHaveBeenCalledOnce();
    expect(f.undo.undoStack).toHaveLength(historyLength);
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
    expect(updates).not.toHaveBeenCalled();
    // Ordinary edits and undo still sync while an older peer is present.
    const gate = new ReviewGate(); gate.join('room', 'legacy', false);
    f.doc.on('update', update => gate.checkUpdate(Y as unknown as YjsLike, 'room', f.doc, update, true));
    f.text.insert(f.text.length, ' More.');
    expect(f.undo.undo()).not.toBeNull();
    expect(f.text.toDelta().map((op: { insert: unknown }) => op.insert).join('')).toBe('Keep these words.');
    gate.leave('room', 'legacy');
    f.allow(); expect(f.undo.undo()).not.toBeNull();
    expect(f.text.toDelta()[0].attributes?.suggestionFormat).toEqual(stamp);
    f.undo.destroy(); f.doc.destroy();
  });
  it('blocks redo of a proposal without losing the redo entry', () => {
    const f = fixture();
    f.text.format(0, 4, { suggestionFormat: stamp });
    f.undo.undo(); f.restrict();
    expect(f.undo.redo()).toBeNull(); expect(f.undo.redoStack).toHaveLength(1);
    expect(f.blocked).toHaveBeenCalledOnce();
    f.allow(); expect(f.undo.redo()).not.toBeNull();
    expect(f.text.toDelta()[0].attributes?.suggestionFormat).toEqual(stamp);
    f.undo.destroy(); f.doc.destroy();
  });
  it('allows ordinary undo even when a pending proposal already exists', () => {
    const f = fixture();
    f.text.format(0, 4, { suggestionFormat: stamp });
    f.text.insert(f.text.length, ' More.'); f.restrict();
    expect(f.undo.undo()).not.toBeNull(); expect(f.blocked).not.toHaveBeenCalled();
    expect(f.text.toDelta().map((op: { insert: unknown }) => op.insert).join('')).toBe('Keep these words.');
    f.undo.destroy(); f.doc.destroy();
  });
});
