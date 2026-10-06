/**
 * Scene numbers, locked and unlocked.
 *
 * Unlocked, scenes are simply numbered 1, 2, 3… in order, and hiding the
 * numbers clears them.
 *
 * Locked (Tools → Production → Lock Scene Numbers) every numbered scene keeps
 * its number for good, the way a production script must once a schedule has
 * been built on it:
 *
 *  - a scene added after 12 is 12A, then 12B; one added before scene 1 is A1;
 *  - a heading that arrives with a number another scene holds is new: a
 *    pasted copy is stripped of it as it is pasted, and the second half of a
 *    heading split with Enter as it is split (newDuplicateNumbers);
 *  - duplicates already in a script — an earlier version numbered a scene
 *    inserted into a locked script by its position, which is the number of
 *    the scene after it — keep the number on the later scene, the original;
 *  - hiding the numbers hides them and nothing more. They stay on the scenes,
 *    so showing them again shows the numbers the production knows.
 */

/** The letters after a scene number's digits: "12A" → ["12", "A"]. */
function split(num: string): { stem: string; letters: string } {
  const m = /^(.*?\d)([A-Z]*)$/i.exec(num);
  return m ? { stem: m[1], letters: m[2].toUpperCase() } : { stem: num, letters: '' };
}

/** "A" → "B", "Z" → "AA", "AZ" → "BA". */
function nextLetters(letters: string): string {
  if (letters === '') return 'A';
  const chars = letters.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
    i--;
  }
  return 'A' + chars.join('');
}

/** The first number of the form `stem + letters` not already taken. */
function after(prev: string, used: Set<string>): string {
  const { stem, letters } = split(prev);
  let candidate = letters ? stem + nextLetters(letters) : `${stem}A`;
  // Bounded: a script would need hundreds of inserts after one scene.
  for (let guard = 0; guard < 2000 && used.has(candidate); guard++) {
    const parts = split(candidate);
    candidate = parts.stem + nextLetters(parts.letters);
  }
  return candidate;
}

/** A1, B1… for a scene placed before the first numbered one. */
function before(next: string, used: Set<string>): string {
  let prefix = 'A';
  for (let guard = 0; guard < 2000 && used.has(prefix + next); guard++) prefix = nextLetters(prefix);
  return prefix + next;
}

export interface SceneNumberOptions {
  visible: boolean;
  locked: boolean;
}

/**
 * The number every scene heading should carry, in document order, given what
 * each carries now (null for none). Null means "no number".
 */
export function assignSceneNumbers(current: Array<string | null | undefined>, opts: SceneNumberOptions): Array<string | null> {
  const norm = current.map((c) => (c == null ? '' : String(c).trim()));

  if (!opts.locked) {
    return norm.map((_c, i) => (opts.visible ? String(i + 1) : null));
  }

  // Locked: a number held by a later scene is not this scene's to keep.
  const kept: Array<string | null> = new Array(norm.length).fill(null);
  const used = new Set<string>();
  for (let i = norm.length - 1; i >= 0; i--) {
    const c = norm[i];
    if (c && !used.has(c)) { kept[i] = c; used.add(c); }
  }

  // Nothing was ever numbered (locked straight from a fresh script): number
  // them, and the lock holds from here on.
  if (kept.every((k) => k === null)) {
    return opts.visible ? norm.map((_c, i) => String(i + 1)) : norm.map(() => null);
  }

  const out: Array<string | null> = [...kept];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    const prev = i > 0 ? out[i - 1] : null;
    let num: string;
    if (prev) {
      num = after(prev, used);
    } else {
      const next = out.slice(i + 1).find((n): n is string => n !== null) ?? '1';
      num = before(next, used);
    }
    out[i] = num;
    used.add(num);
  }
  return out;
}

/** A node as `newDuplicateNumbers` needs it — any ProseMirror document. */
interface HeadingDoc {
  descendants(f: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void): void;
}

function headingNumbers(doc: HeadingDoc): Array<{ pos: number; num: string }> {
  const out: Array<{ pos: number; num: string }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'sceneHeading') {
      const n = node.attrs.sceneNumber;
      if (n != null && String(n).trim() !== '') out.push({ pos, num: String(n).trim() });
      return false;
    }
    return true;
  });
  return out;
}

/**
 * Headings an edit has just given a number another scene already holds — the
 * second half of a heading split with Enter (ProseMirror copies every
 * attribute to both halves of a mid-line split). Returned last first, so the
 * heading that had the number before the edit keeps it.
 *
 * Duplicates that were already in the document are left alone: those come
 * from an earlier version, and assignSceneNumbers resolves them.
 */
export function newDuplicateNumbers(before: HeadingDoc, after: HeadingDoc): number[] {
  const had = new Map<string, number>();
  for (const { num } of headingNumbers(before)) had.set(num, (had.get(num) ?? 0) + 1);
  const seen = new Map<string, number>();
  const clear: number[] = [];
  for (const { pos, num } of headingNumbers(after)) {
    const count = (seen.get(num) ?? 0) + 1;
    seen.set(num, count);
    if (count > Math.max(1, had.get(num) ?? 0)) clear.push(pos);
  }
  return clear.reverse();
}
