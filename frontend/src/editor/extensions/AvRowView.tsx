/**
 * Node view for an AV row — draws the cue/timing gutter beside the editable
 * cells.
 *
 * The cue column follows Celtx's Multi-Column AV editor: the shot number and
 * the start timestamp are *derived* (from row order and the running sum of the
 * durations above), so they are rendered rather than stored, and the only thing
 * the writer edits is this row's duration. That is what makes inserting a row
 * mid-document renumber and re-time everything below it without a migration.
 *
 * The duration field is a real `<input>` rather than a ProseMirror cell for two
 * reasons: it is structured data an exporter wants as a number, not prose, and
 * it has to be reachable by tapping on a phone — the same constraint that drove
 * the touch row controls in issue #116, where every route to editing an AV row
 * needed a hardware key the device does not have.
 */
import React, { useCallback, useMemo } from 'react';
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { computeRowTimings, parseTimecode } from '../avTiming';
import { readColumnConfig, cueFromDecorations } from './AvBlock';

/** Walk up from this row to its avBlock, and report the row's index within it.
 *  Returns null when the structure is not what we expect, so the view degrades
 *  to "no cue column" instead of throwing inside a render. */
function locateRow(props: NodeViewProps): { rows: { duration?: string | null; shot?: string | null; start?: string | null }[]; index: number; cueOn: boolean } | null {
  try {
    const { editor, getPos } = props;
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos === null || pos === undefined || Number.isNaN(pos)) return null;
    const $pos = editor.state.doc.resolve(pos);
    const block = $pos.parent;
    if (!block || block.type.name !== 'avBlock') return null;

    const rows: { duration?: string | null; shot?: string | null; start?: string | null }[] = [];
    let index = -1;
    block.forEach((child, offset) => {
      if (child.type.name !== 'avRow') return;
      // `$pos.parentOffset` is this row's offset inside the block.
      if (offset === $pos.parentOffset) index = rows.length;
      rows.push({
        duration: child.attrs.duration as string | null,
        shot: child.attrs.shot as string | null,
        start: child.attrs.start as string | null,
      });
    });
    if (index < 0) return null;
    return { rows, index, cueOn: readColumnConfig(block.attrs).cue };
  } catch {
    return null;
  }
}

export const AvRowView: React.FC<NodeViewProps> = (props) => {
  const { node, updateAttributes, editor } = props;

  const located = useMemo(() => locateRow(props), [props]);

  /**
   * Shot number and start time come from the decoration the AvCueDecorations
   * plugin attaches, not from walking the siblings here.
   *
   * Both depend on the rows ABOVE this one, and a node view only re-renders
   * when its own node changes — so computing them locally left every row below
   * an insertion showing stale values. Tiptap DOES re-render a node view when
   * its decorations change, so the plugin is what keeps them current. The local
   * walk stays as a fallback for the first paint, before decorations arrive.
   */
  const timing = useMemo(() => {
    const fromDeco = cueFromDecorations(props.decorations as readonly unknown[] | undefined);
    if (fromDeco) return fromDeco;
    if (!located) return null;
    const all = computeRowTimings(located.rows);
    return all[located.index] ?? null;
  }, [props.decorations, located]);

  const onDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      try {
        // Store exactly what was typed; validity is decided at render time so a
        // half-typed "1:" is not thrown away mid-keystroke.
        updateAttributes({ duration: raw.trim() === '' ? null : raw });
      } catch (err) {
        console.warn('[av] could not set row duration', err);
      }
    },
    [updateAttributes],
  );

  // Keep editor keybindings from swallowing typing in the field, and let Enter
  // commit rather than splitting a paragraph somewhere behind the input.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  const duration = (node.attrs.duration as string | null) ?? '';
  const invalid = duration.trim() !== '' && parseTimecode(duration) === null;
  const editable = editor?.isEditable !== false;

  return (
    <NodeViewWrapper as="div" className="av-row" data-type="av-row">
      {located?.cueOn && (
        // contentEditable={false} keeps ProseMirror from treating the gutter as
        // document content — without it the caret can land in here and the
        // inputs fight the editor for keystrokes.
        <div className="av-cue" contentEditable={false}>
          <div className="av-cue-shot">{timing?.shot ?? ''}</div>
          <div className="av-cue-start">{timing?.start ?? ''}</div>
          <input
            className={`av-cue-duration${invalid ? ' av-cue-invalid' : ''}`}
            value={duration}
            onChange={onDurationChange}
            onKeyDown={onKeyDown}
            readOnly={!editable}
            inputMode="numeric"
            placeholder="0:00"
            aria-label={`Duration for shot ${timing?.shot ?? ''}`}
            title={invalid ? 'Not a time — use 0:05, 1:30 or 1:02:03' : 'Shot duration'}
          />
        </div>
      )}
      <NodeViewContent className="av-row-cells" />
    </NodeViewWrapper>
  );
};
