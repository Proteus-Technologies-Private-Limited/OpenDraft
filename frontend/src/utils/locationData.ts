/**
 * Location records and the rules for building them.
 *
 * Shared by the Locations panel and by the storages that keep locations on the
 * device (services/localLocations.ts). The Python backend applies the same
 * rules for the browser build (backend/app/services/location_service.py) — a
 * location discovered in the desktop app and one discovered on the web must
 * come out with the same name, so keep the two in step.
 */
import type { LocationEntry, LocationLook } from '../services/api';

export type LocationType = LocationEntry['type'];

// The prefix ends at a space or at the end of the line: a heading that is so far
// only `INT.` names no place, and must not be recorded as a location called INT.
const PREFIX_RE = /^(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)(?:\s+|$)/i;
const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR';
const DASH_TIME_RE = new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?$`, 'i');
const DOT_TIME_RE = new RegExp(`\\.\\s*(${TIME_WORDS})\\.?$`, 'i');

const LOCATION_TYPES: readonly LocationType[] = ['interior', 'exterior', 'both'];

/** The canonical form a location is stored and matched under. */
export function normalizeLocationName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * The location a scene heading names, and whether it is shot inside or out.
 *
 * `INT. KITCHEN - DAY` → `{ name: 'KITCHEN', type: 'interior' }`. A heading
 * with no INT/EXT prefix counts as an interior, as the backend has it.
 */
export function parseHeadingLocation(heading: string): { name: string; type: LocationType } {
  let rest = heading.trim();
  let type: LocationType = 'interior';

  const prefix = rest.match(PREFIX_RE);
  if (prefix) {
    const raw = prefix[1].toUpperCase();
    if (raw.includes('/')) type = 'both';
    else if (raw.startsWith('EXT')) type = 'exterior';
    rest = rest.slice(prefix[0].length);
  }

  const dashTime = rest.match(DASH_TIME_RE);
  if (dashTime) {
    rest = rest.slice(0, -dashTime[0].length);
  } else {
    const dotTime = rest.match(DOT_TIME_RE);
    if (dotTime) rest = rest.slice(0, -dotTime[0].length);
  }

  return { name: normalizeLocationName(rest.replace(/^[\s.]+|[\s.]+$/g, '')), type };
}

/** Just the location name of a scene heading (`''` when it names none). */
export function parseLocationFromHeading(heading: string): string {
  return parseHeadingLocation(heading).name;
}

function randomHex(): string {
  let hex = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      hex = crypto.randomUUID().replace(/-/g, '');
    } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      hex = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // randomUUID needs a secure context; fall through to the fallback below.
  }
  if (hex.length < 12) {
    hex = (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(12, '0');
  }
  return hex.slice(0, 12);
}

/** An id for a new look: `look-` plus twelve hex digits. */
export function newLookId(): string {
  return `look-${randomHex()}`;
}

/**
 * The named looks of a location, keeping only well-formed ones: each needs an
 * id and a name, and an id appears once. The backend applies the same rule
 * (location_service._clean_looks).
 */
export function cleanLooks(value: unknown): LocationLook[] {
  if (!Array.isArray(value)) return [];
  const out: LocationLook[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = text(r.id);
    const name = text(r.name).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, imageAssetId: text(r.imageAssetId) || null });
  }
  return out;
}

/**
 * The look a scene shows: the one it chose if the location still has it,
 * else the one named like the heading's time of day (`NIGHT` → "Night"),
 * else none.
 */
export function lookForScene(
  looks: readonly LocationLook[],
  lookId: string | null | undefined,
  timeOfDay: string,
): LocationLook | null {
  if (lookId) {
    const chosen = looks.find((l) => l.id === lookId);
    if (chosen) return chosen;
  }
  const time = timeOfDay.trim().toUpperCase();
  if (!time) return null;
  return looks.find((l) => l.name.trim().toUpperCase() === time) ?? null;
}

/** `loc-` plus twelve hex digits — the shape the backend gives its ids. */
export function newLocationId(): string {
  return `loc-${randomHex()}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function locationType(value: unknown): LocationType {
  return LOCATION_TYPES.includes(value as LocationType) ? (value as LocationType) : 'interior';
}

function nameList(value: unknown): string[] {
  return textList(value).map(normalizeLocationName).filter(Boolean);
}

/** A new location from what the caller supplied. Throws when it has no name. */
export function buildLocation(
  payload: Partial<LocationEntry> & { name: string },
  id: string,
  now: string,
): LocationEntry {
  const name = normalizeLocationName(text(payload.name));
  if (!name) throw new Error('Location name is required');
  return {
    id,
    name,
    fullName: text(payload.fullName),
    description: text(payload.description),
    type: locationType(payload.type),
    address: text(payload.address),
    notes: text(payload.notes),
    contact: text(payload.contact),
    availability: text(payload.availability),
    tags: textList(payload.tags),
    imageAssetIds: textList(payload.imageAssetIds),
    aliases: nameList(payload.aliases),
    looks: cleanLooks(payload.looks),
    created_at: now,
    updated_at: now,
  };
}

