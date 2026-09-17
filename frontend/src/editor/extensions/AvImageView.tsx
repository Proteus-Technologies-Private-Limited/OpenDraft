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
import React from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useImageSrc } from '../../hooks/useImageSrc';
import { aspectRatioCss } from './AvBlock';

export const AvImageView: React.FC<NodeViewProps> = ({ node, selected }) => {
  const attrs = node.attrs as { alt?: string | null; aspect?: string };
  const aspect = attrs.aspect || '16:9';
  const ratio = aspectRatioCss(aspect);
  // A frame carries no width of its own — the column decides that — so only the
  // aspect ratio is worth resolving here.
  const { url } = useImageSrc(node.attrs as Record<string, unknown>);

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
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      {url ? <img className="av-image-img" src={url} alt={attrs.alt || ''} /> : null}
    </NodeViewWrapper>
  );
};
