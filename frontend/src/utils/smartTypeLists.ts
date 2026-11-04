/** Per-device SmartType vocabulary. Empty lists are deliberate, not missing settings. */
export interface SmartTypeLists {
  scenePrefixes: readonly string[];
  times: readonly string[];
  characterExtensions: readonly string[];
  transitions: readonly string[];
}

export const DEFAULT_SMARTTYPE_LISTS: SmartTypeLists = {
  scenePrefixes: ['INT. ', 'EXT. ', 'INT./EXT. ', 'EST. ', 'I/E. '],
  times: [
    'DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING',
    'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME TIME',
  ],
  characterExtensions: ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)"],
  transitions: [
    'CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:',
    'FADE TO:', 'FADE OUT.', 'FADE TO BLACK.', 'INTERCUT WITH:',
  ],
};

export function normalizeSmartTypeLists(raw: unknown): SmartTypeLists {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const clean = (key: keyof SmartTypeLists): string[] => {
    const value = record[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return [...DEFAULT_SMARTTYPE_LISTS[key]];
    }
    const result: string[] = [];
    for (const item of value as string[]) {
      let text = item.replace(/\s+/g, ' ').trim().toUpperCase();
      if (key === 'characterExtensions') text = text.replace(/^\(+|\)+$/g, '').trim();
      if (!text) continue;
      if (key === 'characterExtensions') text = `(${text})`;
      if (key === 'scenePrefixes') text += ' ';
      if (!result.includes(text)) result.push(text);
    }
    return result;
  };
  return {
    scenePrefixes: clean('scenePrefixes'), times: clean('times'),
    characterExtensions: clean('characterExtensions'), transitions: clean('transitions'),
  };
}

/** Literal, longest-prefix match; punctuation is never interpreted as a regexp. */
export function matchScenePrefix(text: string, prefixes: readonly string[]): { prefix: string; length: number } | null {
  let best: { prefix: string; length: number } | null = null;
  for (const value of prefixes) {
    const prefix = value.trim();
    if (!prefix || text.slice(0, prefix.length).toUpperCase() !== prefix.toUpperCase()) continue;
    const space = /^\s+/.exec(text.slice(prefix.length));
    if (!space) continue;
    const length = prefix.length + space[0].length;
    if (!best || length > best.length) best = { prefix, length };
  }
  return best;
}
