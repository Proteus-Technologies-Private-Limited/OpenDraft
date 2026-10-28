/**
 * Production reports: the script read back as tables a department can work
 * from — scenes, characters, locations, cast, and the tagged breakdown.
 *
 * Every report is a `ReportTable`, the same shape a plugin report returns
 * (plugins/registry), so the Reports dialog shows, and exports to CSV and PDF,
 * both kinds the same way. Pure: document and store data in, tables out.
 */
import type { JSONContent } from '@tiptap/react';
import type { ReportTable } from '../plugins/registry';
import type { CharacterProfile, TagCategory, TagItem } from '../stores/editorStore';
import { jsonBlockText, singleLine } from './nodeText';
import { isNonPrintingType } from './nonPrinting';
import { computeSceneTiming, formatSceneDuration, type TimingOptions } from './scriptTiming';
import { parseHeading } from './scriptStatistics';

export interface ReportInput {
  doc: JSONContent;
  characterProfiles: CharacterProfile[];
  tags: TagItem[];
  tagCategories: TagCategory[];
  /** How scene length and screen time are measured — the script's own layout. */
  timing: TimingOptions;
  /** Script and general notes, for the notes reports. Absent reads as none. */
  notes?: ReportNote[];
  generalNotes?: ReportNote[];
}

/**
 * A note as the notes reports read it. Only `id`, `content` and `createdAt`
 * are certain; the rest is read when present — the anchor text of a script
 * note, the title of a general note, and the thread fields (author, replies,
 * resolved, assignee) of a script whose notes carry them. A note without
 * them reports as open, unassigned and without replies.
 */
export interface ReportNote {
  id: string;
  content: string;
  createdAt: string;
  anchorText?: string;
  title?: string;
  author?: string;
  assignee?: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  replies?: Array<{ author?: string; content?: string; createdAt?: string }>;
}

export interface BuiltInReport {
  id: string;
  label: string;
  description: string;
  build: (input: ReportInput) => ReportTable;
}

