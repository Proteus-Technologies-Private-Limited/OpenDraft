/** Fold Latin accents while retaining vowel signs and viramas in other scripts. */
export function menuSearchText(value: string): string {
  return value.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').toLocaleLowerCase();
}

/** KeyboardEvent.key can contain an entire grapheme, or a separate vowel sign. */
export function menuSearchKey(key: string): boolean {
  if (!key || /[\p{Cc}\p{Z}]/u.test(key)) return false;
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(key)].length === 1;
}

/** Convert the platform's displayed shortcut to ARIA's modifier/key spelling. */
export function menuKeyShortcuts(display: string | undefined): string | undefined {
  if (!display) return undefined;
  const glyphs: Record<string, string> = {
    '⌘': 'Meta+', '⌃': 'Control+', '⌥': 'Alt+', '⇧': 'Shift+',
    '↩': 'Enter', '⇥': 'Tab', '⌫': 'Backspace', '⌦': 'Delete',
    '⎋': 'Escape', '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', '−': '-',
  };
  let rest = display.replace(/[⌘⌃⌥⇧↩⇥⌫⌦⎋↑↓←→−]/gu, glyph => glyphs[glyph]);
  const modifiers = new Set<string>();
  const names: Record<string, string> = { Ctrl: 'Control', Cmd: 'Meta', Command: 'Meta', Option: 'Alt' };
  let match: RegExpMatchArray | null;
  while ((match = rest.match(/^(Control|Ctrl|Meta|Cmd|Command|Alt|Option|Shift)\+/))) {
    modifiers.add(names[match[1]] ?? match[1]);
    rest = rest.slice(match[0].length);
  }
  const aliases: Record<string, string> = { Esc: 'Escape', Del: 'Delete', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
  rest = aliases[rest] ?? rest;
  if (rest === '+') rest = 'plus';
  if (!rest || (!/^\S$/u.test(rest)
    && !/^(F(?:[1-9]|1[0-9]|2[0-4])|Enter|Tab|Space|Backspace|Delete|Escape|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|plus)$/.test(rest))) return undefined;
  return [...modifiers, rest].join('+');
}
