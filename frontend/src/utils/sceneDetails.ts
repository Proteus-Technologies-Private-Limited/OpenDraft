/**
 * What a scene holds beyond its text: who is in it and what they wear, how
 * its location looks, and the shots written in it.
 *
 * Who speaks in a scene and where it is set are read from the script. Only
 * what the script cannot say is entered by hand, and it is kept on the scene
 * heading as the `sceneDetails` attribute — beside the synopsis and the scene
 * colour — so it moves with the scene when it is cut, pasted or reordered and
 * reaches collaborators like any other edit:
 *
 * - the costumes each character wears, in order, with a note on when a change
 *   happens (a character can change costume within a scene);
 * - characters who are there without speaking;
 * - which of the location's looks the scene shows, and a note on how the place
 *   differs in this scene.
 *
 * Costumes belong to the character profile and looks to the location record;
 * a scene names them by id, so renaming a costume or replacing its image
 * changes every scene that uses it. A shot names which of a character's
 * costumes it shows when the scene has more than one (`shotCostumes` on the
 * shot node).
 */
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { characterKey, singleLine } from './nodeText';
import { parseHeadingLocation, type LocationType } from './locationData';
import { sceneUidOf } from './beatScenes';

export const SCENE_DETAILS_ATTR = 'sceneDetails';
export const SHOT_COSTUMES_ATTR = 'shotCostumes';

/** One costume a character wears in a scene. */
export interface SceneCostumeRef {
  /** Id of a costume on the character's profile. */
  costumeId: string;
  /** When the change into it happens; unused for the first costume. */
  when: string;
}

export interface SceneDetails {
  /** Costumes per character (by character key), in the order they are worn. */
  costumes: Record<string, SceneCostumeRef[]>;
  /** Characters who are in the scene without speaking, by character key. */
  present: string[];
  /** Id of the location look the scene shows; null for the one its time of day suggests. */
  lookId: string | null;
  /** What is different about the location in this scene. */
  setting: string;
}

export const EMPTY_SCENE_DETAILS: SceneDetails = Object.freeze({
  costumes: Object.freeze({}) as Record<string, SceneCostumeRef[]>,
  present: Object.freeze([]) as unknown as string[],
  lookId: null,
  setting: '',
}) as SceneDetails;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A heading's scene details, whatever the file or a collaborator sent. Anything
 * malformed is dropped rather than repaired: a costume without an id cannot be
 * shown, and a name that is not a string cannot be matched.
 */