/** A character cue without the extensions that do not change who is talking. */
export function cueName(text: string): string {
  return text.trim().toUpperCase()
    .replace(/\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT['’]?D|CONT\.?|CONTINUED|PRE-LAP|FILTERED|ON PHONE|INTO PHONE|SUBTITLED)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One scene as the reports see it. */
export interface ReportScene {
  /** Position among the script's scenes, from 0. */
  index: number;
  /** Index of the heading among the document's top-level nodes. */
  nodeIndex: number;
  /** The printed scene number, or the scene's position when the script has none. */
  number: string;
  heading: string;
  prefix: string;
  location: string;
  timeOfDay: string;
  /** Speakers, in order of first line. */
  speakers: string[];
  /** Speeches and words per speaker. */
  dialogue: Map<string, { speeches: number; words: number }>;
  words: number;
  /** Tag ids marked anywhere in the scene. */
  tagIds: Set<string>;
  /** Page length, in eighths of a page. */
  eighths: number;
  /** Estimated screen time, in seconds. */
  seconds: number;
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Every tag id marked in a node's text. */
function collectTagIds(node: JSONContent, out: Set<string>): void {
  for (const mark of node.marks ?? []) {
    if (mark.type === 'productionTag' && typeof mark.attrs?.tagId === 'string') out.add(mark.attrs.tagId);
  }
  for (const child of node.content ?? []) collectTagIds(child, out);
}

/**
 * The scenes of a script, with who speaks in each, its tags and its length.
 *
 * A heading with no text is no scene — the timing engine skips it too, and
 * the two have to agree scene for scene.
 */
export function collectReportScenes(doc: JSONContent, timing: TimingOptions): ReportScene[] {
  const scenes: ReportScene[] = [];
  let current: ReportScene | null = null;
  let speaker = '';

  const speak = (name: string) => {
    if (!current || !name) return;
    speaker = name;
    if (!current.dialogue.has(name)) {
      current.dialogue.set(name, { speeches: 0, words: 0 });
      current.speakers.push(name);
    }
  };
  const visit = (node: JSONContent) => {
    const type = node.type || '';
    if (!current) return;
    if (type === 'dualDialogue' || type === 'dualDialogueColumn') {
      for (const child of node.content ?? []) visit(child);
      return;
    }
    const text = jsonBlockText(node);
    const words = countWords(text);
    current.words += words;
    collectTagIds(node, current.tagIds);
    if (type === 'character') {
      speak(cueName(text));
    } else if (type === 'dialogue' && speaker) {
      const entry = current.dialogue.get(speaker);
      if (entry) {
        entry.speeches++;
        entry.words += words;
      }
    } else if (type !== 'parenthetical') {
      // Any other element ends the speech; the next line needs its own cue.
      speaker = '';
    }
  };

  (doc.content ?? []).forEach((node, nodeIndex) => {
    const type = node.type || '';
    if (type === 'titlePage' || isNonPrintingType(type)) return;
    if (type === 'sceneHeading') {
      const heading = singleLine(jsonBlockText(node)).trim();
      if (!heading) return;
      if (current) scenes.push(current);
      const parsed = parseHeading(heading);
      const number = node.attrs?.sceneNumber;
      current = {
        index: scenes.length,
        nodeIndex,
        number: number != null && String(number).trim() ? String(number) : String(scenes.length + 1),
        heading,
        prefix: parsed.prefix,
        location: parsed.location,
        timeOfDay: parsed.timeOfDay,
        speakers: [],
        dialogue: new Map(),
        words: countWords(heading),
        tagIds: new Set(),
        eighths: 0,
        seconds: 0,
      };
      collectTagIds(node, current.tagIds);
      speaker = '';
      return;
    }
    visit(node);
  });
  if (current) scenes.push(current);

  // Length on the page, from the same line count the timing report uses: a
  // page is linesPerPage lines, so a minute per page measures pages exactly.
  const pages = computeSceneTiming(doc, { ...timing, pageTimeSeconds: 60, pacingMultiplier: 1 });
  const screen = computeSceneTiming(doc, timing);
  scenes.forEach((scene, i) => {
    const auto = pages.scenes[i]?.autoEstimateSeconds ?? 0;
    scene.eighths = Math.max(1, Math.round((auto / 60) * 8));
    scene.seconds = screen.scenes[i]?.finalSeconds ?? 0;
  });
  return scenes;
}

/** A page length in eighths, as a breakdown writes it: "1 3/8", "4/8". */
export function formatEighths(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (whole === 0) return `${rest}/8`;
  return rest === 0 ? String(whole) : `${whole} ${rest}/8`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function sceneReport(input: ReportInput): ReportTable {
  const scenes = collectReportScenes(input.doc, input.timing);
  const totalEighths = scenes.reduce((n, s) => n + s.eighths, 0);
  return {
    title: 'Scene Report',
    summary: `${plural(scenes.length, 'scene')} · ${formatEighths(totalEighths)} pages`,
    columns: ['Scene', 'Heading', 'Int/Ext', 'Location', 'Time', 'Length', 'Est. Time', 'Speaking Characters', 'Words'],
    rows: scenes.map((s) => [
      s.number, s.heading, s.prefix, s.location, s.timeOfDay, formatEighths(s.eighths),
      formatSceneDuration(s.seconds), s.speakers.join(', '), s.words,
    ]),
  };
}

function characterReport(input: ReportInput): ReportTable {
  const scenes = collectReportScenes(input.doc, input.timing);
  const byName = new Map<string, { speeches: number; words: number; scenes: string[] }>();
  for (const scene of scenes) {
    for (const name of scene.speakers) {
      const d = scene.dialogue.get(name)!;
      const entry = byName.get(name) ?? { speeches: 0, words: 0, scenes: [] };
      entry.speeches += d.speeches;
      entry.words += d.words;
      entry.scenes.push(scene.number);
      byName.set(name, entry);
    }
  }
  const totalWords = [...byName.values()].reduce((n, e) => n + e.words, 0);
  const profiles = new Map(input.characterProfiles.map((p) => [p.name.toUpperCase(), p]));
  const rows = [...byName.entries()]
    .sort((a, b) => b[1].words - a[1].words || a[0].localeCompare(b[0]))
    .map(([name, e]) => {
      const profile = profiles.get(name);
      const share = totalWords > 0 ? `${((e.words / totalWords) * 100).toFixed(1)}%` : '0%';
      return [
        name, profile?.role ?? '', profile?.gender ?? '', e.speeches, e.words, share,
        e.scenes.length, e.scenes.join(', '),
      ];
    });
  return {
    title: 'Character Report',
    summary: `${plural(rows.length, 'speaking character')}`,
    columns: ['Character', 'Role', 'Gender', 'Speeches', 'Words', 'Share of Dialogue', 'Scenes', 'Scene Numbers'],
    rows,
  };
}

function locationReport(input: ReportInput): ReportTable {
  const scenes = collectReportScenes(input.doc, input.timing);
  const byLocation = new Map<string, { prefixes: Set<string>; times: Set<string>; eighths: number; scenes: string[] }>();
  for (const s of scenes) {
    const key = s.location || s.heading.toUpperCase();
    const entry = byLocation.get(key) ?? { prefixes: new Set(), times: new Set(), eighths: 0, scenes: [] };
    if (s.prefix) entry.prefixes.add(s.prefix);
    if (s.timeOfDay) entry.times.add(s.timeOfDay);
    entry.eighths += s.eighths;
    entry.scenes.push(s.number);
    byLocation.set(key, entry);
  }
  const rows = [...byLocation.entries()]
    .sort((a, b) => b[1].scenes.length - a[1].scenes.length || a[0].localeCompare(b[0]))
    .map(([location, e]) => [
      location, [...e.prefixes].join(', '), [...e.times].join(', '), e.scenes.length,
      formatEighths(e.eighths), e.scenes.join(', '),
    ]);
  return {
    title: 'Location Report',
    summary: plural(rows.length, 'location'),
    columns: ['Location', 'Int/Ext', 'Times of Day', 'Scenes', 'Total Length', 'Scene Numbers'],
    rows,
  };
}

/** Strip the HTML a profile's rich-text fields are stored in. */
function plainText(html: string): string {
  return (html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function castReport(input: ReportInput): ReportTable {
  const scenes = collectReportScenes(input.doc, input.timing);
  const speaking = new Map<string, number>();
  for (const s of scenes) for (const name of s.speakers) speaking.set(name, (speaking.get(name) ?? 0) + 1);
  const names = new Set<string>([...input.characterProfiles.map((p) => p.name.toUpperCase()), ...speaking.keys()]);
  const profiles = new Map(input.characterProfiles.map((p) => [p.name.toUpperCase(), p]));
  const rows = [...names]
    .sort((a, b) => (speaking.get(b) ?? 0) - (speaking.get(a) ?? 0) || a.localeCompare(b))
    .map((name) => {
      const p = profiles.get(name);
      return [name, p?.role ?? '', p?.gender ?? '', p?.age ?? '', speaking.get(name) ?? 0, plainText(p?.description ?? '')];
    });
  return {
    title: 'Cast Report',
    summary: plural(rows.length, 'cast member'),
    columns: ['Character', 'Role', 'Gender', 'Age', 'Speaking Scenes', 'Description'],
    rows,
  };
}

function tagBreakdownReport(input: ReportInput): ReportTable {
  const scenes = collectReportScenes(input.doc, input.timing);
  const categories = new Map(input.tagCategories.map((c) => [c.id, c]));
  const order = new Map(input.tagCategories.map((c, i) => [c.id, i]));
  const scenesFor = (tagId: string) => scenes.filter((s) => s.tagIds.has(tagId)).map((s) => s.number);
  // The same element tagged twice is one item on a breakdown sheet.
  const seen = new Map<string, { item: TagItem; scenes: Set<string> }>();
  for (const tag of input.tags) {
    const name = (tag.name || tag.text || '').trim();
    if (!name) continue;
    const key = `${tag.categoryId}\u0000${name.toUpperCase()}`;
    const entry = seen.get(key) ?? { item: tag, scenes: new Set<string>() };
    for (const n of scenesFor(tag.id)) entry.scenes.add(n);
    seen.set(key, entry);
  }
  const rows = [...seen.values()]
    .sort((a, b) => (order.get(a.item.categoryId) ?? 999) - (order.get(b.item.categoryId) ?? 999)
      || (a.item.name || a.item.text).localeCompare(b.item.name || b.item.text))
    .map(({ item, scenes: sceneSet }) => [
      categories.get(item.categoryId)?.name ?? item.categoryId,
      (item.name || item.text).trim(),
      sceneSet.size,
      [...sceneSet].join(', '),
      plainText(item.notes ?? ''),
    ]);
  return {
    title: 'Breakdown Report',
    summary: `${plural(rows.length, 'tagged item')} in ${plural(new Set(rows.map((r) => r[0])).size, 'category')}`,
    columns: ['Category', 'Item', 'Scenes', 'Scene Numbers', 'Notes'],
    rows,
  };
}

/**
 * Where each anchored note sits: the index of the top-level node its
 * highlight first appears in, by note id. Notes inside dual dialogue are found
 * too. A note whose highlight is gone from the script has no entry.
 */
function noteAnchors(doc: JSONContent): Map<string, number> {
  const found = new Map<string, number>();
  const visit = (node: JSONContent, nodeIndex: number) => {
    for (const mark of node.marks ?? []) {
      const id = mark.type === 'scriptNote' ? mark.attrs?.noteId : null;
      if (typeof id === 'string' && !found.has(id)) found.set(id, nodeIndex);
    }
    for (const child of node.content ?? []) visit(child, nodeIndex);
  };
  (doc.content ?? []).forEach((node, i) => visit(node, i));
  return found;
}

const isResolved = (n: ReportNote) => n.resolved === true;
const repliesOf = (n: ReportNote) => (Array.isArray(n.replies) ? n.replies : []);

/**
 * Write `@Jane_Doe` as "@Jane Doe" when Jane Doe has written in, been
 * assigned or resolved any of these notes. A mention is stored as one word;
 * on paper it reads as the name. Anything else is left as typed.
 */
function mentionsAsNames(notes: ReportNote[]): (text: string) => string {
  const people = new Map<string, string>();
  const add = (name: string | undefined) => {
    const n = (name ?? '').trim().replace(/\s+/g, ' ');
    if (n && !people.has(n.toLowerCase())) people.set(n.toLowerCase(), n);
  };
  for (const n of notes) {
    add(n.author); add(n.assignee); add(n.resolvedBy);
    for (const r of repliesOf(n)) add(r.author);
  }
  return (text) => text.replace(/@(\S+)/g, (token, word: string) => {
    const trimmed = word.replace(/[.,;:!?)]+$/, '');
    for (const candidate of [word, trimmed]) {
      const person = candidate && people.get(candidate.replace(/_/g, ' ').toLowerCase());
      if (person) return `@${person}${word.slice(candidate.length)}`;
    }
    return token;
  });
}

/** A date as a report prints it: the day, which sorts as text. */
const reportDate = (iso: string | undefined) => (iso ?? '').slice(0, 10);

/**
 * Every note and its replies, one row each: the note numbered 1, 2, 3… in
 * script order with its scene, its replies 1.1, 1.2… under it. General notes
 * follow, then any note whose highlight is no longer in the script.
 */
function buildNotesReport(input: ReportInput, openOnly: boolean): ReportTable {
  const scenes = collectReportScenes(input.doc, input.timing);
  const anchors = noteAnchors(input.doc);
  const sceneAt = (nodeIndex: number) => {
    let found: ReportScene | null = null;
    for (const sc of scenes) {
      if (sc.nodeIndex > nodeIndex) break;
      found = sc;
    }
    return found;
  };

  type Entry = { note: ReportNote; scene: string; on: string; order: number };
  const anchored: Entry[] = [];
  const orphaned: Entry[] = [];
  (input.notes ?? []).forEach((note, i) => {
    const at = anchors.get(note.id);
    const on = singleLine(note.anchorText ?? '').trim();
    if (at === undefined) {
      orphaned.push({ note, scene: '', on, order: i });
    } else {
      anchored.push({ note, scene: sceneAt(at)?.number ?? '', on, order: at * 1e6 + i });
    }
  });
  anchored.sort((a, b) => a.order - b.order);
  const general: Entry[] = (input.generalNotes ?? []).map((note, i) => ({
    note, scene: 'General', on: singleLine(note.title ?? '').trim(), order: i,
  }));

  const all = [...anchored, ...general, ...orphaned];
  const text = mentionsAsNames(all.map((e) => e.note));
  const listed = openOnly ? all.filter((e) => !isResolved(e.note)) : all;
  const rows: Array<Array<string | number>> = [];
  let replyCount = 0;
  listed.forEach((entry, i) => {
    const n = i + 1;
    const { note } = entry;
    const status = isResolved(note)
      ? `Resolved${note.resolvedBy ? ` by ${note.resolvedBy}` : ''}${note.resolvedAt ? ` ${reportDate(note.resolvedAt)}` : ''}`
      : 'Open';
    rows.push([String(n), entry.scene, entry.on, note.author ?? '', text(note.content), status, note.assignee ?? '', reportDate(note.createdAt)]);
    repliesOf(note).forEach((r, k) => {
      replyCount++;
      rows.push([`${n}.${k + 1}`, '', '', r.author ?? '', text(r.content ?? ''), '', '', reportDate(r.createdAt)]);
    });
  });

  const resolved = all.filter((e) => isResolved(e.note)).length;
  const replies = `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
  return {
    title: openOnly ? 'Open Notes' : 'Notes Report',
    summary: openOnly
      ? `${plural(listed.length, 'open note')} · ${replies}`
      : `${plural(all.length, 'note')} · ${all.length - resolved} open · ${resolved} resolved · ${replies}`,
    columns: ['#', 'Scene', 'On', 'From', 'Comment', 'Status', 'Assigned To', 'Date'],
    rows,
  };
}

export const BUILT_IN_REPORTS: BuiltInReport[] = [
  { id: 'scenes', label: 'Scene Report', description: 'Every scene with its location, length, screen time and who speaks', build: sceneReport },
  { id: 'characters', label: 'Character Report', description: 'Speeches, words and scenes for every speaking character', build: characterReport },
  { id: 'locations', label: 'Location Report', description: 'Each location, how often it is used and for how many pages', build: locationReport },
  { id: 'cast', label: 'Cast Report', description: 'Character profiles with role, gender, age and speaking scenes', build: castReport },
  { id: 'breakdown', label: 'Breakdown Report', description: 'Tagged props, costumes, vehicles and more, with their scenes', build: tagBreakdownReport },
  { id: 'notes', label: 'Notes Report', description: 'Every note with its replies, who wrote it, who it is assigned to, and whether it is resolved', build: (input) => buildNotesReport(input, false) },
  { id: 'open-notes', label: 'Open Notes', description: 'Only the notes not yet resolved, with their replies — what is still to do', build: (input) => buildNotesReport(input, true) },
];

// ── Output ──────────────────────────────────────────────────────────────────

/**
 * A report as CSV: RFC 4180 quoting, CRLF line ends, and a byte-order mark so
 * Excel opens it as UTF-8 rather than mangling every accented name.
 */
export function reportToCsv(table: ReportTable): string {
  const cell = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // A cell that opens with = + - @ is run as a formula by spreadsheets; a
  // character name cannot be allowed to do that.
  const safe = (v: string | number) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const lines = [table.columns, ...table.rows].map((row) => row.map((v) => cell(safe(v))).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * A report as a landscape PDF table, wrapped to the page and repeating its
 * header on every page.
 */
export async function reportToPdf(table: ReportTable, scriptTitle: string): Promise<Uint8Array> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const usable = pageW - margin * 2;
  const fontSize = 8.5;
  const lineH = fontSize * 1.25;
  const pad = 3;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(fontSize);
  // Columns share the width by how much they hold, within limits, so a
  // heading column gets room and a count column does not hog it.
  const measure = (s: string) => pdf.getTextWidth(s);
  const natural = table.columns.map((col, c) => {
    const widest = Math.max(measure(col), ...table.rows.slice(0, 200).map((r) => measure(String(r[c] ?? ''))));
    return Math.min(Math.max(widest + pad * 2, 36), usable * 0.4);
  });
  const total = natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => (w / total) * usable);

  const wrap = (text: string, width: number): string[] =>
    pdf.splitTextToSize(text, Math.max(8, width - pad * 2)) as string[];

  let y = margin;
  const header = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(table.title, margin, y + 12);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    const sub = [scriptTitle, table.summary].filter(Boolean).join(' — ');
    if (sub) pdf.text(sub, margin, y + 26);
    y += 36;
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', 'bold');
    const cells = table.columns.map((col, c) => wrap(col, widths[c]));
    const h = Math.max(...cells.map((l) => l.length)) * lineH + pad * 2;
    pdf.setFillColor(235, 235, 235);
    pdf.rect(margin, y, usable, h, 'F');
    let x = margin;
    cells.forEach((lines, c) => {
      lines.forEach((line, k) => pdf.text(line, x + pad, y + pad + fontSize + k * lineH));
      x += widths[c];
    });
    y += h;
    pdf.setFont('helvetica', 'normal');
  };

  header();
  if (table.rows.length === 0) {
    pdf.text('Nothing to report.', margin + pad, y + pad + fontSize);
  }
  table.rows.forEach((row, r) => {
    const cells = row.map((v, c) => wrap(String(v ?? ''), widths[c]));
    const h = Math.max(1, ...cells.map((l) => l.length)) * lineH + pad * 2;
    if (y + h > pageH - margin) {
      pdf.addPage();
      y = margin;
      header();
    }
    if (r % 2 === 1) {
      pdf.setFillColor(248, 248, 248);
      pdf.rect(margin, y, usable, h, 'F');
    }
    let x = margin;
    cells.forEach((lines, c) => {
      lines.forEach((line, k) => pdf.text(line, x + pad, y + pad + fontSize + k * lineH));
      x += widths[c];
    });
    y += h;
  });

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFontSize(8);
    pdf.text(`${p} / ${pages}`, pageW - margin, pageH - 18, { align: 'right' });
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}
