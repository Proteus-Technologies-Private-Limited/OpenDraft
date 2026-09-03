import { create } from 'zustand';
import { parseShortcut } from '../utils/shortcuts';
import { DEFAULT_ELEMENT_MENU_SHORTCUT } from '../utils/elementMenu';

export interface CollabUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  /** Optional — only present from the collab server; the backend's lighter
   *  /api/auth/me payload omits it. Defaults to false when missing. */
  twoFactorEnabled?: boolean;
}

export interface CollabAuth {
  accessToken: string | null;
  refreshToken: string | null;
  user: CollabUser | null;
}

interface SettingsState {
  // Collab server URL (ws:// or wss://)
  collabServerUrl: string;
  setCollabServerUrl: (url: string) => void;

  // Collab auth state
  collabAuth: CollabAuth;
  setCollabAuth: (auth: CollabAuth) => void;
  clearCollabAuth: () => void;

  // Whether the persisted token has been verified against the server during
  // this app session. Always starts false — a stored token alone never proves
  // "logged in" if the server hasn't confirmed it yet (e.g. offline boot).
  authVerified: boolean;
  setAuthVerified: (verified: boolean) => void;

  // Default invite expiry (hours)
  defaultInviteExpiry: number;
  setDefaultInviteExpiry: (hours: number) => void;

  // Settings dialog open state
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // Script-format preferences — which system templates show up in the new-script picker.
  // Stored as template ids (e.g. INDUSTRY_STANDARD_ID, MULTICAM_SITCOM_ID, ...).
  enabledScriptFormats: string[];
  setEnabledScriptFormats: (ids: string[]) => void;

  // True once the user has seen and confirmed the first-run format-preferences dialog.
  // Until then, the New Screenplay action opens the prefs dialog instead of going straight in.
  formatPreferencesInitialized: boolean;
  setFormatPreferencesInitialized: (v: boolean) => void;

  // ── Automatic backups ─────────────────────────────────────────────────
  /** Master switch for timed snapshots to `backupFolder`. */
  backupEnabled: boolean;
  setBackupEnabled: (v: boolean) => void;
  /**
   * Handle for the folder snapshots are written to; '' = not chosen.
   *
   * An absolute path on desktop, a security-scoped bookmark on iOS, a SAF tree
   * URI on Android — see backupService. Only the first of those is fit to show
   * a writer, which is what `backupFolderLabel` is for.
   */
  backupFolder: string;
  setBackupFolder: (handle: string, label?: string) => void;
  /** Human-readable name of the backup folder, for the settings screen. */
  backupFolderLabel: string;
  /** Minutes between automatic snapshots. */
  backupIntervalMinutes: number;
  setBackupIntervalMinutes: (m: number) => void;
  /** Automatic snapshots kept per script; 0 = keep all. Manual ones are never pruned. */
  backupRetentionCount: number;
  setBackupRetentionCount: (n: number) => void;
  /** Embed referenced images so a restore is complete (at the cost of size). */
  backupIncludeImages: boolean;
  setBackupIncludeImages: (v: boolean) => void;
  /** Also snapshot documents that were never saved to the library. */
  backupUnsavedDocs: boolean;
  setBackupUnsavedDocs: (v: boolean) => void;

  // ── Editing ───────────────────────────────────────────────────────────
  /**
   * Whether Enter on a blank line offers the element menu. Off means Enter is
   * always a plain new line, for writers who format by muscle memory — the same
   * switch Final Draft ships as "Show SmartType Window", Movie Magic as "Enable
   * Quick Entry" and WriterDuet as "Show line type select on enter" (issue #100).
   */
  elementMenuOnEnter: boolean;
  setElementMenuOnEnter: (v: boolean) => void;
  /**
   * Shortcut that opens the element menu anywhere, blank line or not, in
   * ProseMirror notation (`Alt-Enter`, `Mod-Shift-e`). '' turns it off. It is
   * the way to the menu for anyone who has turned the Enter route off, and the
   * only way to it from a line that already has text on it (issue #100).
   */
  elementMenuShortcut: string;
  setElementMenuShortcut: (spec: string) => void;
  /**
   * Whether File → Print prints the exported PDF rather than the page.
   *
   * On by default, and the reason is fidelity. The editor draws its page turns
   * rather than making them, so printing the page asks the browser to
   * paginate the script a second time by its own rules — and it put the page
   * turns somewhere else, which in a screenplay is a change to the script. The
   * PDF is laid out page by page by the exporter, so printing it gives the
   * pages the writer has been looking at, and the same document anyone sent
   * the export would read. Off falls back to the web view's own print dialog,
   * which is faster on a long script and is what the browser's own margin and
   * scaling controls apply to.
   *
   * Only consulted where there is a print dialog to fall back to. iOS and
   * Android have none and have always printed the PDF — see printRoute().
   */
  printViaPdf: boolean;
  setPrintViaPdf: (v: boolean) => void;
}