export function readSceneDetails(raw: unknown): SceneDetails {
  let value = raw;
  if (typeof value === 'string') {
    // The HTML form (copy and paste) carries the details as JSON text.
    try { value = JSON.parse(value); } catch { return EMPTY_SCENE_DETAILS; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_SCENE_DETAILS;
  const r = value as Record<string, unknown>;

  const costumes: Record<string, SceneCostumeRef[]> = {};
  if (r.costumes && typeof r.costumes === 'object' && !Array.isArray(r.costumes)) {
    for (const [name, list] of Object.entries(r.costumes as Record<string, unknown>)) {
      const key = characterKey(name);
      if (!key || !Array.isArray(list)) continue;
      const refs: SceneCostumeRef[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const c = item as Record<string, unknown>;
        const costumeId = text(c.costumeId);
        if (!costumeId || refs.some((x) => x.costumeId === costumeId)) continue;
        refs.push({ costumeId, when: text(c.when) });
      }
      if (refs.length) costumes[key] = [...(costumes[key] ?? []), ...refs];
    }
  }

  const present = Array.isArray(r.present)
    ? [...new Set(r.present.filter((x): x is string => typeof x === 'string').map(characterKey).filter(Boolean))]
    : [];
  const lookId = text(r.lookId) || null;
  const setting = text(r.setting);

  if (!Object.keys(costumes).length && !present.length && !lookId && !setting) return EMPTY_SCENE_DETAILS;
  return { costumes, present, lookId, setting };
}

/** Whether there is nothing to store. */
export function isEmptySceneDetails(d: SceneDetails): boolean {
  return !Object.keys(d.costumes).length && !d.present.length && !d.lookId && !d.setting;
}

/** The value to store on the heading: null when there is nothing to keep. */
export function sceneDetailsAttr(d: SceneDetails): SceneDetails | null {
  return isEmptySceneDetails(d) ? null : d;
}

// ── Changes ─────────────────────────────────────────────────────────────────

/** The costumes a character wears in the scene, in order. */
export function costumesIn(d: SceneDetails, character: string): SceneCostumeRef[] {
  return d.costumes[characterKey(character)] ?? [];
}

function withCostumes(d: SceneDetails, character: string, list: SceneCostumeRef[]): SceneDetails {
  const key = characterKey(character);
  const costumes = { ...d.costumes };
  if (list.length) costumes[key] = list;
  else delete costumes[key];
  return { ...d, costumes };
}

/** The scene with a costume added after the character's others. A costume already listed is left alone. */
export function addSceneCostume(d: SceneDetails, character: string, costumeId: string): SceneDetails {
  const list = costumesIn(d, character);
  if (!costumeId || list.some((x) => x.costumeId === costumeId)) return d;
  return withCostumes(d, character, [...list, { costumeId, when: '' }]);
}

export function removeSceneCostume(d: SceneDetails, character: string, costumeId: string): SceneDetails {
  return withCostumes(d, character, costumesIn(d, character).filter((x) => x.costumeId !== costumeId));
}

export function setSceneCostumeWhen(d: SceneDetails, character: string, costumeId: string, when: string): SceneDetails {
  return withCostumes(d, character, costumesIn(d, character).map((x) => (x.costumeId === costumeId ? { ...x, when } : x)));
}

/** Move one of a character's costumes up (-1) or down (+1) the order they are worn in. */
export function moveSceneCostume(d: SceneDetails, character: string, costumeId: string, by: -1 | 1): SceneDetails {
  const list = [...costumesIn(d, character)];
  const i = list.findIndex((x) => x.costumeId === costumeId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return d;
  [list[i], list[j]] = [list[j], list[i]];
  return withCostumes(d, character, list);
}

export function addPresentCharacter(d: SceneDetails, character: string): SceneDetails {
  const key = characterKey(character);
  if (!key || d.present.includes(key)) return d;
  return { ...d, present: [...d.present, key] };
}

/** A non-speaking character taken out of the scene, with the costumes noted for them. */
export function removePresentCharacter(d: SceneDetails, character: string): SceneDetails {
  const key = characterKey(character);
  const next = withCostumes(d, key, []);
  return { ...next, present: next.present.filter((x) => x !== key) };
}

/**
 * The details after a character is renamed. The new name keeps the old one's
 * costumes after any it already had; a rename onto a character who speaks in
 * the scene drops the old name from those present without speaking.
 */
export function renameCharacterInDetails(d: SceneDetails, from: string, to: string): SceneDetails {
  const a = characterKey(from);
  const b = characterKey(to);
  if (!a || !b || a === b) return d;
  const moved = d.costumes[a];
  const wasPresent = d.present.includes(a);
  if (!moved && !wasPresent) return d;
  let next: SceneDetails = { ...d, costumes: { ...d.costumes }, present: d.present.filter((x) => x !== a) };
  delete next.costumes[a];
  if (moved) {
    const have = next.costumes[b] ?? [];
    next.costumes[b] = [...have, ...moved.filter((m) => !have.some((h) => h.costumeId === m.costumeId))];
  }
  if (wasPresent && !next.present.includes(b)) next = { ...next, present: [...next.present, b] };
  return next;
}

/**
 * Rename a character in every scene's details and every shot's costume
 * choice, on the document as `tr` has it now (after the cues were rewritten).
 * Returns how many nodes changed.
 */
export function renameCharacterInScript(tr: Transaction, from: string, to: string): number {
  const a = characterKey(from);
  const b = characterKey(to);
  if (!a || !b || a === b) return 0;
  const updates: { pos: number; attr: string; value: unknown }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'sceneHeading') {
      const before = readSceneDetails(node.attrs[SCENE_DETAILS_ATTR]);
      const after = renameCharacterInDetails(before, a, b);
      if (after !== before) updates.push({ pos, attr: SCENE_DETAILS_ATTR, value: sceneDetailsAttr(after) });
      return false;
    }
    if (node.type.name === 'shot') {
      const picked = readShotCostumes(node.attrs[SHOT_COSTUMES_ATTR]);
      if (picked[a]) {
        const next = { ...picked };
        if (!next[b]) next[b] = picked[a];
        delete next[a];
        updates.push({ pos, attr: SHOT_COSTUMES_ATTR, value: Object.keys(next).length ? next : null });
      }
      return false;
    }
    return !node.isTextblock;
  });
  for (const u of updates) tr.setNodeAttribute(u.pos, u.attr, u.value);
  return updates.length;
}

/** The details without any reference to a costume that has been deleted from its character. */
export function dropCostume(d: SceneDetails, character: string, costumeId: string): SceneDetails {
  return costumesIn(d, character).some((x) => x.costumeId === costumeId)
    ? removeSceneCostume(d, character, costumeId)
    : d;
}

// ── Shots ───────────────────────────────────────────────────────────────────

/** Which costume (by id) each character wears in a shot, as the shot node keeps it. */
export function readShotCostumes(raw: unknown): Record<string, string> {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [name, id] of Object.entries(value as Record<string, unknown>)) {
    const key = characterKey(name);
    if (key && typeof id === 'string' && id) out[key] = id;
  }
  return out;
}

/**
 * Whether a shot shows a character: their name, in capitals as a script
 * introduces people, or as a cue would write it, stands as a word in the shot.
 */
export function shotShowsCharacter(shotText: string, character: string): boolean {
  const name = characterKey(character);
  if (!name) return false;
  const upper = singleLine(shotText).toUpperCase();
  let from = 0;
  for (;;) {
    const i = upper.indexOf(name, from);
    if (i < 0) return false;
    const before = i > 0 ? upper[i - 1] : ' ';
    const after = i + name.length < upper.length ? upper[i + name.length] : ' ';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = i + 1;
  }
}

