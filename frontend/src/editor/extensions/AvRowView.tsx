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
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { computeRowTimings, parseTimecode } from '../avTiming';
import { cueFromDecorations, AV_DEFAULT_COLUMNS } from './AvBlock';
import { AV_BOUNDARIES, type AvBoundary } from '../avColumnDrag';
import { beginColumnDrag } from '../avColumnResize';

/** Walk up from this row to its avBlock, and report the row's index within it.
 *  Returns null when the structure is not what we expect, so the view degrades
 *  to "no derived values" instead of throwing inside a render. */
function locateRow(props: NodeViewProps): { rows: { duration?: string | null; shot?: string | null; start?: string | null }[]; index: number } | null {
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
    return { rows, index };
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

  // ── Column dividers ─────────────────────────────────────────
  //
  // The gesture itself lives in editor/avColumnResize, at module scope, and not
  // in here — a node view can be remounted in the middle of a drag, and state
  // that dies with it strands the listeners and the body class. This component
  // only supplies the two facts the session needs and gets out of the way.

  // The newest props, for callbacks that must stay stable across renders.
  // `props` is a fresh object every render, so depending on it directly would
  // give every handle new listeners on every keystroke in the document.
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });

  /** Document position of this row's avBlock, or null. */
  const findBlockPos = useCallback((): number | null => {
    if (!editor) return null;
    try {
      const { getPos } = propsRef.current;
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos === null || pos === undefined || Number.isNaN(pos)) return null;
      const $pos = editor.state.doc.resolve(pos);
      if ($pos.parent.type.name !== 'avBlock') return null;
      return $pos.before();
    } catch (err) {
      console.warn('[av] could not locate the row\u2019s body for a resize', err);
      return null;
    }
  }, [editor]);

  /** Double-click puts the pair back to the built-in widths. */
  const resetBoundary = useCallback((boundary: AvBoundary) => {
    if (!editor) return;
    const blockPos = findBlockPos();
    if (blockPos === null) return;
    editor.commands.setAvColumnWidths({
      [boundary.left]: AV_DEFAULT_COLUMNS.widths[boundary.left],
      [boundary.right]: AV_DEFAULT_COLUMNS.widths[boundary.right],
    }, blockPos);
  }, [editor, findBlockPos]);

  /**
   * Attach the native listeners to a handle as it mounts.
   *
   * Native, and on the handle itself, because ProseMirror binds `mousedown` on
   * `view.dom` while React 19 delegates to the root container — an ancestor of
   * it. A synthetic handler therefore runs strictly AFTER ProseMirror's, by
   * which point `MouseDown` has moved the selection to the divider and started
   * its own text-selection drag against ours, and `stopPropagation` from React
   * cannot prevent any of it. From a listener on the handle, below `view.dom`
   * in the tree, it can.
   */
  const attachHandle = useCallback((el: HTMLDivElement | null, boundary: AvBoundary) => {
    // A read-only document still DRAWS its dividers — they are the table's own
    // rules now, not just a control — so the element is there either way and it
    // is only the listeners that are conditional.
    if (!el || !editable) return undefined;
    const onPointerDown = (ev: PointerEvent) => {
      if (!editor) return;
      const blockPos = findBlockPos();
      if (blockPos === null) return;
      if (beginColumnDrag({ event: ev, handleEl: el, boundary, blockPos, editor })) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    // Swallowed whether or not a drag started: this is the event ProseMirror
    // acts on, and letting it through puts the caret in the cell under the
    // divider every time the writer reaches for it.
    const onMouseDown = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
    const onDoubleClick = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      resetBoundary(boundary);
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [editor, editable, findBlockPos, resetBoundary]);

  /**
   * One stable ref callback per divider.
   *
   * Stability is the point. A fresh arrow in the JSX would make React tear the
   * listeners down and put them back on every render of the row — and the row
   * re-renders on every transaction in the document, since its cue decorations
   * are rebuilt each time.
   */
  const handleRefs = useMemo(
    () => AV_BOUNDARIES.map((boundary) => (el: HTMLDivElement | null) => attachHandle(el, boundary)),
    [attachHandle],
  );

  return (
    <NodeViewWrapper as="div" className="av-row" data-type="av-row">
      {/*
        Drawn unconditionally, and hidden by avScript.css when the block says
        `data-cue="false"`.

        It used to be rendered only when the parent avBlock's `columns.cue` was
        on, which meant a child node view's DOM depended on its *parent's*
        attributes. Turning the column off rewrites only the block: the grid
        track list (`--av-grid`) and `data-cue` are re-rendered together on the
        block's own element, but whether each row's node view re-runs in the
        same pass is up to ProseMirror's view reconciliation — and a gutter left
        standing in a grid that no longer has a track for it pushes Video into
        the cue track and Audio into Video's, which is the whole row out of
        alignment. Keyed off the block's attribute, the two cannot disagree.

        contentEditable={false} keeps ProseMirror from treating the gutter as
        document content — without it the caret can land in here and the
        inputs fight the editor for keystrokes.
      */}
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
      <NodeViewContent className="av-row-cells" />
      {/*
        Column dividers. All three are always drawn; avScript.css both places
        each one on its track line and hides the ones this body has no column
        for, from the block's own data-cue / data-image. Same rule as the cue
        gutter above, and for the same reason — a child node view deciding its
        own DOM from its parent's attributes is exactly what put the gutter in
        the wrong track when a column was switched off.

        Absolutely positioned, so they are not grid ITEMS: an in-flow item with
        an explicit `grid-column` is placed before the auto-placed cells and
        makes them skip the track it occupies, which would shift every column
        along by one. Out of flow, `grid-column` still names the area to
        position against and the cells place as if the handle were not there.

        Drawn whether or not the document can be edited: since the cell border
        came off, this IS the line between two columns, and a read-only script
        or a printed page needs it just as much. `data-interactive` is what
        turns the grabbing off.

        aria-hidden, and not in the tab order. A hundred rows would put three
        hundred tab stops through the document, and Format ▸ AV Script ▸
        Columns ▸ Column Width is the keyboard and touch route to the same
        setting — the one issue #116 asked for, and the one that stays.
      */}
      {AV_BOUNDARIES.map((boundary, i) => (
        <div
          key={boundary.id}
          className="av-col-handle"
          data-boundary={boundary.id}
          data-interactive={editable ? 'true' : 'false'}
          contentEditable={false}
          aria-hidden="true"
          title={editable ? 'Drag to resize · double-click to reset' : undefined}
          ref={handleRefs[i]}
        />
      ))}
    </NodeViewWrapper>
  );
};
