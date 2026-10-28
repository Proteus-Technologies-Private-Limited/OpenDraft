/**
 * Plotlines: the story threads a script weaves — A-story, B-story, a
 * character's arc — each with a colour, and the scenes and beats that carry
 * them.
 *
 * The plotlines themselves belong to the script and are saved with it
 * (`_plotlines`, see utils/saveContent). Which plotlines a scene carries is
 * stored on its scene heading (`plotlines` attribute), so it travels with the
 * scene when scenes are moved, cut or pasted, and reaches collaborators the
 * way any edit does. A beat lists its own (`BeatInfo.plotlineIds`).
 *
 * The Story Timeline (utils/storyTimeline) lays the scenes out by screen time.
 * This module stays free of the timing engine so the store can import it.
 */
import { uuid } from './uuid';

export interface Plotline {
  id: string;
  name: string;
  color: string;
}

/** Distinct enough to tell apart in a thin timeline row, in both themes. */
export const PLOTLINE_COLORS = [
  '#e06060', '#4a9eff', '#6abf69', '#e89b4f', '#b58ee0', '#2bb5a8', '#e06c9f', '#c9a227',
] as const;

const DEFAULT_NAMES = ['A Story', 'B Story', 'C Story'];

/** A new plotline: the next of A/B/C Story, then "Plotline 4"…, in the next unused colour. */
export function newPlotline(existing: Plotline[]): Plotline {
  const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  let name = DEFAULT_NAMES.find((n) => !taken.has(n.toLowerCase()));
  for (let n = existing.length + 1; !name; n++) {
    if (!taken.has(`plotline ${n}`)) name = `Plotline ${n}`;
  }
  const used = new Set(existing.map((p) => p.color));
  const color = PLOTLINE_COLORS.find((c) => !used.has(c)) ?? PLOTLINE_COLORS[existing.length % PLOTLINE_COLORS.length];
  return { id: uuid(), name, color };
}

/** Plotlines as read from a file or a collaborator; anything malformed is dropped. */
export function normalizePlotlines(value: unknown): Plotline[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Plotline[] = [];
  for (const p of value) {
    if (!p || typeof p !== 'object') continue;
    const { id, name, color } = p as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof name === 'string' ? name : '',
      color: typeof color === 'string' && color ? color : PLOTLINE_COLORS[out.length % PLOTLINE_COLORS.length],
    });
  }
  return out;
}

/** The plotline ids a scene heading carries. */
export function plotlineIdsOf(attrs: Record<string, unknown> | null | undefined): string[] {
  const raw = attrs?.plotlines;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}
