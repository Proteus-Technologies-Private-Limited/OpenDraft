/**
 * Keyboard shortcuts a writer can change: storing them, matching them, and
 * writing them the way the platform writes them.
 *
 * Specs are stored in ProseMirror's own notation — modifiers joined with `-`,
 * ending in the key — with `Mod` meaning Command on a Mac and Control
 * everywhere else. Storing `Mod` rather than the resolved modifier is what lets
 * the same setting follow a writer between a Mac and a PC and still read as the
 * shortcut that platform expects.
 *
 * Keys come from `event.code`, not `event.key`: on a Mac, Option+E reports its
 * key as `Dead` (it is the accent prefix for é), and Option with almost any
 * letter reports a different character entirely. `code` is the physical key,
 * which is what a shortcut actually means.
 */

const NAMED_CODES: Record<string, string> = {
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

/** Mac glyphs. Anything absent is written out in words. */
const MAC_KEY_LABELS: Record<string, string> = {
  Enter: '↩', Tab: '⇥', Backspace: '⌫', Delete: '⌦',
  Escape: '⎋', Space: 'Space',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

const PC_KEY_LABELS: Record<string, string> = {
  Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Del',
  Escape: 'Esc', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};

export interface ShortcutParts {
  /** Command on a Mac, Control elsewhere. */
  mod: boolean;
  /** Control on a Mac specifically; folded into `mod` everywhere else. */
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
}

/** The portable key name for a physical key, or null if it cannot be one. */
export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_CODES[code] ?? null;
}

export function parseShortcut(spec: string): ShortcutParts | null {
  if (!spec) return null;
  const segments = spec.split('-').filter(Boolean);
  const key = segments.pop();
  if (!key) return null;
  const parts: ShortcutParts = { mod: false, ctrl: false, alt: false, shift: false, key };
  for (const seg of segments) {
    switch (seg.toLowerCase()) {
      case 'mod': case 'cmd': case 'meta': parts.mod = true; break;
      case 'ctrl': case 'control': parts.ctrl = true; break;
      case 'alt': case 'option': parts.alt = true; break;
      case 'shift': parts.shift = true; break;
      default: return null;
    }
  }
  // A shortcut with no modifier would swallow ordinary typing.
  if (!parts.mod && !parts.ctrl && !parts.alt) return null;
  return parts;
}

/** Canonical spec string, so two ways of writing the same shortcut compare equal. */
export function formatSpec(parts: ShortcutParts): string {
  const out: string[] = [];
  if (parts.mod) out.push('Mod');
  if (parts.ctrl) out.push('Ctrl');
  if (parts.alt) out.push('Alt');
  if (parts.shift) out.push('Shift');
  out.push(parts.key);
  return out.join('-');
}

/**
 * The shortcut a key event represents, or null when it is not one: a bare
 * modifier, a key with no modifier at all, or a key with no portable name.
 */
export function shortcutFromEvent(
  e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac = isMacPlatform(),
): string | null {
  // A bare modifier needs no special case: `AltLeft`, `ShiftRight`, `CapsLock`
  // and friends have no portable name, so `keyFromCode` already refuses them.
  const key = keyFromCode(e.code);
  if (!key) return null;
  const parts: ShortcutParts = {
    mod: mac ? e.metaKey : e.ctrlKey,
    ctrl: mac ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    key,
  };
  if (!parts.mod && !parts.ctrl && !parts.alt) return null;
  return formatSpec(parts);
}

/** Does this key event fire the given shortcut? */
export function matchesShortcut(
  e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  spec: string,
  mac = isMacPlatform(),
): boolean {
  const wanted = parseShortcut(spec);
  if (!wanted) return false;
  const got = shortcutFromEvent(e, mac);
  return got !== null && got === formatSpec(wanted);
}

/**
 * The shortcut as the platform writes it: `⌥↩` on a Mac, `Alt+Enter` elsewhere.
 * Mac order is the system order — Control, Option, Shift, Command.
 */
export function formatShortcut(spec: string, mac = isMacPlatform()): string {
  const parts = parseShortcut(spec);
  if (!parts) return '';
  const letter = parts.key.length === 1 ? parts.key.toUpperCase() : parts.key;
  if (mac) {
    return [
      parts.ctrl ? '⌃' : '',
      parts.alt ? '⌥' : '',
      parts.shift ? '⇧' : '',
      parts.mod ? '⌘' : '',
      MAC_KEY_LABELS[parts.key] ?? letter,
    ].join('');
  }
  const words: string[] = [];
  // Off a Mac, Mod *is* Control, so a spec carrying both must not say it twice.
  if (parts.mod || parts.ctrl) words.push('Ctrl');
  if (parts.alt) words.push('Alt');
  if (parts.shift) words.push('Shift');
  words.push(PC_KEY_LABELS[parts.key] ?? letter);
  return words.join('+');
}
