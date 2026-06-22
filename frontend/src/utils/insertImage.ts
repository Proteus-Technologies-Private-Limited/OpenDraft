import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { api } from '../services/api';
import { useProjectStore } from '../stores/projectStore';

/**
 * Insert a screenplayImage node at a valid block position (end of the containing
 * block if `pos` is inside a text line) and SELECT it, so the writer sees the
 * image with its resize handle rather than a bare gapcursor "blue line".
 */
export function insertImageNode(editor: Editor, attrs: Record<string, unknown>, pos?: number) {
  const type = editor.schema.nodes.screenplayImage;
  if (!type) return;
  const { state } = editor;
  let at = Math.min(pos ?? state.selection.to, state.doc.content.size);
  const $at = state.doc.resolve(at);
  if ($at.parent.isTextblock && $at.depth > 0) at = $at.after($at.depth);
  let tr = state.tr.insert(at, type.create(attrs));
  try { tr = tr.setSelection(NodeSelection.create(tr.doc, at)); } catch { /* node not selectable at pos */ }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/**
 * Build screenplayImage node attrs for a chosen/pasted/dropped image file.
 * Uploads to the project's assets when a project exists (keeps the document
 * small); otherwise embeds the image as a data URL.
 */
export async function buildImageAttrs(file: File): Promise<Record<string, unknown>> {
  const currentProject = useProjectStore.getState().currentProject;
  if (currentProject) {
    const asset = await api.uploadAsset(currentProject.id, file, ['inline-image']);
    return { assetId: asset.id, projectId: currentProject.id, filename: asset.filename ?? file.name, align: 'center' };
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { src: dataUrl, align: 'center' };
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
