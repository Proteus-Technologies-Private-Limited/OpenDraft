/**
 * Choosing the picture that goes in a storyboard frame.
 *
 * Lives here rather than in the menu because the menu is not the only way in:
 * the obvious gesture is to double-click the empty frame itself, and the node
 * view needs the same path — upload to the project's asset store, then a
 * partial `setAvRowImage` that leaves the frame's aspect ratio alone.
 */
import type { Editor } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { showToast } from '../components/Toast';

/**
 * Open the platform's image picker and resolve with the chosen file, or null.
 *
 * Resolves on cancel too. A promise that never settles leaves the caller's
 * click handler pending for the life of the session, and there is no `cancel`
 * event on a file input to hang that on — the window regaining focus with no
 * file chosen is the only signal there is.
 *
 * **The bytes are read here, while the input is still in the document, and the
 * caller gets a copy that owns them.** Android's WebView hands back a `File`
 * backed by a `content://` URI whose read permission does not outlive the
 * `<input>` it came from: taking the element out of the DOM first made every
 * later `arrayBuffer()` throw a bare `DOMException`, so the picker opened, the
 * writer chose a picture, and the frame silently never arrived. iOS and the
 * desktop webviews are happy either way, so there is one path for all of them.
 *
 * Rejects when the chosen file cannot be read — that is a failure the writer
 * needs told about, and it is not the same thing as cancelling.
 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('focus', onFocus);
      input.remove();
    };
    const done = (f: File | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(f);
    };
    const failed = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onFocus = () => setTimeout(() => { if (!input.files?.length) done(null); }, 300);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { done(null); return; }
      try {
        const bytes = await file.arrayBuffer();
        done(new File([bytes], file.name, { type: file.type }));
      } catch (err) {
        failed(err);
      }
    };
    window.addEventListener('focus', onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Put the selection back where the caller found it.
 *
 * The picker is an async gap, and `editor.chain().focus()` restores whatever
 * selection the view last had — which for a double-clicked frame is not
 * necessarily the frame. Worse, `TextSelection.near` searches FORWARD by
 * default, and a frame is the last child of its row: a caret placed "near" it
 * lands in the NEXT row's video cell, and the picture would go into the wrong
 * row. So a frame position is restored as a NodeSelection on the frame itself.
 */
function restoreSelection(editor: Editor, pos: number): boolean {
  const { doc } = editor.state;
  if (pos < 0 || pos > doc.content.size) return false;
  try {
    const node = doc.nodeAt(pos);
    const selection = node && node.type.name === 'avImage'
      ? NodeSelection.create(doc, pos)
      : TextSelection.near(doc.resolve(pos), -1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    return true;
  } catch (err) {
    console.warn('[av] could not restore the selection for the frame', err);
    return false;
  }
}

/**
 * Choose an image for a storyboard frame and put it in its row.
 *
 * `pos` names the frame to fill — the node view passes its own position, the
 * menu leaves it out and the cursor's row is used. The bytes go to the
 * project's asset store (or the scratch store, for a document with no project
 * yet) exactly as an inserted image does; the document never holds them.
 */
export async function chooseAvFrameImage(editor: Editor | null, pos?: number): Promise<void> {
  if (!editor) return;
  const at = pos ?? editor.state.selection.from;
  try {
    const file = await pickImageFile();
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file', 'error');
      return;
    }
    const { buildImageAttrs, warnIfImageDegraded } = await import('./insertImage');
    const attrs = await buildImageAttrs(file, ['av-storyboard']);
    restoreSelection(editor, at);
    // Every field is carried across. Collapsing projectId/scratchId into a
    // single assetId left the frame unresolvable: the asset endpoint is built
    // from BOTH ids, and a scratch id is not an asset id at all. `aspect` is
    // deliberately absent — the command keeps the frame's own ratio.
    const ok = editor.chain().focus().setAvRowImage({
      src: attrs.src ?? null,
      assetId: attrs.assetId ?? null,
      projectId: attrs.projectId ?? null,
      scratchId: attrs.scratchId ?? null,
      filename: attrs.filename ?? null,
      alt: attrs.filename ?? null,
    }).run();
    if (!ok) {
      showToast('Put the cursor in an AV row first, then add the frame', 'error');
      return;
    }
    warnIfImageDegraded(attrs);
  } catch (err) {
    console.error('[av] could not add storyboard frame', err);
    showToast(`Could not add the frame: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}
