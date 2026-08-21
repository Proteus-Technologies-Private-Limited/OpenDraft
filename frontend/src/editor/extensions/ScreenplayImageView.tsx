import React, { useRef, useCallback } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useImageSrc } from '../../hooks/useImageSrc';

const LINE_HEIGHT_PX = 16; // 12pt — matches pagination LINE_HEIGHT_PT

/**
 * React NodeView for the screenplayImage node. Resolves the image through the
 * shared `useImageSrc` (project asset, scratch blob, or legacy inline data URL),
 * renders it at its stored width with simple corner resizing, and records an
 * estimated height (in screenplay lines) so the paginator can roughly account
 * for the image.
 */
export const ScreenplayImageView: React.FC<NodeViewProps> = ({ node, updateAttributes, selected, editor }) => {
  const { width, align } = node.attrs as { width: number | null; align: string };
  const imgRef = useRef<HTMLImageElement>(null);
  const { url, missing } = useImageSrc(node.attrs as Record<string, unknown>);

  // On first load (no stored width), default to the natural width capped to the
  // content column, and record the rendered height in lines for pagination.
  const onLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const colWidth = (img.closest('.ProseMirror') as HTMLElement | null)?.clientWidth || 600;
    const naturalW = img.naturalWidth || 300;
    const w = width && width > 0 ? width : Math.min(naturalW, Math.round(colWidth * 0.9));
    const renderedH = (img.naturalHeight / (img.naturalWidth || 1)) * w;
    const heightLines = Math.max(1, Math.ceil(renderedH / LINE_HEIGHT_PX) + 1);
    if (!width || node.attrs.heightLines !== heightLines) {
      updateAttributes({ width: w, heightLines });
    }
  }, [width, node.attrs.heightLines, updateAttributes]);

  // Corner resize: drag to set width; height-in-lines is recomputed from aspect.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const startX = e.clientX;
    const startW = width || img.clientWidth;
    const aspect = (img.naturalHeight || 1) / (img.naturalWidth || 1);
    const onMove = (me: MouseEvent) => {
      const w = Math.max(40, Math.round(startW + (me.clientX - startX)));
      const heightLines = Math.max(1, Math.ceil((w * aspect) / LINE_HEIGHT_PX) + 1);
      updateAttributes({ width: w, heightLines });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width, updateAttributes]);

  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      className={`sp-image align-${align || 'center'}${selected ? ' is-selected' : ''}`}
      data-drag-handle
    >
      <span className="sp-image-inner" style={{ width: width ? `${width}px` : undefined }}>
        {missing ? (
          // Hold the stored size rather than collapsing: a broken image that
          // reflows the page is far more disruptive than a visible gap, and the
          // bytes may simply live on the machine the document came from.
          <span
            className="sp-image-missing"
            style={{ height: `${Math.max(1, node.attrs.heightLines as number) * LINE_HEIGHT_PX}px` }}
          >
            Image not available
          </span>
        ) : (
          <img ref={imgRef} src={url} alt="" draggable={false} onLoad={onLoad} className="sp-image-img" />
        )}
        {selected && editable && !missing && (
          <span className="sp-image-resize" onMouseDown={startResize} title="Drag to resize" />
        )}
      </span>
    </NodeViewWrapper>
  );
};
