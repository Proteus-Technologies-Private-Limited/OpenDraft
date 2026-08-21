import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { ScreenplayImageView } from './ScreenplayImageView';
import { buildImageAttrs, imageFilesFrom, insertImageNode, warnIfImageDegraded } from '../../utils/insertImage';
import { showToast } from '../../components/Toast';

// Upload each file and insert an image node at `pos` (or the selection),
// selecting it so the writer sees the resize handle (not a bare gapcursor).
async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  for (const file of files) {
    try {
      const attrs = await buildImageAttrs(file);
      insertImageNode(editor, attrs, pos);
      warnIfImageDegraded(attrs);
    } catch (err) {
      // Previously swallowed, so a pasted image that failed to upload simply
      // vanished with nothing to explain it.
      console.warn('[image] could not insert', file.name, err);
      showToast(`Could not add "${file.name || 'image'}".`, 'error');
    }
  }
}

export interface ScreenplayImageAttrs {
  assetId: string | null;
  projectId: string | null;
  /**
   * Bytes in the scratch store, for a document with no project yet. Kept
   * distinct from `assetId` rather than encoded as "assetId with a null
   * projectId": `collectAssetRefs` packs any `assetId` it finds into backups
   * and would fail to read this one, marking otherwise-complete backups as
   * truncated. An older build simply ignores an attribute it doesn't know.
   */
  scratchId: string | null;
  filename: string | null;
  /**
   * Inline data URL. No longer written — the scratch store replaced it — but
   * kept in the schema permanently for documents that predate that, and for
   * `renderHTML`, which has nowhere else to get a src for HTML export and copy.
   */
  src: string | null;
  width: number | null;     // px
  align: 'left' | 'center' | 'right';
  heightLines: number;      // estimated height in screenplay lines (for pagination)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenplayImage: {
      insertScreenplayImage: (attrs: Partial<ScreenplayImageAttrs>) => ReturnType;
    };
  }
}

/**
 * Block image node for screenplays. Stores an ASSET REFERENCE, never the bytes:
 * `assetId` once the document belongs to a project, `scratchId` before that.
 * A data-URL `src` is now only a last resort for when the scratch store itself
 * is unavailable, and a shape older documents still arrive in. Rendered via a
 * React NodeView with resize.
 */
export const ScreenplayImage = Node.create({
  name: 'screenplayImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: { default: null },
      projectId: { default: null },
      scratchId: { default: null },
      filename: { default: null },
      src: { default: null },
      width: { default: null },
      align: { default: 'center' },
      heightLines: { default: 8 },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-type="screenplay-image"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback (HTML export / copy). The editor uses the React NodeView.
    const { src, width, align } = HTMLAttributes as Record<string, unknown>;
    return ['img', mergeAttributes({
      'data-type': 'screenplay-image',
      src: (src as string) || '',
      style: `${width ? `width:${width}px;` : ''}display:block;margin:${align === 'left' ? '0 auto 0 0' : align === 'right' ? '0 0 0 auto' : '0 auto'};`,
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScreenplayImageView);
  },

  // Paste an image from the clipboard, or drop image files — upload + insert,
  // like other rich-text editors.
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const files = imageFilesFrom(event.clipboardData);
            if (!files.length) return false;
            event.preventDefault();
            void insertImageFiles(editor, files);
            return true;
          },
          handleDrop(view, event) {
            const files = imageFilesFrom(event.dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertImageFiles(editor, files, pos);
            return true;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertScreenplayImage: (attrs) => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs }),
    };
  },
});
