import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { ScreenplayImageView } from './ScreenplayImageView';
import { buildImageAttrs, imageFilesFrom, insertImageNode } from '../../utils/insertImage';

// Upload each file and insert an image node at `pos` (or the selection),
// selecting it so the writer sees the resize handle (not a bare gapcursor).
async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  for (const file of files) {
    try {
      const attrs = await buildImageAttrs(file);
      insertImageNode(editor, attrs, pos);
    } catch { /* ignore a single failed image */ }
  }
}

export interface ScreenplayImageAttrs {
  assetId: string | null;
  projectId: string | null;
  filename: string | null;
  src: string | null;       // data-URL fallback when no asset (e.g. unsaved local doc)
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
 * Block image node for screenplays. Stores an ASSET REFERENCE (not base64) to
 * keep the document JSON small; a data-URL `src` is only used as a fallback when
 * there is no project to upload to. Rendered via a React NodeView with resize.
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
