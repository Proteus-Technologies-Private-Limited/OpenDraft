/**
 * Which elements of a script a selective print keeps: the scenes chosen for
 * sides, or everything a character says, a location's scenes, or every
 * element carrying a tag. The PDF exporter keeps each page holding any of
 * them (PDFExportOptions.pageSelection) — these decide what "them" is.
 *
 * Indices are positions in the document's top-level content, which is how
 * the exporter identifies what it drew.
 */
import type { JSONContent } from '@tiptap/react';
import { jsonBlockText, singleLine } from './nodeText';
import { parseHeading } from './scriptStatistics';
import { cueName } from './scriptReports';

export interface SceneRange {
  /** Position among the scenes, from 0. */
  index: number;
  /** The heading's index in the document's top-level content. */
  start: number;
  /** One past the scene's last node. */
  end: number;
  heading: string;
  /** The printed number, or the scene's position when the script has none. */
  number: string;
  location: string;
}

/** The scenes of a script as ranges of its top-level nodes. */
export function sceneRanges(doc: JSONContent): SceneRange[] {
  const nodes = doc.content ?? [];
  const ranges: SceneRange[] = [];
  nodes.forEach((node, i) => {
    if (node.type !== 'sceneHeading') return;
    const heading = singleLine(jsonBlockText(node)).trim();
    if (!heading) return;
    const last = ranges[ranges.length - 1];
    if (last) last.end = i;
    const number = node.attrs?.sceneNumber;
    ranges.push({
      index: ranges.length,
      start: i,
      end: nodes.length,
      heading,
      number: number != null && String(number).trim() ? String(number) : String(ranges.length + 1),
      location: parseHeading(heading).location,
    });
  });
  return ranges;
}

const inRanges = (ranges: SceneRange[]) => (i: number) => ranges.some((r) => i >= r.start && i < r.end);

/** Keep the chosen scenes, whole. */
export function keepScenes(doc: JSONContent, sceneIndices: Iterable<number>): (i: number) => boolean {
  const wanted = new Set(sceneIndices);
  return inRanges(sceneRanges(doc).filter((r) => wanted.has(r.index)));
}

/** Every scene at a location, as the scene report names it. */
export function keepLocation(doc: JSONContent, location: string): (i: number) => boolean {
  const wanted = location.trim().toUpperCase();
  return inRanges(sceneRanges(doc).filter((r) => r.location === wanted));
}

/** Whether a dual-dialogue block has the character speaking in it. */
function dualHasSpeaker(node: JSONContent, name: string): boolean {
  return (node.content ?? []).some((col) => (col.content ?? [])
    .some((c) => c.type === 'character' && cueName(jsonBlockText(c)) === name));
}

/**
 * Everything a character says: each of their cues and the speech under it —
 * the pages Final Draft prints for "pages with this character".
 */
export function keepCharacter(doc: JSONContent, character: string): (i: number) => boolean {
  const name = cueName(character);
  const keep = new Set<number>();
  let speaking = false;
  (doc.content ?? []).forEach((node, i) => {
    const type = node.type || '';
    if (type === 'character') {
      speaking = cueName(jsonBlockText(node)) === name;
      if (speaking) keep.add(i);
    } else if (type === 'dialogue' || type === 'parenthetical' || type === 'lyrics') {
      if (speaking) keep.add(i);
    } else {
      speaking = false;
      if (type === 'dualDialogue' && dualHasSpeaker(node, name)) keep.add(i);
    }
  });
  return (i) => keep.has(i);
}

/** Whether a node or anything inside it is marked with one of the tags. */
function carriesTag(node: JSONContent, tagIds: Set<string>): boolean {
  if ((node.marks ?? []).some((m) => m.type === 'productionTag' && tagIds.has(String(m.attrs?.tagId)))) return true;
  return (node.content ?? []).some((child) => carriesTag(child, tagIds));
}

/** Every element carrying any of these production tags. */
export function keepTags(doc: JSONContent, tagIds: Iterable<string>): (i: number) => boolean {
  const ids = new Set(tagIds);
  const keep = new Set<number>();
  (doc.content ?? []).forEach((node, i) => { if (carriesTag(node, ids)) keep.add(i); });
  return (i) => keep.has(i);
}

/** The scenes a character speaks in — what sides for an actor start from. */
export function scenesWithCharacter(doc: JSONContent, character: string): number[] {
  const speaks = keepCharacter(doc, character);
  return sceneRanges(doc)
    .filter((r) => {
      for (let i = r.start; i < r.end; i++) if (speaks(i)) return true;
      return false;
    })
    .map((r) => r.index);
}

/** Every speaking character, in order of first appearance. */
export function speakingCharacters(doc: JSONContent): string[] {
  const names: string[] = [];
  const add = (node: JSONContent) => {
    if (node.type === 'character') {
      const name = cueName(jsonBlockText(node));
      if (name && !names.includes(name)) names.push(name);
    }
    if (node.type === 'dualDialogue' || node.type === 'dualDialogueColumn') (node.content ?? []).forEach(add);
  };
  (doc.content ?? []).forEach(add);
  return names;
}
