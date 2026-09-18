import type { Editor } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { api } from '../services/api';
import { useProjectStore } from '../stores/projectStore';
import { putScratchAsset } from '../services/scratchAssets';
import { showToast } from '../components/Toast';
import { isAvCellPos, AV_IMAGE_SOURCE_FIELDS } from '../editor/extensions/AvBlock';

/**
 * An image landing inside an AV row becomes that row's storyboard frame.
 *
 * `screenplayImage` is not in `AV_CELL_CONTENT`, so a cell cannot hold one.
 * Inserting it at a position inside a cell asked ProseMirror to make room, and
 * it made room the only way it can: by splitting the avBlock in two. What the
 * writer saw was their two-row table growing a third, empty row that belonged
 * to a second table with its own column widths — and no picture anywhere,
 * since the node it split the document for was never valid there either.
 *
 * A storyboard frame is what an image in an AV row means, so that is what it
 * becomes. `setAvRowImage` reads the row off the SELECTION rather than a
 * position, so the selection is moved to the target first: a drop carries
 * coordinates that have nothing to do with where the caret happens to be, and
 * without this the picture would land in whichever row the writer last typed
 * in. It turns the storyboard column on by itself.
 */
function setAvFrameFromImage(editor: Editor, attrs: Record<string, unknown>, at: number): boolean {
  const { state } = editor;
  try {
    editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))));
  } catch {
    return false;
  }
  const image: Record<string, unknown> = {};
  for (const key of AV_IMAGE_SOURCE_FIELDS) {
    if (key === 'alt') continue;
    image[key] = (attrs[key] ?? null) as unknown;
  }
  // `aspect` is left out on purpose — an existing frame keeps the ratio it was
  // given, exactly as the menu's Add / Replace Frame does.
  image.alt = (attrs.filename ?? null) as unknown;
  return editor.chain().focus().setAvRowImage(image).run();
}

/**
 * Insert a screenplayImage node at a valid block position (end of the containing
 * block if `pos` is inside a text line) and SELECT it, so the writer sees the
 * image with its resize handle rather than a bare gapcursor "blue line".
 *
 * Inside an AV row the image becomes the row's storyboard frame instead — see
 * `setAvFrameFromImage`.
 */
export function insertImageNode(editor: Editor, attrs: Record<string, unknown>, pos?: number) {
  const type = editor.schema.nodes.screenplayImage;
  if (!type) return;
  const { state } = editor;
  let at = Math.min(pos ?? state.selection.to, state.doc.content.size);
  const $at = state.doc.resolve(at);
  if (isAvCellPos($at) && setAvFrameFromImage(editor, attrs, at)) return;
  if ($at.parent.isTextblock && $at.depth > 0) at = $at.after($at.depth);
  let tr = editor.state.tr.insert(at, type.create(attrs));
  try { tr = tr.setSelection(NodeSelection.create(tr.doc, at)); } catch { /* node not selectable at pos */ }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

export interface BuiltImageAttrs extends Record<string, unknown> {
  assetId: string | null;
  projectId: string | null;
  scratchId: string | null;
  filename: string | null;
  src: string | null;
  align: 'center';
  /**
   * True when the bytes could not be stored outside the document and had to be
   * inlined after all. The caller warns the writer: an inline image still works,
   * but it counts against the recovery snapshot's size limit and can cost the
   * document its crash protection.
   */
  degraded?: boolean;
}

/**
 * Build screenplayImage node attrs for a chosen/pasted/dropped image file.
 *
 * The document never holds the bytes. A project-backed document uploads to the
 * project's assets; one without a project yet writes to the scratch store
 * (services/scratchAssets) and carries a `scratchId` until Save As promotes it.
 *
 * Both paths AWAIT the byte write before returning, so by the time the caller
 * inserts a node referring to this image the image itself is already durable.
 * That ordering is what makes the recovery snapshot's synchronous last-moment
 * flush safe: it can only ever record a reference that already resolves.
 *
 * The data-URL fallback survives as a genuine last resort — a full disk, a
 * missing fs plugin, a browser with IndexedDB disabled. Inlining a photo is bad
 * for the snapshot, but silently refusing to insert the writer's image is worse.
 */
export async function buildImageAttrs(
  file: File,
  tags: string[] = ['inline-image'],
): Promise<BuiltImageAttrs> {
  const base = {
    assetId: null,
    projectId: null,
    scratchId: null,
    filename: null,
    src: null,
    align: 'center',
  } as BuiltImageAttrs;

  const currentProject = useProjectStore.getState().currentProject;
  if (currentProject) {
    const asset = await api.uploadAsset(currentProject.id, file, tags);
    return {
      ...base,
      assetId: asset.id,
      projectId: currentProject.id,
      filename: asset.filename ?? file.name,
    };
  }

  const scratch = await putScratchAsset(file, file.name);
  if (scratch) {
    return { ...base, scratchId: scratch.id, filename: file.name || scratch.filename };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { ...base, src: dataUrl, filename: file.name || null, degraded: true };
}

/**
 * Tell the writer when an image had to be stored inside the document.
 *
 * Worth interrupting for: an inline image counts against the recovery
 * snapshot's size limit, and a big enough one costs the document its crash
 * protection entirely — which used to happen with no signal whatsoever.
 */
export function warnIfImageDegraded(attrs: BuiltImageAttrs): void {
  if (!attrs.degraded) return;
  showToast(
    'This image had to be stored inside the document. Save to your library to keep it out of the way.',
    'info',
  );
}

/** Extract image File objects from a clipboard or drag DataTransfer. */
export function imageFilesFrom(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files: File[] = [];
  if (dt.files && dt.files.length) {
    for (const f of Array.from(dt.files)) if (f.type.startsWith('image/')) files.push(f);
  }
  if (!files.length && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files;
}
