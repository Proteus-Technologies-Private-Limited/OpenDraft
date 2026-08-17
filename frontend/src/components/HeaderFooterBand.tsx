import React, { useCallback, useRef, useState } from 'react';
import { resolveHFFields } from '../stores/editorStore';
import type { HeaderFooterContent } from '../stores/editorStore';

export type BandKind = 'header' | 'footer';

interface HeaderFooterBandProps {
  kind: BandKind;
  /** The raw templates, e.g. `{page}.` — resolved for display, edited as-is. */
  content: HeaderFooterContent;
  /** Printed page number for this band, already shifted by the start offset. */
  printedPage: number;
  totalPages: number;
  docTitle: string;
  revisionColor: string;
  /** False in history/read-only mode: the band still renders, just isn't editable. */
  editable: boolean;
  /** True when THIS band instance is the one being edited in place. */
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (next: HeaderFooterContent) => void;
  onCancel: () => void;
  onOpenSettings: () => void;
  /** Where in the margin the band sits — driven by the header/footer margin
   *  settings so the screen agrees with what the PDF prints. */
  style?: React.CSSProperties;
}

const SLOTS: Array<keyof HeaderFooterContent> = ['left', 'center', 'right'];
const SLOT_CLASS: Record<string, string> = {
  left: 'page-sep-hf-left',
  center: 'page-sep-hf-center',
  right: 'page-sep-hf-right',
};

/**
 * One header or footer band drawn in the page margin, editable in place.
 *
 * Double-clicking swaps the resolved text for the raw templates so the user
 * edits `{page}.` rather than `2.` — the same convention Word uses for fields.
 * A commit writes back to the shared page layout, so every page and the
 * Header & Footer dialog update together; there is one template per document,
 * not one per page.
 */
/**
 * The editing form, mounted only while this band holds the caret.
 *
 * It is a separate component so the draft is seeded once, at mount, from the
 * live templates — no effect syncing state that a cancelled edit could leave
 * stale behind.
 */
const EditingBand: React.FC<{
  kind: BandKind;
  content: HeaderFooterContent;
  style?: React.CSSProperties;
  onCommit: (next: HeaderFooterContent) => void;
  onCancel: () => void;
  onOpenSettings: () => void;
}> = ({ kind, content, style, onCommit, onCancel, onOpenSettings }) => {
  const [draft, setDraft] = useState<HeaderFooterContent>(content);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Guards the blur handler: committing or cancelling moves focus out of the
  // band, which would otherwise re-enter the commit path a second time.
  const closingRef = useRef(false);

  const commit = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onCommit(draft);
  }, [draft, onCommit]);

  const cancel = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onCancel();
  }, [onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
      // Everything else is swallowed so the editor's screenplay shortcuts
      // (Tab to change element type, Cmd+B, …) don't fire while typing here.
      e.stopPropagation();
    },
    [commit, cancel],
  );

  /** Commit only when focus has genuinely left the band, not when it moves
   *  between the band's own three inputs. */
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && wrapRef.current?.contains(next)) return;
      commit();
    },
    [commit],
  );

  return (
    <div
      ref={wrapRef}
      className={`page-sep-${kind} page-sep-hf-editing`}
      style={style}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      // The band lives inside the .page-sep overlay, which is click-through
      // and drag-selects nothing; editing needs both back.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {SLOTS.map((slot, i) => (
        <input
          key={slot}
          className={`${SLOT_CLASS[slot]} page-sep-hf-input`}
          value={draft[slot]}
          placeholder={slot}
          aria-label={`${kind} ${slot}`}
          autoFocus={i === 0}
          onChange={(e) => setDraft((prev) => ({ ...prev, [slot]: e.target.value }))}
        />
      ))}
      <button
        type="button"
        className="page-sep-hf-settings"
        title="Open Header & Footer settings"
        // Fires before blur, so commit the typing first.
        onMouseDown={(e) => {
          e.preventDefault();
          commit();
          onOpenSettings();
        }}
      >
        ⚙
      </button>
    </div>
  );
};

const HeaderFooterBand: React.FC<HeaderFooterBandProps> = ({
  kind,
  content,
  printedPage,
  totalPages,
  docTitle,
  revisionColor,
  editable,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  onOpenSettings,
  style,
}) => {
  if (editing) {
    return (
      <EditingBand
        kind={kind}
        content={content}
        style={style}
        onCommit={onCommit}
        onCancel={onCancel}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const isEmpty = !content.left && !content.center && !content.right;

  return (
    <div
      className={[
        `page-sep-${kind}`,
        editable ? 'page-sep-hf-editable' : '',
        isEmpty ? 'page-sep-hf-empty' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      onDoubleClick={editable ? onStartEdit : undefined}
      title={editable ? `Double-click to edit the ${kind}` : undefined}
    >
      {SLOTS.map((slot) => (
        <span key={slot} className={SLOT_CLASS[slot]}>
          {resolveHFFields(content[slot], printedPage, totalPages, docTitle, revisionColor)}
        </span>
      ))}
      {editable && isEmpty && (
        <span className="page-sep-hf-placeholder">Double-click to add a {kind}</span>
      )}
    </div>
  );
};

export default HeaderFooterBand;
