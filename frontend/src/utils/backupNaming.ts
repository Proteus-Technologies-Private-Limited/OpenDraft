/**
 * Backup filenames and retention selection.
 *
 * Snapshots are grouped one folder per project inside the user-chosen backup
 * folder, and the filename still carries everything: which script, when, and
 * whether the writer pinned it. The scheme is
 *
 *     <Backup folder>/<Project>/<Title>_<YYYY-MM-DD>_<HHMMSS>_<sid8>[.manual].odraft
 *     OpenDraft Backups/Silent Sonata/The Long Goodbye_2026-07-27_143205_a1b2c3d4.odraft
 *     OpenDraft Backups/Silent Sonata/The Long Goodbye_2026-07-27_150000_a1b2c3d4.manual.odraft
 *
 * Filenames stay self-describing even so — a snapshot dragged out of its folder
 * is still identifiable, and backups written by older builds sit flat in the
 * root where the reader still finds them.
 *
 * Chosen so the folder is useful in Finder/Explorer without opening anything:
 * readable titles, and timestamps that sort chronologically as text. The short
 * script id disambiguates two scripts both called "Untitled" and lets the
 * Recover dialog group by script without reading every file. Documents that
 * were never saved to the library use `unsaved` in its place.
 *
 * Deliberately dependency-free so it is fully unit-testable.
 */

export type BackupKind = 'auto' | 'manual' | 'external';

export interface ParsedBackup {
  /** Filename as it appears on disk. */
  name: string;
  /** Sanitized title portion (not necessarily the original title). */
  title: string;
  /** Short script id, or 'unsaved'. */
  scriptKey: string;
  /** Local time the snapshot was taken. */
  timestamp: Date;
  kind: 'auto' | 'manual';
}

const SCRIPT_KEY_UNSAVED = 'unsaved';
const MAX_TITLE_LENGTH = 80;

/**
 * Where snapshots for documents that belong to no project go. A real folder
 * rather than the root, so the backup folder holds only project folders and the
 * flat files older builds left behind.
 */
export const UNFILED_BACKUP_FOLDER = 'Unfiled Documents';

/** Windows reserved device names, which cannot be used even with an extension. */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * Make a title safe to use as a filename component on macOS, Windows and Linux.
 */
export function sanitizeForFilename(raw: string): string {
  // Strip path separators, Windows-illegal characters and control codes.
  let out = (raw || '')
    .replace(/[/\\?%*:|"<>]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Windows silently drops trailing dots and spaces, which would make a file
  // the app wrote unfindable by the name it thinks it has.
  out = out.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  // Truncate on a code-point boundary so a surrogate pair (emoji) or a
  // multi-byte character is never cut in half.
  if (Array.from(out).length > MAX_TITLE_LENGTH) {
    out = Array.from(out).slice(0, MAX_TITLE_LENGTH).join('').trimEnd();
  }

  if (RESERVED_NAMES.has(out.toUpperCase())) out = `${out}_`;
  if (out === '') out = 'Untitled';
  return out;
}

/** `2026-07-27_143205` in LOCAL time — the writer browses these next to a clock. */
export function formatBackupStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** The 8-character script key used in filenames. */
export function scriptKeyFor(scriptId: string | null | undefined): string {
  if (!scriptId) return SCRIPT_KEY_UNSAVED;
  const cleaned = scriptId.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(0, 8) || SCRIPT_KEY_UNSAVED;
}

/**
 * The subfolder a project's snapshots live in, relative to the backup folder.
 *
 * Sanitized the same way filenames are, so a project called "INT./EXT. Tests"
 * cannot escape the backup folder or produce a path the OS rejects.
 */
export function buildProjectFolderName(projectTitle?: string | null): string {
  const trimmed = (projectTitle || '').trim();
  if (!trimmed) return UNFILED_BACKUP_FOLDER;
  return sanitizeForFilename(trimmed);
}

export function buildBackupFilename(opts: {
  title: string;
  scriptId?: string | null;
  date: Date;
  kind: 'auto' | 'manual';
}): string {
  const title = sanitizeForFilename(opts.title);
  const stamp = formatBackupStamp(opts.date);
  const key = scriptKeyFor(opts.scriptId);
  const suffix = opts.kind === 'manual' ? '.manual' : '';
  return `${title}_${stamp}_${key}${suffix}.odraft`;
}

// Anchored at the TAIL, because a title may itself contain underscores and
// date-like substrings ("Blade_Runner_2049").
const FILENAME_RE =
  /^(.*)_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})_([A-Za-z0-9]+)(\.manual)?\.odraft$/;

/**
 * Parse a filename this module produced. Returns null for anything else —
 * including a hand-made or exported `.odraft` a user dropped in the folder.
 * That null is a safety property: the pruner only ever deletes files it can
 * positively identify as its own.
 */
export function parseBackupFilename(name: string): ParsedBackup | null {
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  const [, title, y, mo, d, h, mi, s, scriptKey, manual] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const timestamp = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(timestamp.getTime())) return null;
  return {
    name,
    title,
    scriptKey,
    timestamp,
    kind: manual ? 'manual' : 'auto',
  };
}

/**
 * Choose which snapshots to delete, keeping the newest `keep` per script.
 *
 * Two hard rules, both about not destroying things:
 *   - manual snapshots are never pruned; the writer pinned them on purpose
 *   - `keep <= 0` means "keep everything"
 * Files the parser doesn't recognize never reach this function, so a user who
 * points the setting at their Documents folder cannot lose unrelated files.
 */
export function selectForPruning(files: ParsedBackup[], keep: number): ParsedBackup[] {
  if (keep <= 0) return [];

  const groups = new Map<string, ParsedBackup[]>();
  for (const f of files) {
    if (f.kind === 'manual') continue;
    const key = f.scriptKey === SCRIPT_KEY_UNSAVED ? `unsaved:${f.title}` : f.scriptKey;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  const doomed: ParsedBackup[] = [];
  for (const list of groups.values()) {
    // Newest first; ties broken by name so the result is deterministic.
    list.sort((a, b) => {
      const d = b.timestamp.getTime() - a.timestamp.getTime();
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    doomed.push(...list.slice(keep));
  }
  return doomed;
}
