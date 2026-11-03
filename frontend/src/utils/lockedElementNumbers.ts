/** Stable production labels, independent of page layout and rendering. */
import type { NumberingItem, NumberingRules } from './elementNumbers';
export const ELEMENT_NUMBER_LOCK_ATTR = 'elementNumberLocked';
export const NUMBERABLE_BLOCK_TYPES = [
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'general',
  'shot',
  'newAct',
  'endOfAct',
  'lyrics',
  'showEpisode',
  'castList',
  'customElement',
];
export const storedElementNumber = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function numberingGroups(items: NumberingItem[], rules: NumberingRules): number[][] {
  const owner = (id: string) =>
    rules[id]?.countWith && rules[rules[id].countWith!] && !rules[rules[id].countWith!].countWith
      ? rules[id].countWith!
      : id;
  const serial = new Map<string, number>();
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    for (const [id, rule] of Object.entries(rules))
      if (owner(id) === id && id !== item.elementId && rule.resetOn?.includes(item.elementId))
        serial.set(id, (serial.get(id) ?? 0) + 1);
    if (!rules[item.elementId]) return;
    const id = owner(item.elementId);
    const key = JSON.stringify([id, serial.get(id) ?? 0]);
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  return [...groups.values()];
}
function letters(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
    s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
function ordinal(s: string): number {
  let n = 0;
  for (const c of s.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n;
}
function insertion(previous: string | null, following: string | null, used: Set<string>): string {
  const split = (s: string) => /^(.*?\d)([A-Z]*)$/i.exec(s);
  let base: string;
  let n = 1;
  if (previous) {
    const p = split(previous);
    const next = following ? split(following) : null;
    const parent = p ? /^(.*?)(\d+)$/.exec(p[1]) : null;
    const child = next ? /^(.*?)(\d+)$/.exec(next[1]) : null;
    const prefixedFollowing =
      parent &&
      child &&
      parent[2] === child[2] &&
      child[1].toUpperCase().startsWith(parent[1].toUpperCase()) &&
      child[1].length > parent[1].length;
    if (
      prefixedFollowing ||
      (p && next && p[1] === next[1] && next[2].toUpperCase() === p[2].toUpperCase() + 'A')
    ) {
      // Prefix the following reference before a first suffix or an existing
      // prefix insertion: 1 / 1A -> A1A, then 1 / A1A -> AA1A.
      return insertion(null, following, used);
    }
    if (p && next && p[1] === next[1]) base = previous;
    else if (p) {
      base = p[1];
      n = ordinal(p[2]) + 1;
    } else base = previous + '-';
    for (; ; n++) {
      const label = base + letters(n);
      if (!used.has(label.toUpperCase())) return label;
    }
  }
  const next = following ?? '1';
  const m = /^(.*?)(\d.*)$/.exec(next);
  for (; ; n++) {
    const label = m ? m[1] + letters(n) + m[2] : letters(n) + '-' + next;
    if (!used.has(label.toUpperCase())) return label;
  }
}
export function retainElementNumbers(
  items: NumberingItem[],
  rules: NumberingRules,
  automatic: Array<string | null>,
): Array<string | null> {
  if (!items.some((item) => item.number)) return automatic;
  // Sparse imports remain visible without a numbering format. When their
  // type has an active counter, imported automatic references follow it.
  const isAutomatic = (i: number) => items[i].numberAutomatic && !!rules[items[i].elementId];
  const out = automatic.map((label, i) => (!isAutomatic(i) ? (items[i].number ?? label) : label));
  const owner = (id: string) => rules[id]?.countWith ?? id;
  const lockedOwners = new Set(
    items.filter((item) => item.numberLocked).map((item) => owner(item.elementId)),
  );
  for (const group of numberingGroups(items, rules)) {
    const locked = group.some((i) => lockedOwners.has(owner(items[i].elementId)));
    const hasAnchors = group.some((i) => items[i].number && !isAutomatic(i));
    const used = new Set(
      group
        .map((i) => (!isAutomatic(i) ? items[i].number?.toUpperCase() : undefined))
        .filter((n): n is string => !!n),
    );
    let previous: string | null = null;
    group.forEach((i, position) => {
      const item = items[i];
      if (item.number && !isAutomatic(i)) {
        out[i] = item.number;
        previous = item.number;
        return;
      }
      if (out[i] == null) return;
      if (locked && hasAnchors) {
        const following =
          group
            .slice(position + 1)
            .map((j) => (isAutomatic(j) ? null : items[j].number))
            .find(Boolean) ?? null;
        out[i] = insertion(previous, following, used);
      }
      if (out[i]) {
        used.add(out[i]!.toUpperCase());
        previous = out[i];
      }
    });
  }
  return out;
}