const STORAGE_KEY_URL = 'opendraft:collabServerUrl';
const STORAGE_KEY_AUTH = 'opendraft:collabAuth';
const STORAGE_KEY_EXPIRY = 'opendraft:defaultInviteExpiry';
const STORAGE_KEY_FORMATS = 'opendraft:enabledScriptFormats';
const STORAGE_KEY_FORMATS_INIT = 'opendraft:formatPreferencesInitialized';
const STORAGE_KEY_BACKUP_ENABLED = 'opendraft:backupEnabled';
const STORAGE_KEY_BACKUP_FOLDER = 'opendraft:backupFolder';
const STORAGE_KEY_BACKUP_FOLDER_LABEL = 'opendraft:backupFolderLabel';
const STORAGE_KEY_BACKUP_INTERVAL = 'opendraft:backupIntervalMinutes';
const STORAGE_KEY_BACKUP_RETENTION = 'opendraft:backupRetentionCount';
const STORAGE_KEY_BACKUP_IMAGES = 'opendraft:backupIncludeImages';
const STORAGE_KEY_BACKUP_UNSAVED = 'opendraft:backupUnsavedDocs';
const STORAGE_KEY_ELEMENT_MENU_ON_ENTER = 'opendraft:elementMenuOnEnter';
const STORAGE_KEY_PRINT_VIA_PDF = 'opendraft:printViaPdf';
const STORAGE_KEY_ELEMENT_MENU_SHORTCUT = 'opendraft:elementMenuShortcut';

export const BACKUP_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;
/** 0 means "keep every snapshot". */
export const BACKUP_RETENTION_OPTIONS = [10, 25, 50, 100, 0] as const;

const DEFAULT_BACKUP_INTERVAL_MINUTES = 10;
const DEFAULT_BACKUP_RETENTION = 25;

/**
 * Read a stored integer, clamped into a sane range.
 *
 * Corrupted or hand-edited localStorage must never yield a 0ms timer interval
 * or a negative retention count, so every read goes through this rather than a
 * bare parseInt.
 */
function loadClampedInt(key: string, fallback: number, min: number, max: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Stored spec, the shipped default when nothing is stored, '' when switched off. */
function loadElementMenuShortcut(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ELEMENT_MENU_SHORTCUT);
    if (raw === null) return DEFAULT_ELEMENT_MENU_SHORTCUT;
    return raw && parseShortcut(raw) ? raw : '';
  } catch {
    return DEFAULT_ELEMENT_MENU_SHORTCUT;
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1';
}

function loadEnabledScriptFormats(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FORMATS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    }
  } catch { /* ignore */ }
  return [];
}

const DEFAULT_COLLAB_URL = 'wss://collab.open-draft.com';