/**
 * The costume a character wears in a shot: the one the shot names if the
 * scene still lists it, else the first costume for the scene's first shot
 * and the last one after it — the change usually happens during the scene.
 */
export function shotCostumeFor(
  sceneCostumes: SceneCostumeRef[],
  shotChoice: string | undefined,
  shotIndex: number,
): string | null {
  if (!sceneCostumes.length) return null;
  if (shotChoice && sceneCostumes.some((c) => c.costumeId === shotChoice)) return shotChoice;
  return shotIndex === 0 ? sceneCostumes[0].costumeId : sceneCostumes[sceneCostumes.length - 1].costumeId;
}

// ── Reading the script ──────────────────────────────────────────────────────

export interface SceneShot {
  /** Position of the shot node in the document. */
  pos: number;
  text: string;
  costumes: Record<string, string>;
}

export interface SceneCastMember {
  /** Character key. */
  name: string;
  /** Dialogue blocks spoken in the scene. */
  lines: number;
  /** In the scene without speaking (entered by hand). */
  silent: boolean;
}

export interface SceneBrief {
  /** Place in the scene list, from 0, as the Navigator counts scenes. */
  index: number;
  /** Position of the scene heading. */
  pos: number;
  uid: string | null;
  heading: string;
  /** The stored scene number, or null. */
  number: string | null;
  synopsis: string;
  color: string;
  /** Location name parsed from the heading ('' when it names none). */
  location: string;
  locationType: LocationType;
  /** The heading's time of day, e.g. "NIGHT" ('' when it gives none). */
  timeOfDay: string;
  details: SceneDetails;
  /** Speakers in order of first line, then those present without speaking. */
  cast: SceneCastMember[];
  shots: SceneShot[];
}

const TIME_RE = /\s*[-.]\s*([\p{L} ]+?)\.?\s*$/u;

/** The time-of-day word at the end of a heading: `INT. KITCHEN - NIGHT` → `NIGHT`. */
export function headingTimeOfDay(heading: string): string {
  const line = singleLine(heading);
  const { name } = parseHeadingLocation(line);
  const m = line.match(TIME_RE);
  if (!m) return '';
  const word = m[1].trim().toUpperCase();
  // A heading with no time leaves the place name as the last word.
  return word && word !== name && !name.endsWith(word) ? word : '';
}

/**
 * Every scene in the script, in order, with who is in it and its shots.
 * Scenes are every scene heading, as the Navigator lists them, so `index`
 * matches the scene list the editor store keeps.
 */
export function collectSceneBriefs(doc: PmNode): SceneBrief[] {
  const out: SceneBrief[] = [];
  let current: (SceneBrief & { speakers: Map<string, number> }) | null = null;
  let speaker = '';

  const finish = () => {
    if (!current) return;
    const cast: SceneCastMember[] = [...current.speakers].map(([name, lines]) => ({ name, lines, silent: false }));
    for (const name of current.details.present) {
      if (!current.speakers.has(name)) cast.push({ name, lines: 0, silent: true });
    }
    const { speakers: _speakers, ...brief } = current;
    void _speakers;
    out.push({ ...brief, cast });
  };

  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (type === 'sceneHeading') {
      finish();
      const heading = singleLine(node.textContent);
      const parsed = parseHeadingLocation(heading);
      current = {
        index: out.length,
        pos,
        uid: sceneUidOf(node.attrs),
        heading,
        number: node.attrs.sceneNumber == null ? null : String(node.attrs.sceneNumber),
        synopsis: text(node.attrs.synopsis),
        color: text(node.attrs.sceneColor),
        location: parsed.name,
        locationType: parsed.type,
        timeOfDay: headingTimeOfDay(heading),
        details: readSceneDetails(node.attrs[SCENE_DETAILS_ATTR]),
        cast: [],
        shots: [],
        speakers: new Map(),
      };
      speaker = '';
      return false;
    }
    if (!current) return !node.isTextblock;
    if (type === 'character') {
      speaker = characterKey(node.textContent);
      if (speaker && !current.speakers.has(speaker)) current.speakers.set(speaker, 0);
      return false;
    }
    if (type === 'dialogue') {
      if (speaker && current.speakers.has(speaker)) current.speakers.set(speaker, current.speakers.get(speaker)! + 1);
      return false;
    }
    if (type === 'shot') {
      current.shots.push({ pos, text: singleLine(node.textContent), costumes: readShotCostumes(node.attrs[SHOT_COSTUMES_ATTR]) });
      return false;
    }
    if (node.isTextblock) {
      // Any other block ends a speech: a parenthetical does not, it sits inside one.
      if (type !== 'parenthetical') speaker = '';
      return false;
    }
    return true;
  });
  finish();
  return out;
}

/** The scene the document position `pos` is in, or null before the first heading. */
export function sceneAt(briefs: readonly SceneBrief[], pos: number): SceneBrief | null {
  let found: SceneBrief | null = null;
  for (const b of briefs) {
    if (b.pos > pos) break;
    found = b;
  }
  return found;
}
