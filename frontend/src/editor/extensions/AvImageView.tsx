/**
 * Node view for a storyboard frame.
 *
 * `renderHTML` can only put `attrs.src` on an `<img>`, and a frame uploaded to
 * the project's asset store has no `src` at all — its bytes sit behind an
 * endpoint that needs a bearer token, and on the web a bare `<img src>` cannot
 * send one. So the editor resolves a frame the same way every other image in
 * the document does, through `useImageSrc`; `renderHTML` stays as the static
 * shape for HTML export and copy.
 *
 * The markup deliberately mirrors `renderHTML`'s, `data-empty` included, so the
 * rules in avScript.css (which draw the empty slot and the print layout) apply
 * to both.
 */
import React, { useCallback } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useImageSrc } from '../../hooks/useImageSrc';
import { aspectRatioCss } from './AvBlock';
import { chooseAvFrameImage } from '../../utils/avFrame';

export const AvImageView: React.FC<NodeViewProps> = ({ node, selected, editor, getPos }) => {
  const attrs = node.attrs as { alt?: string | null; aspect?: string };
  const aspect = attrs.aspect || '16:9';
  const ratio = aspectRatioCss(aspect);
  // A frame carries no width of its own — the column decides that — so only the
  // aspect ratio is worth resolving here.
  const { url } = useImageSrc(node.attrs as Record<string, unknown>);

  /**
   * The direct way to fill a frame.
   *
   * The menu route exists, but nobody looks for it: a writer who has just given
   * a row an empty frame points at the frame. Double-click rather than click,
   * so a single click can still do what a click on an atom does — select it, to
   * be replaced or deleted from the keyboard. The frame's own position is
   * passed explicitly because the pointer is not the caret: the writer may have
   * been typing three rows away when they reached over to click this one.
   */
  const choose = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!editor?.isEditable) return;
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    void chooseAvFrameImage(editor, typeof pos === 'number' ? pos : undefined);
  }, [editor, getPos]);

  return (
    <NodeViewWrapper
      as="div"
      // ProseMirror puts `ProseMirror-selectednode` on a plain atom's DOM
      // itself; once the node is rendered through React it arrives as a prop
      // instead, so the class is put back by hand and avScript.css keeps
      // working unchanged.
      className={`av-image${selected ? ' ProseMirror-selectednode' : ''}`}
      data-type="av-image"
      data-aspect={aspect}
      // An empty frame still draws its box — a blank storyboard cell is
      // meaningful in an AV document, it is where a frame is yet to be drawn.
      data-empty={url ? undefined : 'true'}
      title={url ? 'Double-click to replace this frame' : 'Double-click to choose an image'}
      onDoubleClick={choose}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      {url ? <img className="av-image-img" src={url} alt={attrs.alt || ''} /> : null}
    </NodeViewWrapper>
  );
};
