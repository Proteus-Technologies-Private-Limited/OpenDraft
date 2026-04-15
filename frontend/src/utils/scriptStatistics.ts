/**
 * Script Statistics — pure computation functions that analyze TipTap document JSON.
 * No React, no side-effects — just data in, stats out.
 */
import type { JSONContent } from '@tiptap/react';
import type { CharacterProfile } from '../stores/editorStore';

// ── Scene heading parsing (matching SceneNavigator patterns) ──────────

const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR';
const PREFIX_RE = /(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/i;

function parseHeading(raw: string): { prefix: string; location: string; timeOfDay: string } {
  let rest = raw.trim();
  let prefix = '';
  let timeOfDay = '';

  const prefixMatch = rest.match(PREFIX_RE);
  if (prefixMatch && prefixMatch.index !== undefined) {
    const p = prefixMatch[1].toUpperCase();
    if (p.includes('/')) prefix = 'INT./EXT.';
    else if (p.startsWith('INT')) prefix = 'INT.';
    else if (p.startsWith('EXT')) prefix = 'EXT.';
    else prefix = p;
    rest = rest.slice(prefixMatch.index + prefixMatch[0].length);
  }

  const dashTime = rest.match(new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?$`, 'i'));
  if (dashTime) {
    timeOfDay = dashTime[1].toUpperCase();
    rest = rest.slice(0, -dashTime[0].length);
  } else {
    const dotTime = rest.match(new RegExp(`\\.\\s*(${TIME_WORDS})\\.?$`, 'i'));
    if (dotTime) {
      timeOfDay = dotTime[1].toUpperCase();
      rest = rest.slice(0, -dotTime[0].length);
    }
  }

  const location = rest.replace(/^[\s.]+|[\s.]+$/g, '').toUpperCase();
  return { prefix, location, timeOfDay };
}

// ── Helpers ──────────────────────────────────────────────────────────

function getTextContent(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(getTextContent).join('');
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── Types ────────────────────────────────────────────────────────────

export interface OverviewStats {
  totalPages: number;
  totalScenes: number;
  totalWords: number;
  totalDialogueLines: number;
  totalCharacters: number;
  averageSceneLength: number; // in pages
  estimatedRuntime: number; // in minutes
}

export interface CharacterDialogueStats {
  name: string;
  color: string;
  gender: string;
  role: string;
  lineCount: number;
  wordCount: number;
  dialoguePercentage: number;
  sceneCount: number;
}

export interface GenderStats {
  gender: string;
  characters: number;
  lineCount: number;
  wordCount: number;
  dialoguePercentage: number;
}

export interface SceneBreakdownStats {
  intCount: number;
  extCount: number;
  intExtCount: number;
  dayCount: number;
  nightCount: number;
  otherTimeCount: number;
  sceneLengthBuckets: { label: string; count: number }[];
  locationFrequency: { location: string; count: number }[];
}

export interface PacingDataPoint {
  sceneIndex: number;
  heading: string;
  dialogueWords: number;
  actionWords: number;
  pageLength: number;
}

export interface CharacterPresenceEntry {
  name: string;
  color: string;
  scenes: boolean[]; // true if character appears in scene at that index
}

// ── Computation functions ────────────────────────────────────────────

/**
 * Walk the document and extract per-scene data in one pass.
 */
interface SceneData {
  heading: string;
  prefix: string;
  location: string;
  timeOfDay: string;
  dialogueByCharacter: Map<string, { lines: number; words: number }>;
  actionWords: number;
  totalWords: number;
}

function extractSceneData(doc: JSONContent): SceneData[] {
  const scenes: SceneData[] = [];
  let current: SceneData | null = null;
  let lastCharacter = '';

  if (!doc.content) return scenes;

  for (const node of doc.content) {
    const type = node.type || '';
    if (type === 'titlePage') continue;

    const text = getTextContent(node);
    const words = countWords(text);

    if (type === 'sceneHeading') {
      if (current) scenes.push(current);
      const parsed = parseHeading(text);
      current = {
        heading: text,
        prefix: parsed.prefix,
        location: parsed.location,
        timeOfDay: parsed.timeOfDay,
        dialogueByCharacter: new Map(),
        actionWords: 0,
        totalWords: 0,
      };
      current.totalWords += words;
      lastCharacter = '';
    } else if (current) {
      current.totalWords += words;
      if (type === 'character') {
        lastCharacter = text.trim().toUpperCase()
          .replace(/\s*\(V\.O\.\)|\(O\.S\.\)|\(O\.C\.\)|\(CONT'D\)|\(CONT\)/gi, '')
          .trim();
        if (!current.dialogueByCharacter.has(lastCharacter)) {
          current.dialogueByCharacter.set(lastCharacter, { lines: 0, words: 0 });
        }
      } else if (type === 'dialogue' && lastCharacter) {
        const entry = current.dialogueByCharacter.get(lastCharacter);
        if (entry) {
          entry.lines++;
          entry.words += words;
        }
      } else if (type === 'parenthetical') {
        // parentheticals don't count as dialogue words
      } else if (type === 'action' || type === 'general') {
        current.actionWords += words;
      }
    }
  }
  if (current) scenes.push(current);
  return scenes;
}

export function computeOverviewStats(doc: JSONContent, pageCount: number): OverviewStats {
  const scenes = extractSceneData(doc);
  let totalWords = 0;
  let totalDialogueLines = 0;
  const allCharacters = new Set<string>();

  for (const scene of scenes) {
    totalWords += scene.totalWords;
    for (const [name, data] of scene.dialogueByCharacter) {
      totalDialogueLines += data.lines;
      allCharacters.add(name);
    }
  }

  const totalPages = pageCount || Math.max(1, Math.ceil(totalWords / 250));
  return {
    totalPages,
    totalScenes: scenes.length,
    totalWords,
    totalDialogueLines,
    totalCharacters: allCharacters.size,
    averageSceneLength: scenes.length > 0 ? totalPages / scenes.length : 0,
    estimatedRuntime: totalPages, // 1 page ≈ 1 minute
  };
}

export function computeCharacterDialogue(
  doc: JSONContent,
  characterProfiles: CharacterProfile[],
): CharacterDialogueStats[] {
  const scenes = extractSceneData(doc);
  const characterMap = new Map<string, { lines: number; words: number; sceneSet: Set<number> }>();

  scenes.forEach((scene, sceneIdx) => {
    for (const [name, data] of scene.dialogueByCharacter) {
      let entry = characterMap.get(name);
      if (!entry) {
        entry = { lines: 0, words: 0, sceneSet: new Set() };
        characterMap.set(name, entry);
      }
      entry.lines += data.lines;
      entry.words += data.words;
      entry.sceneSet.add(sceneIdx);
    }
  });

  let totalDialogueWords = 0;
  for (const entry of characterMap.values()) totalDialogueWords += entry.words;

  const profileMap = new Map<string, CharacterProfile>();
  for (const p of characterProfiles) profileMap.set(p.name.toUpperCase(), p);

  const stats: CharacterDialogueStats[] = [];
  for (const [name, data] of characterMap) {
    const profile = profileMap.get(name);
    stats.push({
      name,
      color: profile?.color || '#666',
      gender: profile?.gender || '',
      role: profile?.role || '',
      lineCount: data.lines,
      wordCount: data.words,
      dialoguePercentage: totalDialogueWords > 0 ? (data.words / totalDialogueWords) * 100 : 0,
      sceneCount: data.sceneSet.size,
    });
  }

  stats.sort((a, b) => b.wordCount - a.wordCount);
  return stats;
}

export function computeGenderBreakdown(
  characterStats: CharacterDialogueStats[],
): GenderStats[] {
  const genderMap = new Map<string, { characters: number; lines: number; words: number }>();
  let totalWords = 0;

  for (const c of characterStats) {
    const gender = c.gender || 'Unassigned';
    let entry = genderMap.get(gender);
    if (!entry) {
      entry = { characters: 0, lines: 0, words: 0 };
      genderMap.set(gender, entry);
    }
    entry.characters++;
    entry.lines += c.lineCount;
    entry.words += c.wordCount;
    totalWords += c.wordCount;
  }

  const stats: GenderStats[] = [];
  for (const [gender, data] of genderMap) {
    stats.push({
      gender,
      characters: data.characters,
      lineCount: data.lines,
      wordCount: data.words,
      dialoguePercentage: totalWords > 0 ? (data.words / totalWords) * 100 : 0,
    });
  }

  stats.sort((a, b) => b.wordCount - a.wordCount);
  return stats;
}

export function computeSceneBreakdown(doc: JSONContent): SceneBreakdownStats {
  const scenes = extractSceneData(doc);
  let intCount = 0;
  let extCount = 0;
  let intExtCount = 0;
  let dayCount = 0;
  let nightCount = 0;
  let otherTimeCount = 0;
  const locationCounts = new Map<string, number>();

  for (const scene of scenes) {
    if (scene.prefix === 'INT./EXT.') intExtCount++;
    else if (scene.prefix === 'INT.') intCount++;
    else if (scene.prefix === 'EXT.') extCount++;

    if (scene.timeOfDay === 'DAY' || scene.timeOfDay === 'MORNING' || scene.timeOfDay === 'AFTERNOON') dayCount++;
    else if (scene.timeOfDay === 'NIGHT' || scene.timeOfDay === 'EVENING') nightCount++;
    else otherTimeCount++;

    if (scene.location) {
      locationCounts.set(scene.location, (locationCounts.get(scene.location) || 0) + 1);
    }
  }

  // Scene length distribution (we approximate from word count since we don't have page layout here)
  // ~250 words per page
  const sceneLengthBuckets = [
    { label: '< 1 page', count: 0 },
    { label: '1-2 pages', count: 0 },
    { label: '2-3 pages', count: 0 },
    { label: '3-5 pages', count: 0 },
    { label: '5+ pages', count: 0 },
  ];
  for (const scene of scenes) {
    const pages = scene.totalWords / 250;
    if (pages < 1) sceneLengthBuckets[0].count++;
    else if (pages < 2) sceneLengthBuckets[1].count++;
    else if (pages < 3) sceneLengthBuckets[2].count++;
    else if (pages < 5) sceneLengthBuckets[3].count++;
    else sceneLengthBuckets[4].count++;
  }

  const locationFrequency = Array.from(locationCounts.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return { intCount, extCount, intExtCount, dayCount, nightCount, otherTimeCount, sceneLengthBuckets, locationFrequency };
}

export function computePacingData(doc: JSONContent): PacingDataPoint[] {
  const scenes = extractSceneData(doc);
  return scenes.map((scene, i) => {
    let dialogueWords = 0;
    for (const data of scene.dialogueByCharacter.values()) dialogueWords += data.words;
    return {
      sceneIndex: i,
      heading: scene.heading,
      dialogueWords,
      actionWords: scene.actionWords,
      pageLength: scene.totalWords / 250,
    };
  });
}

export function computeCharacterPresence(
  doc: JSONContent,
  characterProfiles: CharacterProfile[],
): CharacterPresenceEntry[] {
  const scenes = extractSceneData(doc);
  const allCharacters = new Map<string, { color: string; scenesPresent: Set<number> }>();

  const profileMap = new Map<string, CharacterProfile>();
  for (const p of characterProfiles) profileMap.set(p.name.toUpperCase(), p);

  scenes.forEach((scene, sceneIdx) => {
    for (const name of scene.dialogueByCharacter.keys()) {
      let entry = allCharacters.get(name);
      if (!entry) {
        const profile = profileMap.get(name);
        entry = { color: profile?.color || '#666', scenesPresent: new Set() };
        allCharacters.set(name, entry);
      }
      entry.scenesPresent.add(sceneIdx);
    }
  });

  // Sort by most appearances
  const entries = Array.from(allCharacters.entries())
    .sort((a, b) => b[1].scenesPresent.size - a[1].scenesPresent.size);

  return entries.map(([name, data]) => ({
    name,
    color: data.color,
    scenes: scenes.map((_, i) => data.scenesPresent.has(i)),
  }));
}