/**
 * A location with the caller's changes applied. Only the fields a writer can
 * edit are taken from `payload`; `id` and `created_at` never change, and a
 * blank name leaves the existing one alone.
 */
export function applyLocationUpdate(
  loc: LocationEntry,
  payload: Partial<LocationEntry>,
  now: string,
): LocationEntry {
  const next: LocationEntry = { ...loc };
  if (typeof payload.fullName === 'string') next.fullName = payload.fullName;
  if (typeof payload.description === 'string') next.description = payload.description;
  if (payload.type !== undefined) next.type = locationType(payload.type);
  if (typeof payload.address === 'string') next.address = payload.address;
  if (typeof payload.notes === 'string') next.notes = payload.notes;
  if (typeof payload.contact === 'string') next.contact = payload.contact;
  if (typeof payload.availability === 'string') next.availability = payload.availability;
  if (payload.tags !== undefined) next.tags = textList(payload.tags);
  if (payload.imageAssetIds !== undefined) next.imageAssetIds = textList(payload.imageAssetIds);
  if (payload.aliases !== undefined) next.aliases = nameList(payload.aliases);
  if (payload.looks !== undefined) next.looks = cleanLooks(payload.looks);
  if (typeof payload.name === 'string') {
    const name = normalizeLocationName(payload.name);
    if (name) next.name = name;
  }
  next.updated_at = now;
  return next;
}

/**
 * Whatever was read from storage, as a list of well-formed locations.
 *
 * Accepts the bare array the device storages write and the `{ locations: [] }`
 * wrapper the backend's locations.json uses. Entries without an id or a name
 * cannot be shown or edited, so they are dropped rather than repaired.
 */
export function sanitizeLocations(raw: unknown): LocationEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { locations?: unknown }).locations)
      ? (raw as { locations: unknown[] }).locations
      : [];
  const out: LocationEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = text(r.id);
    const name = normalizeLocationName(text(r.name));
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      fullName: text(r.fullName),
      description: text(r.description),
      type: locationType(r.type),
      address: text(r.address),
      notes: text(r.notes),
      contact: text(r.contact),
      availability: text(r.availability),
      tags: textList(r.tags),
      imageAssetIds: textList(r.imageAssetIds),
      aliases: nameList(r.aliases),
      looks: cleanLooks(r.looks),
      created_at: text(r.created_at),
      updated_at: text(r.updated_at),
    });
  }
  return out;
}

/** The text of every scene heading in an editor document (TipTap JSON). */
export function sceneHeadingsOf(doc: unknown): string[] {
  const headings: string[] = [];
  const textOf = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    if (n.type === 'text') return text(n.text);
    // A line break inside a heading separates words; it is not part of a name.
    if (n.type === 'hardBreak') return ' ';
    return Array.isArray(n.content) ? n.content.map(textOf).join('') : '';
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: unknown; content?: unknown };
    if (n.type === 'sceneHeading') {
      headings.push(textOf(n));
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return headings;
}

/**
 * Add an entry for every location the scripts name that is not on record yet.
 *
 * A name already known — as a location or as one of its aliases — is left
 * alone. A place seen both as INT. and as EXT. is recorded as "both".
 */
export function discoverNewLocations(
  existing: LocationEntry[],
  docs: unknown[],
  makeId: () => string,
  now: string,
): { discovered: number; locations: LocationEntry[] } {
  const known = new Set<string>();
  for (const loc of existing) {
    known.add(loc.name);
    for (const alias of loc.aliases) known.add(alias);
  }

  const found = new Map<string, LocationType>();
  for (const doc of docs) {
    for (const heading of sceneHeadingsOf(doc)) {
      const { name, type } = parseHeadingLocation(heading);
      if (!name || known.has(name)) continue;
      const seenAs = found.get(name);
      found.set(name, seenAs && seenAs !== type ? 'both' : type);
    }
  }

  const created: LocationEntry[] = [];
  for (const [name, type] of found) {
    created.push(buildLocation({ name, type }, makeId(), now));
  }
  return { discovered: created.length, locations: [...existing, ...created] };
}

/** The record a scene heading's location name belongs to: by its name, or one of its aliases. */
export function locationNamed(locations: readonly LocationEntry[], name: string): LocationEntry | null {
  const wanted = normalizeLocationName(name);
  if (!wanted) return null;
  return locations.find((l) => l.name === wanted)
    ?? locations.find((l) => l.aliases.includes(wanted))
    ?? null;
}
