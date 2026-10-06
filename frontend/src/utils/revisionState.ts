/**
 * Revision Mode's per-script state — on/off, colour, the colours used so far —
 * read back from a saved payload (see `buildSaveContent`).
 *
 * Restoring always starts from the defaults: a script saved before Revision
 * Mode was saved, or one that never used it, must not inherit the mode from
 * whatever document was open before it.
 */
import { useEditorStore, type RevisionHistoryEntry } from '../stores/editorStore';
import {
  findRevisionColor, normalizeRevisionSettings, DEFAULT_REVISION_COLOR, type RevisionSettings,
} from '../editor/revisionColors';

export interface RevisionState {
  revisionMode: boolean;
  revisionColor: string;
  revisionHistory: RevisionHistoryEntry[];
  revisionSettings: RevisionSettings;
}

function parseHistory(value: unknown): RevisionHistoryEntry[] {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is { color: string; date?: unknown } => !!h && typeof h === 'object' && typeof (h as { color?: unknown }).color === 'string')
    .map((h) => ({ color: h.color, date: typeof h.date === 'string' ? h.date : '' }));
}

export function readRevisionState(content: Record<string, unknown> | null | undefined): RevisionState {
  const c = content ?? {};
  const color = typeof c._revisionColor === 'string' && c._revisionColor.trim()
    ? (findRevisionColor(c._revisionColor)?.name ?? c._revisionColor)
    : DEFAULT_REVISION_COLOR;
  return {
    revisionMode: c._revisionMode === true,
    revisionColor: color,
    revisionHistory: parseHistory(c._revisionHistory),
    revisionSettings: normalizeRevisionSettings(c._revisionSettings),
  };
}

/** Put a payload's revision state into the store (defaults where absent). */
export function restoreRevisionState(content: Record<string, unknown> | null | undefined): void {
  const s = readRevisionState(content);
  const store = useEditorStore.getState();
  store.resetRevisionState();
  useEditorStore.setState({
    revisionMode: s.revisionMode,
    revisionColor: s.revisionColor,
    revisionHistory: s.revisionHistory,
    revisionSettings: s.revisionSettings,
  });
}
