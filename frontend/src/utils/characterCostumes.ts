/**
 * The named costumes a character owns (Chef whites, Rain jacket…), each with
 * an optional reference image from the project's assets. Scenes pick from
 * this list (utils/sceneDetails), so a costume is described once and reused.
 */

/** One costume on a character profile. */
export interface CharacterCostume {
  id: string;
  name: string;
  /** Asset id of the costume's reference image, or null. */
  imageAssetId: string | null;
  notes: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An id for a new costume: `cos-` plus twelve hex digits. */
export function newCostumeId(): string {
  let hex = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      hex = crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // randomUUID needs a secure context; fall through to the fallback below.
  }
  if (hex.length < 12) hex = (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(12, '0');
  return `cos-${hex.slice(0, 12)}`;
}

/**
 * A profile's costumes, whatever the file or a collaborator sent. Each needs
 * an id and a name, and an id appears once; anything else is dropped.
 */
export function cleanCostumes(value: unknown): CharacterCostume[] {
  if (!Array.isArray(value)) return [];
  const out: CharacterCostume[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = text(r.id);
    const name = text(r.name).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, imageAssetId: text(r.imageAssetId) || null, notes: text(r.notes) });
  }
  return out;
}

/** Two costume lists as one: `first`'s, then those of `second` it does not already have (by id). */
export function mergeCostumes(first: readonly CharacterCostume[], second: readonly CharacterCostume[]): CharacterCostume[] {
  const ids = new Set(first.map((c) => c.id));
  return [...first, ...second.filter((c) => !ids.has(c.id))];
}
