/**
 * The document-origin invariant.
 *
 * `documentOrigin` points Save at a file in Files/iCloud/Dropbox and overwrites
 * it. If an origin ever outlived the document it was opened for, saving would
 * write the *current* screenplay over an unrelated one of the user's files —
 * silent, irreversible data loss in someone else's document.
 *
 * Every path that swaps the open document calls setImportedSource(), so that
 * is where the origin is dropped. These tests pin that down.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

const ORIGIN = { bookmark: 'Ym9va21hcms=', name: 'Act One.fountain', format: 'fountain' };

describe('documentOrigin', () => {
  beforeEach(() => {
    useEditorStore.getState().setDocumentOrigin(null);
    useEditorStore.getState().setImportedSource(null);
  });

  it('holds the origin of a document opened in place', () => {
    useEditorStore.getState().setDocumentOrigin(ORIGIN);
    expect(useEditorStore.getState().documentOrigin).toEqual(ORIGIN);
  });

  it('is dropped when a copy is imported over it', () => {
    useEditorStore.getState().setDocumentOrigin(ORIGIN);
    useEditorStore.getState().setImportedSource({ name: 'Other.fdx', format: 'Final Draft (.fdx)' });
    expect(useEditorStore.getState().documentOrigin).toBeNull();
  });

  // Save As, opening a library script and restoring a recovery snapshot all
  // clear the imported source; none of them may leave the origin behind.
  it('is dropped when the document becomes a library script', () => {
    useEditorStore.getState().setDocumentOrigin(ORIGIN);
    useEditorStore.getState().setImportedSource(null);
    expect(useEditorStore.getState().documentOrigin).toBeNull();
  });

  it('starts out unset, so Save never targets a file by default', () => {
    expect(useEditorStore.getState().documentOrigin).toBeNull();
  });
});