function loadAuth(): CollabAuth {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH);
    if (raw) return JSON.parse(raw) as CollabAuth;
  } catch { /* ignore */ }
  return { accessToken: null, refreshToken: null, user: null };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  collabServerUrl: localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_COLLAB_URL,
  setCollabServerUrl: (url) => {
    localStorage.setItem(STORAGE_KEY_URL, url);
    set({ collabServerUrl: url });
  },


  collabAuth: loadAuth(),
  setCollabAuth: (auth) => {
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(auth));
    // A fresh token from login/refresh is implicitly verified — the server
    // just issued it. Avoids a flicker where AuthIndicator briefly shows
    // "Local only" right after sign-in while we wait for /auth/me.
    set({ collabAuth: auth, authVerified: Boolean(auth.accessToken && auth.user) });
  },
  clearCollabAuth: () => {
    localStorage.removeItem(STORAGE_KEY_AUTH);
    set({
      collabAuth: { accessToken: null, refreshToken: null, user: null },
      authVerified: false,
    });
  },

  authVerified: false,
  setAuthVerified: (verified) => set({ authVerified: verified }),

  defaultInviteExpiry: parseInt(localStorage.getItem(STORAGE_KEY_EXPIRY) || '1', 10),
  setDefaultInviteExpiry: (hours) => {
    localStorage.setItem(STORAGE_KEY_EXPIRY, String(hours));
    set({ defaultInviteExpiry: hours });
  },

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  enabledScriptFormats: loadEnabledScriptFormats(),
  setEnabledScriptFormats: (ids) => {
    try { localStorage.setItem(STORAGE_KEY_FORMATS, JSON.stringify(ids)); } catch { /* ignore */ }
    set({ enabledScriptFormats: ids });
  },

  formatPreferencesInitialized: localStorage.getItem(STORAGE_KEY_FORMATS_INIT) === '1',
  setFormatPreferencesInitialized: (v) => {
    try { localStorage.setItem(STORAGE_KEY_FORMATS_INIT, v ? '1' : '0'); } catch { /* ignore */ }
    set({ formatPreferencesInitialized: v });
  },

  // ── Automatic backups ────────────────────────────────────────────────
  backupEnabled: loadBool(STORAGE_KEY_BACKUP_ENABLED, false),
  setBackupEnabled: (v) => {
    try { localStorage.setItem(STORAGE_KEY_BACKUP_ENABLED, v ? '1' : '0'); } catch { /* ignore */ }
    set({ backupEnabled: v });
  },

  backupFolder: localStorage.getItem(STORAGE_KEY_BACKUP_FOLDER) || '',
  backupFolderLabel:
    localStorage.getItem(STORAGE_KEY_BACKUP_FOLDER_LABEL) ||
    // Folders chosen before mobile backups existed are desktop paths, which are
    // their own label.
    localStorage.getItem(STORAGE_KEY_BACKUP_FOLDER) || '',
  setBackupFolder: (handle, label) => {
    const shown = label ?? handle;
    try {
      localStorage.setItem(STORAGE_KEY_BACKUP_FOLDER, handle);
      localStorage.setItem(STORAGE_KEY_BACKUP_FOLDER_LABEL, shown);
    } catch { /* ignore */ }
    set({ backupFolder: handle, backupFolderLabel: shown });
  },

  backupIntervalMinutes: loadClampedInt(STORAGE_KEY_BACKUP_INTERVAL, DEFAULT_BACKUP_INTERVAL_MINUTES, 1, 240),
  setBackupIntervalMinutes: (m) => {
    const clamped = Math.min(240, Math.max(1, m));
    try { localStorage.setItem(STORAGE_KEY_BACKUP_INTERVAL, String(clamped)); } catch { /* ignore */ }
    set({ backupIntervalMinutes: clamped });
  },

  backupRetentionCount: loadClampedInt(STORAGE_KEY_BACKUP_RETENTION, DEFAULT_BACKUP_RETENTION, 0, 1000),
  setBackupRetentionCount: (n) => {
    const clamped = Math.min(1000, Math.max(0, n));
    try { localStorage.setItem(STORAGE_KEY_BACKUP_RETENTION, String(clamped)); } catch { /* ignore */ }
    set({ backupRetentionCount: clamped });
  },

  backupIncludeImages: loadBool(STORAGE_KEY_BACKUP_IMAGES, true),
  setBackupIncludeImages: (v) => {
    try { localStorage.setItem(STORAGE_KEY_BACKUP_IMAGES, v ? '1' : '0'); } catch { /* ignore */ }
    set({ backupIncludeImages: v });
  },

  backupUnsavedDocs: loadBool(STORAGE_KEY_BACKUP_UNSAVED, true),
  setBackupUnsavedDocs: (v) => {
    try { localStorage.setItem(STORAGE_KEY_BACKUP_UNSAVED, v ? '1' : '0'); } catch { /* ignore */ }
    set({ backupUnsavedDocs: v });
  },

  elementMenuOnEnter: loadBool(STORAGE_KEY_ELEMENT_MENU_ON_ENTER, true),
  setElementMenuOnEnter: (v) => {
    try { localStorage.setItem(STORAGE_KEY_ELEMENT_MENU_ON_ENTER, v ? '1' : '0'); } catch { /* ignore */ }
    set({ elementMenuOnEnter: v });
  },

  printViaPdf: loadBool(STORAGE_KEY_PRINT_VIA_PDF, true),
  setPrintViaPdf: (v) => {
    try { localStorage.setItem(STORAGE_KEY_PRINT_VIA_PDF, v ? '1' : '0'); } catch { /* ignore */ }
    set({ printViaPdf: v });
  },

  elementMenuShortcut: loadElementMenuShortcut(),
  setElementMenuShortcut: (spec) => {
    // '' is a real value here — it means "no shortcut" — so it is stored rather
    // than removed, or the default would come back on the next launch.
    const clean = spec && parseShortcut(spec) ? spec : '';
    try { localStorage.setItem(STORAGE_KEY_ELEMENT_MENU_SHORTCUT, clean); } catch { /* ignore */ }
    set({ elementMenuShortcut: clean });
  },
}));
