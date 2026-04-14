/**
 * Compatibility tracking for backward-compatibility fallbacks.
 *
 * Each subsystem records whether it is using the primary (modern) API
 * or a fallback implementation.  The About → Compatibility panel reads
 * this at runtime so developers can verify that no fallback is active
 * on a platform that should support the primary API.
 */

export interface CompatEntry {
  /** Human-readable subsystem label shown in the UI. */
  label: string;
  /** Which implementation is active: 'primary' or 'fallback'. */
  mode: 'primary' | 'fallback';
  /** Short description of the active implementation. */
  using: string;
  /** What the primary (preferred) implementation is. */
  primary: string;
  /** What the fallback implementation is. */
  fallback: string;
}

const entries: Record<string, CompatEntry> = {};

/** Register or update a compatibility entry. */
export function setCompat(
  key: string,
  label: string,
  mode: 'primary' | 'fallback',
  primary: string,
  fallback: string,
): void {
  entries[key] = {
    label,
    mode,
    using: mode === 'primary' ? primary : fallback,
    primary,
    fallback,
  };
}

/** Return a snapshot of all registered entries (for the About dialog). */
export function getCompatEntries(): CompatEntry[] {
  return Object.values(entries);
}

// ── Detect capabilities once at import time ─────────────────────────────────

/** Test whether crypto.randomUUID() is available. */
export function detectUuid(): 'primary' | 'fallback' {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { crypto.randomUUID(); return 'primary'; } catch { /* secure context required */ }
  }
  return 'fallback';
}

/** Test whether SubtleCrypto is available. */
export function detectHash(): 'primary' | 'fallback' {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return 'primary';
  }
  return 'fallback';
}

/** Test whether the modern Clipboard API is available. */
export function detectClipboard(): 'primary' | 'fallback' {
  return (navigator.clipboard && (window as any).isSecureContext)
    ? 'primary'
    : 'fallback';
}

// Run detections and register entries immediately.
// Storage is registered later by initStorage().
const uuidMode = detectUuid();
setCompat('uuid', 'UUID Generation', uuidMode,
  'crypto.randomUUID()', 'crypto.getRandomValues() polyfill');

const hashMode = detectHash();
setCompat('hash', 'Content Hashing', hashMode,
  'SHA-256 (SubtleCrypto)', 'DJB2 (JS fallback)');

const clipMode = detectClipboard();
setCompat('clipboard', 'Clipboard', clipMode,
  'Clipboard API', 'document.execCommand() legacy');
